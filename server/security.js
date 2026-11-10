'use strict';
const crypto = require('crypto');
const SCRYPT = { N: 32768, r: 8, p: 3 }, KEYLEN = 64, MAXMEM = 128 * 1024 * 1024;

const scrypt = (pw, salt, o) => new Promise((res, rej) => crypto.scrypt(pw, salt, KEYLEN, { N: o.N, r: o.r, p: o.p, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16), key = await scrypt(pw, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
let dummy;
async function verifyPassword(pw, stored) {
  if (!stored) { dummy = dummy || await hashPassword('dummy-password-for-timing'); stored = dummy; pw = pw + '!'; }   // equal work when the account does not exist
  const [alg, N, r, p, s, h] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'base64');
  const key = await scrypt(pw, Buffer.from(s, 'base64'), { N: +N, r: +r, p: +p });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const isStrongPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const hmac = (secret, v) => crypto.createHmac('sha256', secret).update(v).digest('hex');
function safeEqual(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

module.exports = { hashPassword, verifyPassword, isStrongPassword, randomToken, sha256, hmac, safeEqual, generateOtp };
