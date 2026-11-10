/* Optional: applies database/schema.sql to the database in DATABASE_URL (same result as pasting it into the Supabase SQL Editor). */
'use strict';
const fs = require('fs'), path = require('path');
const { loadEnvFile, loadConfig } = require('../server/config');
loadEnvFile(path.join(__dirname, '..', '.env'));
const c = loadConfig().db;
(async () => {
  if (!c.url) throw new Error('DATABASE_URL is empty in .env');
  const { Client } = require('pg');
  const ssl = c.ssl ? (c.sslCa ? { ca: fs.readFileSync(c.sslCa, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false }) : false;
  const client = new Client({ connectionString: c.url, ssl });
  await client.connect();
  try { await client.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8')); }   // plain multi-statement query
  finally { await client.end(); }
  console.log('Schema applied.');
})().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
