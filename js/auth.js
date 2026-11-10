/* Shared auth + session layer. Used by index.html (sign in / register) and app.html (portal guard).
   USE_MOCK=true  -> accounts live in localStorage (demo only, NOT secure).
   USE_MOCK=false -> every call goes to BD_CONFIG.API_BASE (see README for the contract). */
(function () {
  'use strict';
  var C = window.BD_CONFIG;
  var K = { session: 'bd.session', users: 'bd.mock.users', pw: 'bd.mock.pw', next: 'bd.next', seeded: 'bd.mock.seeded' };

  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function fail(status, msg) { var e = new Error(msg || 'HTTP ' + status); e.status = status; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- session ---------- */
  function current() {
    var s = ls.get(K.session, null);
    if (!s || !s.user) return null;
    if (s.exp && Date.now() > s.exp) { ls.del(K.session); return null; }
    return s;
  }
  function save(user, token, csrf) {
    var s = { user: user, token: token || null, csrf: csrf || null, iat: Date.now(), exp: Date.now() + C.SESSION_HOURS * 3600e3 };
    ls.set(K.session, s); return s;
  }
  function authHeader() {   // real API: the session itself is an httpOnly cookie; the CSRF token must accompany every state-changing call
    var s = current(), h = {};
    if (s && s.token) h.Authorization = 'Bearer ' + s.token;
    if (s && s.csrf) h['X-CSRF-Token'] = s.csrf;
    return h;
  }
  function areaOf(user) { return user && user.role === 'admin' ? 'admin' : 'resident'; }
  function dashboardUrl(user) { return 'app.html#/' + areaOf(user || (current() || {}).user); }

  /* where to send the user after sign-in (e.g. they clicked "Track" while signed out) */
  function setNext(url) { try { sessionStorage.setItem(K.next, url); } catch (e) {} }
  function takeNext(user) {
    var n = null;
    try { n = sessionStorage.getItem(K.next); sessionStorage.removeItem(K.next); } catch (e) {}
    if (!n || n.indexOf('app.html#/' + areaOf(user)) !== 0) return null; // same-site, own area only
    return n;
  }

  /* portal guard: no session -> back to the sign-in screen */
  function requireSession() {
    if (current()) return true;
    setNext('app.html' + location.hash);
    location.replace('index.html#login');
    return false;
  }
  /* the server session cookie is httpOnly, so it can only be cleared by the server: wait for the request before leaving the page */
  function logout() {
    var h = authHeader(), done = function () { location.replace('index.html#home'); };
    ls.del(K.session);
    if (C.USE_MOCK) return done();
    try { fetch(C.API_BASE + '/auth/logout', { method: 'POST', credentials: 'include', headers: h }).catch(function () {}).then(done); } catch (e) { done(); }
  }
  /* the server says the session is gone (expired, revoked, signed out elsewhere) */
  function expire() { ls.del(K.session); setNext('app.html' + location.hash); location.replace('index.html#login'); }
  /* real API: ask the server whether the cookie session is still valid and refresh the user + CSRF token */
  function verify() {
    if (C.USE_MOCK) return Promise.resolve(!!current());
    return api('GET', '/auth/me').then(function (p) {
      var s = current(); if (!s) return false;
      save({ id: p.id, citizenId: p.citizenId, name: p.name, email: p.email, role: p.role }, s.token, p.csrfToken); return true;
    }).catch(function (e) { return e.status === 401 ? false : true; });   // network error: let the page load, API calls will report it
  }

  /* ---------- real API ---------- */
  function api(method, path, body, isForm) {
    var o = { method: method, credentials: 'include', headers: authHeader() };
    if (body) {
      if (isForm) o.body = body;
      else { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    }
    return fetch(C.API_BASE + path, o).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) {
        var e = fail(r.status, b.message); e.code = b.code; e.reason = b.reason; e.email = b.email; e.fields = b.fields; e.retryAfter = b.retryAfter;   // e.g. 403 {code:'pending'|'rejected'|'unverified'}
        if (r.status === 401 && !/^\/auth\/(login|register|verify-otp|resend-otp|forgot-password|reset-password)/.test(path)) expire();   // signed-in call rejected -> back to sign in
        throw e;
      });
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- MOCK backend (delete once the real API exists) ----------
     A resident has two gates: emailVerified (OTP) and status = pending | approved | rejected (admin decision). */
  var SEEDS = [
    { id: 'usr_1', citizenId: 'RES-2026-0001', name: 'Juan Dela Cruz', email: 'juan@example.com', password: 'demo1234!', role: 'resident',
      phone: '09175550143', dob: '1995-06-12', createdAt: '2026-01-01T09:15:00+08:00', idFileName: 'valid-id-juan.pdf', status: 'approved', emailVerified: true },
    { id: 'usr_0', citizenId: 'ADM-0001', name: 'Ana Reyes', email: 'admin@barangaydocs.gov.ph', password: 'admin1234!', role: 'admin', status: 'approved', emailVerified: true }
  ];
  function svgId(name, dob) {   // placeholder ID card so the admin review screen has something to look at
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="265"><rect width="420" height="265" rx="14" fill="#f1f5f9" stroke="#94a3b8"/>' +
      '<rect width="420" height="48" rx="14" fill="#0284c7"/><rect y="30" width="420" height="18" fill="#0284c7"/>' +
      '<text x="20" y="31" font-family="Arial" font-size="17" font-weight="700" fill="#fff">SAMPLE VALID ID (DEMO)</text>' +
      '<rect x="22" y="72" width="96" height="120" rx="8" fill="#cbd5e1"/><circle cx="70" cy="110" r="22" fill="#94a3b8"/><rect x="40" y="140" width="60" height="38" rx="18" fill="#94a3b8"/>' +
      '<text x="138" y="92" font-family="Arial" font-size="11" fill="#64748b">FULL NAME</text><text x="138" y="112" font-family="Arial" font-size="17" font-weight="700" fill="#0f172a">' + name.replace(/&/g, '&amp;') + '</text>' +
      '<text x="138" y="146" font-family="Arial" font-size="11" fill="#64748b">DATE OF BIRTH</text><text x="138" y="165" font-family="Arial" font-size="15" fill="#0f172a">' + dob + '</text>' +
      '<text x="22" y="232" font-family="Arial" font-size="11" fill="#64748b">Placeholder image generated by the mock backend</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function seedDemo() {   // a few registrations so the admin Resident Approvals tab has data on first run
    if (ls.get(K.seeded, 0)) return;
    var now = Date.now(), ago = function (h) { return new Date(now - h * 3600e3).toISOString(); };
    var rows = [
      ['Pedro Reyes Santos', 'pedro.santos@example.com', '09171230001', '1988-03-14', 5, 'pending', ''],
      ['Liza Marie Gomez', 'liza.gomez@example.com', '09171230002', '1996-11-02', 20, 'pending', ''],
      ['Carlo Mendoza', 'carlo.mendoza@example.com', '09171230003', '2001-07-21', 30, 'pending', ''],
      ['Ramon Dizon', 'ramon.dizon@example.com', '09171230004', '1975-01-09', 72, 'approved', ''],
      ['Teresa Villanueva', 'teresa.v@example.com', '09171230005', '1992-05-30', 96, 'rejected', 'The name on the ID does not match your registration.']
    ];
    ls.set(K.users, rows.map(function (r, i) {
      return { id: 'usr_seed' + (i + 1), citizenId: 'RES-2026-' + (101 + i), name: r[0], email: r[1], password: 'demo1234!', phone: r[2], dob: r[3],
        createdAt: ago(r[4]), role: 'resident', emailVerified: true, status: r[5], note: r[6], decidedAt: r[5] === 'pending' ? null : ago(r[4] - 2),
        idFileName: 'valid-id-' + r[0].split(' ')[0].toLowerCase() + '.jpg', idData: svgId(r[0], r[3]) };
    }));
    ls.set(K.seeded, 1);
  }
  function allUsers() {
    seedDemo();
    var pw = ls.get(K.pw, {});
    return SEEDS.concat(ls.get(K.users, [])).map(function (u) {
      return pw[u.email.toLowerCase()] ? Object.assign({}, u, { password: pw[u.email.toLowerCase()] }) : u;
    });
  }
  function findUser(id) {
    id = String(id || '').trim().toLowerCase();
    return allUsers().filter(function (u) { return u.email.toLowerCase() === id || u.citizenId.toLowerCase() === id; })[0];
  }
  function pub(u) { return { id: u.id, citizenId: u.citizenId, name: u.name, email: u.email, role: u.role }; }
  function pubRes(u) {
    return { id: u.id, citizenId: u.citizenId, name: u.name, email: u.email, phone: u.phone, dob: u.dob, createdAt: u.createdAt, status: u.status,
      note: u.note || '', decidedAt: u.decidedAt || null, idFileName: u.idFileName || '', idData: u.idData || null };
  }
  function taken(u) { return !!u && (u.status === 'approved' || (u.status === 'pending' && u.emailVerified)); } // rejected / unverified may register again
  function readId(file) {
    return new Promise(function (res) {
      if (!file || file.size > 1.2 * 1024 * 1024) return res(null);   // keep localStorage small in demo mode
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(null); }; r.readAsDataURL(file);
    });
  }

  var mock = {
    login: function (id, password) {
      return sleep(300).then(function () {
        var u = findUser(id);
        if (!u || !u.emailVerified || u.password !== password) throw fail(401);
        if (u.status === 'pending') { var p = fail(403); p.code = 'pending'; throw p; }
        if (u.status === 'rejected') { var r = fail(403); r.code = 'rejected'; r.reason = u.note || ''; throw r; }
        return save(pub(u), 'mock-token-' + u.id);
      });
    },
    emailTaken: function (email) { return Promise.resolve(taken(findUser(email))); },
    register: function (d) {
      return readId(d.idFile).then(function (idData) {
        if (taken(findUser(d.email))) throw fail(409);
        var list = ls.get(K.users, []).filter(function (x) { return x.email.toLowerCase() !== d.email.toLowerCase(); });
        list.push({ id: 'usr_' + Date.now(), citizenId: 'RES-2026-' + String(Math.floor(Math.random() * 9000) + 1000), name: d.name, email: d.email,
          password: d.password, phone: d.phone, dob: d.dob, createdAt: new Date().toISOString(), role: 'resident', emailVerified: false,
          status: 'pending', note: '', decidedAt: null, idFileName: d.idFile ? d.idFile.name : '', idData: idData });
        if (!ls.set(K.users, list)) { list[list.length - 1].idData = null; ls.set(K.users, list); }
        return { ok: true };
      });
    },
    verifyOtp: function (email, code, purpose) {
      return sleep(250).then(function () {
        if (code !== C.MOCK_OTP) throw fail(400);
        if (purpose === 'reset') return { resetToken: 'mock-reset-' + Date.now() };
        var list = ls.get(K.users, []), u = list.filter(function (x) { return x.email.toLowerCase() === email.toLowerCase(); })[0];
        if (!u) throw fail(404);
        u.emailVerified = true; ls.set(K.users, list);
        return { pending: true };        // NO session: the resident must wait for admin approval
      });
    },
    profile: function () {
      return sleep(120).then(function () {
        var s = current(), u = s && allUsers().filter(function (x) { return x.id === s.user.id; })[0];
        if (!u) throw fail(404);
        var p = pubRes(u); p.role = u.role; return p;
      });
    },
    forgotPassword: function () { return sleep(250).then(function () { return { ok: true }; }); },
    resendOtp: function () { return sleep(150).then(function () { return { ok: true }; }); },
    resetPassword: function (email, password) {
      return sleep(250).then(function () {
        if (!findUser(email)) return { ok: true };            // don't reveal whether the account exists
        var pw = ls.get(K.pw, {}); pw[email.toLowerCase()] = password; ls.set(K.pw, pw);
        return { ok: true };
      });
    },
    residents: {
      list: function () {
        return sleep(150).then(function () {
          return allUsers().filter(function (u) { return u.role === 'resident' && u.emailVerified; })
            .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).map(pubRes);
        });
      },
      decide: function (id, status, reason) {
        return sleep(200).then(function () {
          var list = ls.get(K.users, []), u = list.filter(function (x) { return x.id === id; })[0];
          if (!u) throw fail(404);
          u.status = status; u.note = status === 'rejected' ? (reason || '') : ''; u.decidedAt = new Date().toISOString();
          ls.set(K.users, list);
          // real backend: also send the resident an email + SMS (approved / rejected with reason)
          return pubRes(u);
        });
      }
    }
  };

  /* ---------- public API (same shape for mock and real) ---------- */
  var Auth = {
    current: current, authHeader: authHeader, dashboardUrl: dashboardUrl, verify: verify, expire: expire,
    setNext: setNext, takeNext: takeNext, requireSession: requireSession, logout: logout,

    login: function (id, password) {
      if (C.USE_MOCK) return mock.login(id, password);
      return api('POST', '/auth/login', { id: id, password: password }).then(function (r) { return save(r.user, r.token, r.csrfToken); });
    },
    emailTaken: function (email) { return C.USE_MOCK ? mock.emailTaken(email) : Promise.resolve(false); }, // real API answers 409 on register
    register: function (d) {
      if (C.USE_MOCK) return mock.register(d);
      var f = new FormData();
      ['email', 'password', 'name', 'dob', 'phone'].forEach(function (k) { f.append(k, d[k]); });
      if (d.idFile) f.append('valid_id', d.idFile);
      return api('POST', '/auth/register', f, true);
    },
    verifyOtp: function (email, code, purpose) {
      if (C.USE_MOCK) return mock.verifyOtp(email, code, purpose);
      return api('POST', '/auth/verify-otp', { email: email, code: code, purpose: purpose }).then(function (r) {
        return r;   // register: { pending:true } -- no session until an admin approves the resident
      });
    },
    forgotPassword: function (email) { return C.USE_MOCK ? mock.forgotPassword(email) : api('POST', '/auth/forgot-password', { email: email }); },
    resendOtp: function (email, mode) { return C.USE_MOCK ? mock.resendOtp() : api('POST', '/auth/resend-otp', { email: email, purpose: mode === 'reset' ? 'reset' : 'register' }); },
    /* full profile of the signed-in user (real API: GET /auth/me) */
    profile: function () { return C.USE_MOCK ? mock.profile() : api('GET', '/auth/me'); },
    /* admin only: approve / reject new resident registrations */
    residents: {
      list: function () { return C.USE_MOCK ? mock.residents.list() : api('GET', '/admin/residents').then(function (r) { return r.data || r; }); },
      decide: function (id, status, reason) {
        return C.USE_MOCK ? mock.residents.decide(id, status, reason) : api('PATCH', '/admin/residents/' + encodeURIComponent(id), { status: status, reason: reason });
      }
    },
    resetPassword: function (email, password, resetToken) {
      return C.USE_MOCK ? mock.resetPassword(email, password) : api('POST', '/auth/reset-password', { email: email, password: password, resetToken: resetToken });
    }
  };
  window.Auth = Auth;
})();
