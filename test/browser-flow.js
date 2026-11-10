/* Optional real-browser check of the whole workflow (needs Playwright + Chromium). Run: node test/browser-flow.js */
'use strict';
const assert = require('node:assert/strict');
const { startServer, JPEG, ts } = require('./helpers');
const { hashPassword } = require('../server/security');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

(async () => {
  const S = await startServer();
  const now = ts(), h = await hashPassword('Adm1n!Secret');
  S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, role, account_status, email_verified, created_at, updated_at) VALUES ('ADM-0001','Ana Reyes','admin@barangaydocs.gov.ph',?, 'admin','approved',1,?,?)").run(h, now, now);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const errors = [], shot = (p, n) => p.screenshot({ path: '/tmp/shot-' + n + '.png' });
  const mk = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(String(e))); return p; };
  const step = m => console.log('✓ ' + m);
  try {
    const u = await mk();
    await u.goto(S.base + '/#register');
    await u.fill('#r-email', 'maria@example.com'); await u.fill('#r-pw', 'Str0ng!Pass'); await u.fill('#r-pw2', 'Str0ng!Pass'); await u.click('#reg1-next');
    await u.fill('#r-name', 'Maria Clara Santos'); await u.fill('#r-dob', '1990-05-17'); await u.fill('#r-phone', '09171234567');
    await u.setInputFiles('#r-id', { name: 'id.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await u.click('#reg2-form button[type=submit]');
    await u.waitForSelector('#view-otp.active'); step('registered; OTP screen shown');
    await u.waitForFunction(() => document.querySelector('#resend').disabled === true);
    const code = S.mail.otpFor('maria@example.com'); assert.match(code, /^\d{6}$/); step('real OTP email captured at provider');
    const boxes = await u.$$('#otp input');
    for (let i = 0; i < 6; i++) await boxes[i].fill(code[i]);   // wrong first
    await boxes[5].fill(code[5] === '1' ? '2' : '1'); await u.click('#verify');
    await u.waitForSelector('#otp-error', { state: 'visible' }); step('wrong OTP rejected in UI: ' + (await u.textContent('#otp-error')));
    await boxes[5].fill(code[5]); await u.click('#verify');
    await u.waitForSelector('#view-done.active'); await shot(u, 'done'); step('OTP verified; "wait for admin approval" screen');
    await u.goto(S.base + '/#login'); await u.fill('#l-id', 'maria@example.com'); await u.fill('#l-pw', 'Str0ng!Pass'); await u.click('#login-btn');
    await u.waitForSelector('#login-banner.show'); const t = await u.textContent('#login-banner'); assert.match(t, /waiting for barangay admin approval/); step('pending user blocked at login'); await shot(u, 'pending');

    const a = await mk(); await a.goto(S.base + '/#login'); await a.fill('#l-id', 'admin@barangaydocs.gov.ph'); await a.fill('#l-pw', 'Adm1n!Secret'); await a.click('#login-btn');
    await a.waitForURL(/app\.html#\/admin/); await a.waitForSelector('text=Staff console, text=Resident', { timeout: 8000 }).catch(() => {}); step('admin signed in -> admin dashboard');
    await a.goto(S.base + '/app.html#/admin/residents'); await a.waitForSelector('text=Maria Clara Santos'); await shot(a, 'admin-queue'); step('admin sees pending account');
    await a.click('text=Maria Clara Santos'); await a.waitForSelector('text=Verification Checklist');
    await a.waitForSelector('img.idimg'); assert.match(await a.getAttribute('img.idimg', 'src'), /\/api\/v1\/admin\/residents\/\d+\/id-file/); step('private valid-ID preview loads for admin');
    for (let i = 0; i < 4; i++) await a.locator('.ckr input').nth(i).check();   // portal re-renders after each tick
    await a.click('button:has-text("Approve resident")'); await a.click('.mod button:has-text("Approve resident")');
    await a.waitForSelector('.flash'); step('admin approved: ' + (await a.textContent('.flash'))); await shot(a, 'admin-approved');
    assert.equal(S.mail.last('maria@example.com').subject, 'Your Account Has Been Approved'); step('approval email delivered');

    await u.goto(S.base + '/#login'); await u.fill('#l-id', 'maria@example.com'); await u.fill('#l-pw', 'Str0ng!Pass'); await u.click('#login-btn');
    await u.waitForURL(/app\.html#\/resident/); await u.waitForSelector('text=Maria'); await shot(u, 'resident'); step('resident logged in -> resident dashboard');
    await u.goto(S.base + '/app.html#/admin/residents'); await u.waitForTimeout(800);
    assert.ok(!(await u.content()).includes('Registration Queue')); step('resident cannot open admin pages (UI guard)');
    const r = await u.evaluate(async () => (await fetch('/api/v1/admin/residents', { credentials: 'include' })).status); assert.equal(r, 403); step('…and the API answers 403 to the resident');
    const bell = await u.evaluate(async () => (await fetch('/api/v1/notifications', { credentials: 'include' })).status); assert.equal(bell, 200);
    await u.goto(S.base + '/app.html#/resident'); await u.evaluate(() => Auth.logout()); await u.waitForURL(/index\.html#home/);
    assert.equal(await u.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'include' })).status), 401); step('logout kills the server session');
    await u.goto(S.base + '/app.html#/resident'); await u.waitForURL(/index\.html#login/); step('private page after logout -> bounced to sign in');
    assert.deepEqual(errors, [], 'no uncaught JS errors'); step('no JavaScript errors in any page');
  } finally { await browser.close(); S.close(); }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
