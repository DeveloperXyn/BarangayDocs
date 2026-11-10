/* BarangayDocs server: static site + JSON API (/api/v1) backed by Supabase (PostgreSQL).   Start:  npm start */
'use strict';
const http = require('http'), path = require('path');
const { loadEnvFile, loadConfig, assertConfig } = require('./server/config');
loadEnvFile(path.join(__dirname, '.env'));
const config = loadConfig();
try { assertConfig(config); } catch (e) { console.error('\nConfiguration error: ' + e.message + '\n'); process.exit(1); }

const { createPgDb } = require('./server/db');
const { createMailer } = require('./server/mailer');
const { createApp } = require('./server/app');

const db = createPgDb(config.db), mailer = createMailer(config.mail);
const app = createApp({ config, db, mailer });
db.ping().then(() => {
  http.createServer(app.listener).listen(config.port, () => {
    console.log('BarangayDocs running at http://localhost:' + config.port);
    console.log(mailer.isConfigured() ? 'Email: ' + config.mail.provider + ' configured' : 'Email: NOT configured. Registration and password reset will answer 503 until MAIL_API_KEY / MAIL_FROM_ADDRESS are set in .env');
  });
}).catch(e => {
  console.error('\nCannot connect to the database: ' + e.message + '\nCheck DATABASE_URL in .env (use the Supabase *pooler* connection string, with the password URL-encoded) and that database/schema.sql was run.\n');
  process.exit(1);
});
