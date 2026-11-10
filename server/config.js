'use strict';
const fs = require('fs'), path = require('path');

/* tiny .env loader (no dependency). Real environment variables win. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function isLocalDb(url) { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname); } catch (e) { return false; } }

function loadConfig(env = process.env, root = path.join(__dirname, '..')) {
  const int = (k, d) => { const v = parseInt(env[k], 10); return Number.isFinite(v) ? v : d; };
  const bool = (k, d) => (env[k] === undefined || env[k] === '' ? d : /^(1|true|yes)$/i.test(env[k]));
  const prod = env.NODE_ENV === 'production';
  const port = int('PORT', 5173);
  return {
    prod, port, root,
    appUrl: (env.APP_URL || 'http://localhost:' + port).replace(/\/+$/, ''),
    apiBase: '/api/v1',
    uploadDir: path.resolve(root, env.UPLOAD_DIR || 'storage/ids'),
    db: { url: env.DATABASE_URL || '', ssl: bool('DB_SSL', !isLocalDb(env.DATABASE_URL)), sslCa: env.DB_SSL_CA || '', poolMax: int('DB_POOL_MAX', 5) },
    secret: env.SESSION_SECRET || '',
    sessionHours: int('SESSION_HOURS', 8),
    cookieSecure: bool('COOKIE_SECURE', prod),
    trustProxy: bool('TRUST_PROXY', false),
    otp: { ttlMin: int('OTP_TTL_MIN', 5), maxAttempts: int('OTP_MAX_ATTEMPTS', 5), cooldownSec: int('OTP_RESEND_COOLDOWN_SEC', 30), maxPerHour: int('OTP_MAX_SENDS_PER_HOUR', 5) },
    mail: { provider: (env.MAIL_PROVIDER || 'brevo').toLowerCase(), apiKey: env.MAIL_API_KEY || '', fromAddress: env.MAIL_FROM_ADDRESS || '', fromName: env.MAIL_FROM_NAME || 'BarangayDocs', apiBaseUrl: env.MAIL_API_BASE_URL || '' }
  };
}
function assertConfig(c) {
  if (!c.db.url) throw new Error('DATABASE_URL is empty. Paste your Supabase connection string into .env (see AUTH_SETUP.md, section 2).');
  if (!c.secret || c.secret.length < 32) {
    throw new Error('SESSION_SECRET is missing or too short (min 32 chars). Generate one with:\n  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\nand put it in .env');
  }
}
module.exports = { loadEnvFile, loadConfig, assertConfig };
