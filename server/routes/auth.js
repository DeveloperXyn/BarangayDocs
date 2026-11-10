'use strict';
const { ts, iso } = require('../db');
const { HttpError, json } = require('../http');
const sec = require('../security');
const storage = require('../storage');
const otp = require('../services/otp');
const sessions = require('../services/sessions');
const { audit, limit } = require('../services/common');
const tpl = require('../mailer/templates');

const HOUR = 3600e3, MIN15 = 900e3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = v => String(v || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && EMAIL_RE.test(e);
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

module.exports = function authRoutes({ config: cfg, db, mailer, limiter, log }) {
  const mailDown = () => new HttpError(503, 'mail_not_configured', 'Email delivery is not configured on the server. Please contact the administrator.');

  /* creates a code and e-mails it. A failed send removes the code so the user can retry immediately. */
  async function sendOtp(email, name, purpose, ip) {
    const { code, id } = await otp.issue(db, cfg, email, purpose, ip);
    try { await mailer.send(Object.assign({ to: email }, tpl.otpEmail({ name, code, ttlMin: cfg.otp.ttlMin, purpose }))); }
    catch (e) {
      await otp.discard(db, id); limiter.reset('resend:' + purpose + ':' + email); log.error('[mail] OTP email failed (' + e.code + ')');
      throw new HttpError(502, 'email_send_failed', 'We could not send the verification email. Please try again in a moment.');
    }
  }
  const pubUser = u => ({ id: String(u.id), citizenId: u.citizen_id, name: u.full_name, email: u.email, role: u.role });

  async function register(ctx) {
    const { ip } = ctx;
    limit(limiter, 'reg:ip:' + ip, 10, HOUR);
    if (!mailer.isConfigured()) throw mailDown();
    const f = ctx.fields, file = ctx.files.valid_id;
    const email = normEmail(f.email), name = cleanName(f.name), dob = String(f.dob || '').trim(), phone = String(f.phone || '').replace(/\s/g, ''), password = String(f.password || '');
    const errors = {};
    if (!validEmail(email)) errors.email = 'Enter a valid email address.';
    if (!sec.isStrongPassword(password)) errors.password = 'Use at least 8 characters with upper and lower case letters, a number and a symbol.';
    if (name.split(' ').length < 2 || name.length > 120) errors.name = 'Enter your full name (first and last name).';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? new Date(dob + 'T00:00:00Z') : null;
    if (!d || isNaN(d) || d > new Date() || d.getUTCFullYear() < 1900 || d.toISOString().slice(0, 10) !== dob) errors.dob = 'Enter a valid date of birth.';
    else { const now = new Date(), t18 = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate())); if (t18 > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) errors.dob = 'You must be at least 18 years old to register.'; }
    if (!/^09\d{9}$/.test(phone)) errors.phone = 'Enter a valid mobile number (09XX XXX XXXX).';
    let type = null;
    if (!file) errors.valid_id = 'Upload a valid ID.';
    else if (file.data.length > 5 * 1024 * 1024) errors.valid_id = 'File is larger than 5 MB.';
    else if (!(type = storage.detect(file.data))) errors.valid_id = 'Use a JPG, PNG or PDF file.';
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields: errors });

    const taken = await db.get("SELECT id FROM users WHERE email=? AND (role<>'resident' OR account_status='approved' OR (account_status='pending' AND email_verified=1))", [email]);
    if (taken) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
    limit(limiter, 'reg:email:' + email, 5, HOUR);
    limit(limiter, 'resend:register:' + email, 1, cfg.otp.cooldownSec * 1000, 'otp_cooldown', 'Please wait before requesting another code.');
    await otp.gate(db, cfg, email, 'register');

    const passwordHash = await sec.hashPassword(password);
    const stored = await storage.saveId(cfg.uploadDir, file.data, type);
    const idName = cleanName(file.filename.split(/[\\/]/).pop()).slice(0, 120) || 'valid-id' + type.ext;
    let oldFile = null;
    try {
      await db.tx(async q => {
        const now = ts(), ex = await q.get('SELECT id, role, account_status, email_verified, id_file_path FROM users WHERE email=?', [email]);
        let userId;
        if (ex) {
          if (ex.role !== 'resident' || ex.account_status === 'approved' || (ex.account_status === 'pending' && ex.email_verified)) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
          // an unverified or rejected registration may be re-submitted
          userId = ex.id; oldFile = ex.id_file_path;
          await q.run("UPDATE users SET full_name=?, password_hash=?, phone=?, date_of_birth=?, id_file_path=?, id_file_name=?, account_status='pending', email_verified=0, email_verified_at=NULL, rejection_reason=NULL, rejected_at=NULL, rejected_by=NULL, approved_at=NULL, approved_by=NULL, created_at=?, updated_at=? WHERE id=?",
            [name, passwordHash, phone, dob, stored, idName, now, now, userId]);
        } else {
          const r = await q.run("INSERT INTO users (full_name, email, password_hash, phone, date_of_birth, role, account_status, email_verified, id_file_path, id_file_name, created_at, updated_at) VALUES (?,?,?,?,?,'resident','pending',0,?,?,?,?)",
            [name, email, passwordHash, phone, dob, stored, idName, now, now]);
          userId = r.insertId;
          await q.run('UPDATE users SET citizen_id=? WHERE id=?', ['RES-' + new Date().getUTCFullYear() + '-' + String(userId).padStart(4, '0'), userId]);
        }
        await audit(q, { action: 'account.registered', target: userId, ip });
      });
    } catch (e) {
      await storage.removeId(cfg.uploadDir, stored);
      if (e.code === 'DUPLICATE_KEY') throw new HttpError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
      throw e;
    }
    await storage.removeId(cfg.uploadDir, oldFile);
    await sendOtp(email, name, 'register', ip);
    return json(201, { ok: true, email, expiresInSec: cfg.otp.ttlMin * 60, resendAfterSec: cfg.otp.cooldownSec });
  }

  async function verifyOtp(ctx) {
    const b = ctx.body || {}, email = normEmail(b.email), code = String(b.code || ''), purpose = b.purpose === 'reset' ? 'reset' : 'register';
    limit(limiter, 'otp:ip:' + ctx.ip, 30, MIN15);
    limit(limiter, 'otp:email:' + email, 15, MIN15);
    if (!validEmail(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, 'otp_invalid', 'Enter the 6-digit code.');
    const row = await otp.check(db, cfg, email, purpose, code);
    if (purpose === 'register') {
      await db.tx(async q => {
        const now = ts(), r = await q.run('UPDATE email_otps SET verified_at=? WHERE id=? AND verified_at IS NULL', [now, row.id]);
        if (r.affectedRows !== 1) throw new HttpError(400, 'otp_invalid', 'That code is invalid or has expired. Request a new code.');
        const u = await q.get("SELECT id FROM users WHERE email=? AND role='resident'", [email]);
        if (!u) throw new HttpError(400, 'otp_invalid', 'That code is invalid or has expired. Request a new code.');
        await q.run('UPDATE users SET email_verified=1, email_verified_at=?, updated_at=? WHERE id=?', [now, now, u.id]);   // status stays 'pending'
        await audit(q, { action: 'email.verified', target: u.id, ip: ctx.ip });
      });
      return json(200, { pending: true });
    }
    const u = await db.get('SELECT id FROM users WHERE email=? AND email_verified=1', [email]);
    if (!u) throw new HttpError(400, 'otp_invalid', 'That code is invalid or has expired. Request a new code.');
    const resetToken = sec.randomToken(32), now = new Date();
    await db.tx(async q => {
      await q.run('UPDATE email_otps SET verified_at=? WHERE id=? AND verified_at IS NULL', [ts(now), row.id]);
      await q.run('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL', [ts(now), u.id]);
      await q.run('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)', [u.id, sec.sha256(resetToken), ts(new Date(now.getTime() + 600e3)), ts(now)]);
    });
    return json(200, { resetToken });
  }

  async function resendOtp(ctx) {
    const b = ctx.body || {}, email = normEmail(b.email), purpose = b.purpose === 'reset' ? 'reset' : 'register';
    limit(limiter, 'resend:ip:' + ctx.ip, 20, HOUR);
    if (!validEmail(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address.');
    if (!mailer.isConfigured()) throw mailDown();
    // identical limits whether or not the account exists, so this endpoint reveals nothing
    limit(limiter, 'resend:' + purpose + ':' + email, 1, cfg.otp.cooldownSec * 1000, 'otp_cooldown', 'Please wait before requesting another code.');
    limit(limiter, 'resend:hour:' + purpose + ':' + email, cfg.otp.maxPerHour, HOUR, 'otp_limit', 'Too many codes requested. Try again later.');
    const u = await db.get('SELECT id, full_name, role, email_verified FROM users WHERE email=?', [email]);
    const eligible = u && (purpose === 'register' ? (u.role === 'resident' && !u.email_verified) : !!u.email_verified);
    if (!eligible) return json(204, null);
    await otp.gate(db, cfg, email, purpose);
    await sendOtp(email, u.full_name, purpose, ctx.ip);
    return json(204, null);
  }

  async function login(ctx) {
    const b = ctx.body || {}, id = b.id, password = b.password;
    if (typeof id !== 'string' || typeof password !== 'string' || !id.trim() || !password || password.length > 128 || id.length > 254) throw new HttpError(400, 'bad_request', 'Enter your email and password.');
    const key = id.trim().toLowerCase();
    limit(limiter, 'login:ip:' + ctx.ip, 60, MIN15);
    limit(limiter, 'login:id:' + key, 10, MIN15);
    const u = key.includes('@') ? await db.get('SELECT * FROM users WHERE email=?', [key]) : await db.get('SELECT * FROM users WHERE citizen_id=?', [key.toUpperCase()]);
    const ok = await sec.verifyPassword(password, u && u.password_hash);
    if (!u || !ok) { await audit(db, { action: 'login.failed', target: u ? u.id : null, ip: ctx.ip }); throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.'); }
    // Account state is only revealed AFTER the password was proven correct.
    if (!u.email_verified) throw new HttpError(403, 'unverified', 'Please verify your email address first.', { email: u.email });
    if (u.account_status === 'pending') throw new HttpError(403, 'pending', 'Your account is awaiting administrator approval.');
    if (u.account_status === 'rejected') throw new HttpError(403, 'rejected', 'Your registration was not approved.', { reason: u.rejection_reason || '' });
    limiter.reset('login:id:' + key);
    const s = await sessions.create(db, cfg, u.id, ctx.ip, ctx.req.headers['user-agent']);
    await audit(db, { actor: u.id, action: 'login.success', target: u.id, ip: ctx.ip });
    return json(200, { user: pubUser(u), csrfToken: s.csrf }, { cookies: [sessions.cookie(cfg, s.token)] });
  }

  async function logout(ctx) {
    if (ctx.session) { await sessions.destroy(db, ctx.session.sid); await audit(db, { actor: ctx.session.user.id, action: 'logout', target: ctx.session.user.id, ip: ctx.ip }); }
    return json(204, null, { cookies: [sessions.cookie(cfg, '', true)] });
  }

  async function me(ctx) {
    const u = ctx.session.user;
    return json(200, Object.assign(pubUser(u), { phone: u.phone || '', dob: u.date_of_birth || '', createdAt: iso(u.created_at), status: u.account_status, idFileName: u.id_file_name || '', csrfToken: ctx.session.csrf }));
  }

  async function forgot(ctx) {
    const email = normEmail((ctx.body || {}).email);
    limit(limiter, 'forgot:ip:' + ctx.ip, 10, HOUR);
    if (!validEmail(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address.');
    if (!mailer.isConfigured()) throw mailDown();
    limit(limiter, 'resend:reset:' + email, 1, cfg.otp.cooldownSec * 1000, 'otp_cooldown', 'Please wait before requesting another code.');
    limit(limiter, 'resend:hour:reset:' + email, cfg.otp.maxPerHour, HOUR, 'otp_limit', 'Too many codes requested. Try again later.');
    const u = await db.get('SELECT full_name FROM users WHERE email=? AND email_verified=1', [email]);
    if (u) { try { await otp.gate(db, cfg, email, 'reset'); await sendOtp(email, u.full_name, 'reset', ctx.ip); } catch (e) { log.error('[auth] reset code not sent (' + (e.code || e.message) + ')'); } }
    return json(204, null);   // identical answer whether or not the account exists
  }

  async function reset(ctx) {
    const b = ctx.body || {}, email = normEmail(b.email), token = String(b.resetToken || '');
    limit(limiter, 'reset:ip:' + ctx.ip, 20, MIN15);
    if (!sec.isStrongPassword(b.password)) throw new HttpError(422, 'validation_failed', 'Password does not meet the requirements.', { fields: { password: 'Use at least 8 characters with upper and lower case letters, a number and a symbol.' } });
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'invalid_reset_token', 'This reset link has expired. Request a new code.');
    const hash = await sec.hashPassword(b.password);
    await db.tx(async q => {
      const now = ts();
      const r = await q.get('SELECT p.id, p.user_id FROM password_resets p JOIN users u ON u.id=p.user_id WHERE p.token_hash=? AND u.email=? AND p.used_at IS NULL AND p.expires_at>?', [sec.sha256(token), email, now]);
      if (!r) throw new HttpError(400, 'invalid_reset_token', 'This reset link has expired. Request a new code.');
      const used = await q.run('UPDATE password_resets SET used_at=? WHERE id=? AND used_at IS NULL', [now, r.id]);
      if (used.affectedRows !== 1) throw new HttpError(400, 'invalid_reset_token', 'This reset link has expired. Request a new code.');
      await q.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [hash, now, r.user_id]);
      await sessions.destroyAllFor(q, r.user_id);   // sign out everywhere
      await audit(q, { actor: r.user_id, action: 'password.reset', target: r.user_id, ip: ctx.ip });
    });
    return json(204, null);
  }

  return [
    { method: 'POST', path: '/auth/register', multipart: true, handler: register },
    { method: 'POST', path: '/auth/verify-otp', handler: verifyOtp },
    { method: 'POST', path: '/auth/resend-otp', handler: resendOtp },
    { method: 'POST', path: '/auth/login', handler: login },
    { method: 'POST', path: '/auth/logout', handler: logout },
    { method: 'GET', path: '/auth/me', auth: 'user', handler: me },
    { method: 'POST', path: '/auth/forgot-password', handler: forgot },
    { method: 'POST', path: '/auth/reset-password', handler: reset }
  ];
};
