'use strict';
const { ts } = require('../db');
const { generateOtp, hmac, safeEqual } = require('../security');
const { HttpError } = require('../http');
const hashOtp = (cfg, email, purpose, code) => hmac(cfg.secret, 'otp|' + purpose + '|' + email + '|' + code);
const parse = s => Date.parse(String(s).replace(' ', 'T') + 'Z');

/* resend cooldown + hourly cap, enforced from the database */
async function gate(db, cfg, email, purpose) {
  const last = await db.get('SELECT created_at FROM email_otps WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1', [email, purpose]);
  if (last) {
    const age = (Date.now() - parse(last.created_at)) / 1000;
    if (age < cfg.otp.cooldownSec) throw new HttpError(429, 'otp_cooldown', 'Please wait before requesting another code.', { retryAfter: Math.ceil(cfg.otp.cooldownSec - age) });
  }
  const c = await db.get('SELECT COUNT(*) AS n FROM email_otps WHERE email=? AND purpose=? AND created_at>?', [email, purpose, ts(new Date(Date.now() - 3600e3))]);
  if (Number(c.n) >= cfg.otp.maxPerHour) throw new HttpError(429, 'otp_limit', 'Too many codes requested. Try again later.', { retryAfter: 3600 });
}
/* invalidates older codes, stores only an HMAC of the new one. The plaintext is returned once, for the email. */
async function issue(q, cfg, email, purpose, ip) {
  const now = new Date(), code = generateOtp();
  await q.run('UPDATE email_otps SET invalidated_at=? WHERE email=? AND purpose=? AND verified_at IS NULL AND invalidated_at IS NULL', [ts(now), email, purpose]);
  const r = await q.run('INSERT INTO email_otps (email, purpose, otp_hash, expires_at, attempts, ip_address, created_at) VALUES (?,?,?,?,0,?,?)',
    [email, purpose, hashOtp(cfg, email, purpose, code), ts(new Date(now.getTime() + cfg.otp.ttlMin * 60000)), ip, ts(now)]);
  return { code, id: r.insertId };
}
const discard = (db, id) => db.run('DELETE FROM email_otps WHERE id=?', [id]).catch(() => {});

/* every guess consumes an attempt atomically BEFORE the comparison, so parallel guessing cannot exceed the limit */
async function check(db, cfg, email, purpose, code) {
  const bad = () => new HttpError(400, 'otp_invalid', 'That code is invalid or has expired. Request a new code.');
  const row = await db.get('SELECT * FROM email_otps WHERE email=? AND purpose=? AND verified_at IS NULL AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1', [email, purpose]);
  if (!row) throw bad();
  const now = ts();
  if (row.expires_at <= now) throw new HttpError(400, 'otp_expired', 'This code has expired. Request a new one.');
  const r = await db.run('UPDATE email_otps SET attempts=attempts+1 WHERE id=? AND attempts<? AND verified_at IS NULL AND invalidated_at IS NULL', [row.id, cfg.otp.maxAttempts]);
  if (r.affectedRows !== 1) throw new HttpError(429, 'otp_locked', 'Too many incorrect attempts. Request a new code.');
  if (!safeEqual(row.otp_hash, hashOtp(cfg, email, purpose, code))) {
    const left = cfg.otp.maxAttempts - (Number(row.attempts) + 1);
    if (left <= 0) await db.run('UPDATE email_otps SET invalidated_at=? WHERE id=?', [now, row.id]);
    throw new HttpError(400, 'otp_invalid', left > 0 ? 'That code is incorrect.' : 'Too many incorrect attempts. Request a new code.', { attemptsLeft: Math.max(left, 0) });
  }
  return row;
}
module.exports = { gate, issue, discard, check };
