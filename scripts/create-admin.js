/* Creates an administrator account. The password is never stored in code or files.
   Interactive:      npm run create-admin
   Non-interactive:  ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin */
'use strict';
const path = require('path'), readline = require('readline');
const { loadEnvFile, loadConfig } = require('../server/config');
loadEnvFile(path.join(__dirname, '..', '.env'));
const config = loadConfig();
const { createPgDb, ts } = require('../server/db');
const { hashPassword, isStrongPassword } = require('../server/security');

function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { rl._writeToOutput = s => { if (s.includes(q)) process.stdout.write(s); }; }
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); });
  });
}
(async () => {
  const email = (process.env.ADMIN_EMAIL || await ask('Admin email: ')).trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || await ask('Admin full name: ')).trim();
  const password = process.env.ADMIN_PASSWORD || await ask('Admin password (hidden): ', true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address.');
  if (name.length < 2) throw new Error('Enter the full name.');
  if (!isStrongPassword(password)) throw new Error('Password needs 8+ characters with upper and lower case letters, a number and a symbol.');
  if (!config.db.url) throw new Error('DATABASE_URL is empty in .env');
  const db = createPgDb(config.db);
  try {
    if (await db.get('SELECT id FROM users WHERE email=?', [email])) throw new Error('An account with that email already exists.');
    const now = ts(), hash = await hashPassword(password);
    const r = await db.run("INSERT INTO users (full_name, email, password_hash, role, account_status, email_verified, email_verified_at, approved_at, created_at, updated_at) VALUES (?,?,?,'admin','approved',1,?,?,?,?)", [name, email, hash, now, now, now, now]);
    await db.run('UPDATE users SET citizen_id=? WHERE id=?', ['ADM-' + String(r.insertId).padStart(4, '0'), r.insertId]);
    await db.run("INSERT INTO audit_log (actor_user_id, action, target_user_id, details, created_at) VALUES (NULL,'admin.created',?,?,?)", [r.insertId, JSON.stringify({ via: 'create-admin script' }), now]);
    console.log('Administrator created: ' + email + ' (ADM-' + String(r.insertId).padStart(4, '0') + ')');
  } finally { await db.close(); }
})().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
