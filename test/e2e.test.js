'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, register, goodFields, JPEG, multipart, ts } = require('./helpers');
const { hashPassword } = require('../server/security');
const API = '/api/v1';
const PW = 'Str0ng!Pass';

describe('BarangayDocs auth workflow', () => {
  let S, user, admin;
  const email = 'maria@example.com';
  const backdateOtps = () => S.db.raw.exec("UPDATE email_otps SET created_at='2000-01-01 00:00:00'");
  const resetLimits = () => { S.app.limiter.m.clear(); };

  before(async () => {
    S = await startServer(); user = new Client(S.base); admin = new Client(S.base);
    const h = await hashPassword('Adm1n!Secret'), now = ts();
    S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, role, account_status, email_verified, created_at, updated_at) VALUES ('ADM-0001','Ana Reyes','admin@barangaydocs.gov.ph',?, 'admin','approved',1,?,?)").run(h, now, now);
  });
  after(() => S.close());

  test('registration is refused with a clear error when email is not configured', async () => {
    const T = await startServer({ mailConfigured: false });
    const r = await register(new Client(T.base), goodFields());
    assert.equal(r.status, 503); assert.equal(r.data.code, 'mail_not_configured');
    assert.equal(T.db.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 0); T.close();
  });

  test('registration validation (weak password, bad email, bad file, missing file, role injection ignored)', async () => {
    const c = new Client(S.base);
    let r = await register(c, goodFields({ password: 'weak', email: 'nope' }));
    assert.equal(r.status, 422); assert.ok(r.data.fields.password && r.data.fields.email);
    r = await register(c, goodFields(), { name: 'id.jpg', type: 'image/jpeg', data: Buffer.from('<?php echo 1; ?>') });
    assert.equal(r.status, 422); assert.ok(r.data.fields.valid_id);
    r = await register(c, goodFields(), null); assert.equal(r.status, 422);
    r = await register(c, goodFields({ dob: new Date(Date.now() - 17 * 365 * 86400000).toISOString().slice(0, 10) })); assert.equal(r.status, 422); assert.match(r.data.fields.dob, /18/, 'minors cannot register');
    assert.equal(S.db.raw.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get(email).n, 0);
  });

  test('1-2. user registers and receives a real OTP email; OTP/password are never returned or stored in plaintext', async () => {
    const r = await register(user, goodFields({ role: 'admin' }));
    assert.equal(r.status, 201);
    const m = S.mail.last(email); assert.ok(m, 'email delivered to provider');
    assert.equal(m.from, 'noreply@test.local'); assert.match(m.subject, /verification code/i);
    assert.match(m.html, /expires in <b>5 minutes/); assert.match(m.html, /Security notice/);
    const code = S.mail.otpFor(email); assert.match(code, /^\d{6}$/);
    assert.ok(!r.text.includes(code), 'OTP must not be in the API response');
    const row = S.db.raw.prepare('SELECT * FROM users WHERE email=?').get(email);
    assert.equal(row.role, 'resident', 'self-registration can never create an admin');
    assert.equal(row.account_status, 'pending'); assert.equal(row.email_verified, 0);
    assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(PW));
    assert.match(row.citizen_id, /^RES-\d{4}-\d{4}$/);
    const o = S.db.raw.prepare('SELECT * FROM email_otps WHERE email=?').get(email);
    assert.ok(o.otp_hash.length === 64 && o.otp_hash !== code);
  });

  test('duplicate registration while unverified is rate-limited; unverified login is blocked after password check', async () => {
    let r = await user.login(email, PW); assert.equal(r.status, 403); assert.equal(r.data.code, 'unverified');
    const wrong = await user.login(email, 'Wrong!Pass1'), none = await user.login('ghost@example.com', 'Wrong!Pass1');
    assert.equal(wrong.status, 401); assert.equal(none.status, 401);
    assert.deepEqual(wrong.data, none.data, 'wrong password and unknown email look identical');
    r = await register(user, goodFields()); assert.equal(r.status, 429);   // OTP resend cooldown
  });

  test('invalid OTP, attempt limit, resend cooldown, expiry', async () => {
    const c = new Client(S.base), old = S.mail.otpFor(email);
    const wrongCode = old === '000000' ? '111111' : '000000';
    let r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: wrongCode, purpose: 'register' } });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'otp_invalid'); assert.equal(r.data.attemptsLeft, 4);
    r = await c.req('POST', API + '/auth/resend-otp', { json: { email, purpose: 'register' } });
    assert.equal(r.status, 429); assert.equal(r.data.code, 'otp_cooldown');
    // exhaust attempts
    for (let i = 0; i < 4; i++) r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: wrongCode, purpose: 'register' } });
    assert.equal(r.data.attemptsLeft, 0);
    r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: old, purpose: 'register' } });
    assert.equal(r.status, 400, 'even the right code is refused after the attempt limit');
    // resend after cooldown -> new code, old code dead
    backdateOtps(); resetLimits();
    r = await c.req('POST', API + '/auth/resend-otp', { json: { email, purpose: 'register' } }); assert.equal(r.status, 204);
    const fresh = S.mail.otpFor(email); assert.equal(S.mail.messages.filter(m => m.to === email).length, 2);
    // expiry
    S.db.raw.exec("UPDATE email_otps SET expires_at='2000-01-01 00:00:00' WHERE invalidated_at IS NULL");
    r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: fresh, purpose: 'register' } });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'otp_expired');
    backdateOtps(); resetLimits();
    await c.req('POST', API + '/auth/resend-otp', { json: { email, purpose: 'register' } });
  });

  test('3-4. correct OTP verifies the email but the account stays pending; login is blocked', async () => {
    const c = new Client(S.base);
    const r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: S.mail.otpFor(email), purpose: 'register' } });
    assert.equal(r.status, 200); assert.equal(r.data.pending, true);
    const row = S.db.raw.prepare('SELECT * FROM users WHERE email=?').get(email);
    assert.equal(row.email_verified, 1); assert.equal(row.account_status, 'pending');
    const again = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: S.mail.otpFor(email), purpose: 'register' } });
    assert.equal(again.status, 400, 'a code cannot be used twice');
    const l = await user.login(email, PW); assert.equal(l.status, 403); assert.equal(l.data.code, 'pending');
    assert.equal((await register(c, goodFields())).status, 409, 'verified email cannot be registered again');
  });

  test('10. unauthorized access to admin endpoints and private files is rejected', async () => {
    const anon = new Client(S.base);
    assert.equal((await anon.req('GET', API + '/admin/residents')).status, 401);
    assert.equal((await anon.req('PATCH', API + '/admin/residents/2', { json: { status: 'approved' } })).status, 401);
    assert.equal((await anon.req('GET', API + '/auth/me')).status, 401);
    assert.equal((await anon.req('GET', '/js/portal.js')).status, 401);
    for (const p of ['/server/config.js', '/.env', '/database/schema.sql', '/package.json', '/server.js', '/storage/ids/x.jpg', '/scripts/create-admin.js'])
      assert.equal((await anon.req('GET', p)).status, 404, p);
    assert.equal((await anon.req('GET', '/js/auth.js')).status, 200);
    assert.equal((await anon.req('GET', '/')).status, 200);
  });

  test('5. admin logs in and sees the pending account', async () => {
    let r = await admin.login('admin@barangaydocs.gov.ph', 'Adm1n!Secret'); assert.equal(r.status, 200); assert.equal(r.data.user.role, 'admin');
    assert.match(r.headers.get('set-cookie'), /HttpOnly/); assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
    r = await admin.req('GET', API + '/admin/residents'); assert.equal(r.status, 200);
    const m = r.data.data.find(x => x.email === email);
    assert.ok(m); assert.equal(m.status, 'pending'); assert.equal(m.emailVerified, true); assert.ok(m.createdAt && m.idUrl);
    assert.ok(!JSON.stringify(r.data).includes('password'));
    const f = await admin.req('GET', m.idUrl); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/jpeg');
    const anon = await new Client(S.base).req('GET', m.idUrl); assert.equal(anon.status, 401);
  });

  test('6-7. admin approves (CSRF enforced); approval is recorded and the user is emailed', async () => {
    const id = S.db.raw.prepare('SELECT id FROM users WHERE email=?').get(email).id;
    let r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'approved' }, csrf: false });
    assert.equal(r.status, 403); assert.equal(r.data.code, 'csrf_failed');
    r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'approved' }, headers: { Origin: 'http://evil.example' } });
    assert.equal(r.status, 403); assert.equal(r.data.code, 'bad_origin');
    r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'approved' } });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'approved'); assert.equal(r.data.emailSent, true);
    const row = S.db.raw.prepare('SELECT * FROM users WHERE id=?').get(id), adminId = S.db.raw.prepare("SELECT id FROM users WHERE role='admin'").get().id;
    assert.equal(row.account_status, 'approved'); assert.equal(row.approved_by, adminId); assert.ok(row.approved_at);
    const m = S.mail.last(email); assert.equal(m.subject, 'Your Account Has Been Approved'); assert.match(m.html, /now <b>approved/); assert.match(m.html, /index\.html#login/);
    assert.equal(S.db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='account.approved' AND actor_user_id=? AND target_user_id=?").get(adminId, id).n, 1);
    r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'rejected', reason: 'x' } }); assert.equal(r.status, 409, 'cannot decide twice');
  });

  test('8-9. user logs in, reaches the resident area, cannot reach admin endpoints', async () => {
    let r = await user.login(email, PW); assert.equal(r.status, 200); assert.equal(r.data.user.role, 'resident');
    const byCitizenId = await new Client(S.base).login(r.data.user.citizenId, PW); assert.equal(byCitizenId.status, 200);
    r = await user.req('GET', API + '/auth/me'); assert.equal(r.status, 200); assert.equal(r.data.status, 'approved'); assert.equal(r.data.name, 'Maria Clara Santos');
    assert.equal((await user.req('GET', '/js/portal.js')).status, 200);
    assert.equal((await user.req('GET', API + '/admin/residents')).status, 403);
    assert.equal((await user.req('PATCH', API + '/admin/residents/1', { json: { status: 'approved' } })).status, 403);
    assert.equal((await user.req('GET', API + '/admin/residents/1/id-file')).status, 403);
    r = await user.req('GET', API + '/notifications'); assert.equal(r.status, 200); assert.equal(r.data.unread_count, 1); assert.equal(r.data.data[0].type, 'account');
    r = await user.req('POST', API + '/notifications/read-all'); assert.equal(r.data.updated, 1);
  });

  test('logout invalidates the session on the server', async () => {
    const c = new Client(S.base); await c.login(email, PW); const stale = c.cookie;
    assert.equal((await c.req('POST', API + '/auth/logout')).status, 204);
    const r = await new Client(S.base).req('GET', API + '/auth/me', { headers: { Cookie: stale } });
    assert.equal(r.status, 401, 'the old cookie is dead even if a client keeps it');
  });

  test('rejection flow: reason required, user blocked, email sent, can re-register', async () => {
    const e2 = 'pedro@example.com', c = new Client(S.base);
    await register(c, goodFields({ email: e2, name: 'Pedro Reyes Santos' }));
    await c.req('POST', API + '/auth/verify-otp', { json: { email: e2, code: S.mail.otpFor(e2), purpose: 'register' } });
    const id = S.db.raw.prepare('SELECT id FROM users WHERE email=?').get(e2).id;
    let r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'rejected' } }); assert.equal(r.status, 422);
    r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'rejected', reason: 'ID is blurry.' } });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'rejected'); assert.equal(r.data.note, 'ID is blurry.');
    assert.match(S.mail.last(e2).html, /ID is blurry/);
    r = await c.login(e2, PW); assert.equal(r.status, 403); assert.equal(r.data.code, 'rejected'); assert.equal(r.data.reason, 'ID is blurry.');
    backdateOtps(); resetLimits();
    r = await register(c, goodFields({ email: e2, name: 'Pedro Reyes Santos' })); assert.equal(r.status, 201);
    const row = S.db.raw.prepare('SELECT * FROM users WHERE id=?').get(id);
    assert.equal(row.account_status, 'pending'); assert.equal(row.email_verified, 0); assert.equal(row.rejection_reason, null);
  });

  test('an account whose email is not verified cannot be approved', async () => {
    const e3 = 'liza@example.com', c = new Client(S.base);
    await register(c, goodFields({ email: e3, name: 'Liza Marie Gomez' }));
    const id = S.db.raw.prepare('SELECT id FROM users WHERE email=?').get(e3).id;
    assert.ok(!(await admin.req('GET', API + '/admin/residents')).data.data.some(x => x.email === e3), 'unverified registrations are not listed');
    const r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'approved' } });
    assert.equal(r.status, 409); assert.equal(r.data.code, 'email_not_verified');
  });

  test('email service failures: registration reports it and can be retried; approval still succeeds', async () => {
    const c = new Client(S.base), e4 = 'carlo@example.com';
    S.mail.failWith = 500;
    let r = await register(c, goodFields({ email: e4, name: 'Carlo Mendoza Jr' }));
    assert.equal(r.status, 502); assert.equal(r.data.code, 'email_send_failed');
    S.mail.failWith = 0;
    r = await register(c, goodFields({ email: e4, name: 'Carlo Mendoza Jr' })); assert.equal(r.status, 201, 'retry works right away');
    await c.req('POST', API + '/auth/verify-otp', { json: { email: e4, code: S.mail.otpFor(e4), purpose: 'register' } });
    const id = S.db.raw.prepare('SELECT id FROM users WHERE email=?').get(e4).id;
    S.mail.failWith = 500;
    r = await admin.req('PATCH', API + '/admin/residents/' + id, { json: { status: 'approved' } });
    S.mail.failWith = 0;
    assert.equal(r.status, 200); assert.equal(r.data.status, 'approved'); assert.equal(r.data.emailSent, false);
  });

  test('forgot / reset password: generic answer, OTP, one-time token, sessions revoked', async () => {
    const c = new Client(S.base), live = new Client(S.base); await live.login(email, PW); resetLimits();
    assert.equal((await c.req('POST', API + '/auth/forgot-password', { json: { email: 'ghost@example.com' } })).status, 204);
    assert.equal(S.mail.last('ghost@example.com'), undefined);
    assert.equal((await c.req('POST', API + '/auth/forgot-password', { json: { email } })).status, 204);
    let r = await c.req('POST', API + '/auth/verify-otp', { json: { email, code: S.mail.otpFor(email), purpose: 'reset' } });
    assert.equal(r.status, 200); const token = r.data.resetToken; assert.match(token, /^[a-f0-9]{64}$/);
    r = await c.req('POST', API + '/auth/reset-password', { json: { email, password: 'weak', resetToken: token } }); assert.equal(r.status, 422);
    r = await c.req('POST', API + '/auth/reset-password', { json: { email, password: 'N3w!Password', resetToken: token } }); assert.equal(r.status, 204);
    assert.equal((await c.req('POST', API + '/auth/reset-password', { json: { email, password: 'N3w!Password2', resetToken: token } })).status, 400, 'token is single-use');
    assert.equal((await live.req('GET', API + '/auth/me')).status, 401, 'existing sessions were revoked');
    assert.equal((await new Client(S.base).login(email, PW)).status, 401);
    assert.equal((await new Client(S.base).login(email, 'N3w!Password')).status, 200);
  });

  test('login rate limiting', async () => {
    resetLimits(); const c = new Client(S.base); let last;
    for (let i = 0; i < 11; i++) last = await c.login('victim@example.com', 'Wrong!Pass1');
    assert.equal(last.status, 429); assert.equal(last.data.code, 'rate_limited'); assert.ok(last.headers.get('retry-after'));
  });

  test('revoking an approved account cuts its active session immediately', async () => {
    resetLimits(); const c = new Client(S.base); await c.login('N3w!Password' && email, 'N3w!Password');
    assert.equal((await c.req('GET', API + '/auth/me')).status, 200);
    S.db.raw.prepare("UPDATE users SET account_status='rejected' WHERE email=?").run(email);
    assert.equal((await c.req('GET', API + '/auth/me')).status, 401);
  });
});
