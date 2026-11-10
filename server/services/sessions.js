'use strict';
const { ts } = require('../db');
const { randomToken, sha256 } = require('../security');
const COOKIE = 'bd_sid';

async function create(db, cfg, userId, ip, ua) {
  const token = randomToken(32), csrf = randomToken(24), now = new Date();
  await db.run('INSERT INTO sessions (id, user_id, csrf_token, ip_address, user_agent, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
    [sha256(token), userId, csrf, ip, String(ua || '').slice(0, 255), ts(now), ts(now), ts(new Date(now.getTime() + cfg.sessionHours * 3600e3))]);
  return { token, csrf };
}
/* A session is only valid while the user is STILL an approved, email-verified account (revocation is immediate). */
async function load(db, token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const sid = sha256(token);
  const r = await db.get('SELECT u.*, s.csrf_token AS csrf_token FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id=? AND s.expires_at>?', [sid, ts()]);
  if (!r) return null;
  if (r.account_status !== 'approved' || !r.email_verified) { await destroy(db, sid); return null; }
  return { sid, csrf: r.csrf_token, user: r };
}
const destroy = (db, sid) => db.run('DELETE FROM sessions WHERE id=?', [sid]);
const destroyAllFor = (db, userId) => db.run('DELETE FROM sessions WHERE user_id=?', [userId]);
const purgeExpired = db => db.run('DELETE FROM sessions WHERE expires_at<=?', [ts()]);
function cookie(cfg, token, clear) {
  const a = [COOKIE + '=' + (clear ? '' : token), 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' + (clear ? 0 : cfg.sessionHours * 3600)];
  if (cfg.cookieSecure) a.push('Secure');
  return a.join('; ');
}
module.exports = { COOKIE, create, load, destroy, destroyAllFor, purgeExpired, cookie };
