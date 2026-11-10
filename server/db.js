'use strict';
/* PostgreSQL adapter (Supabase). The whole app talks to the database through this interface only:
     db.all(sql, params) -> rows[]      db.get(sql, params) -> row|null      db.run(sql, params) -> { affectedRows, insertId }
     db.tx(async (q) => { q.all/get/run ... })  -> commits, or rolls back if the callback throws
   SQL is written with `?` placeholders; they are converted to $1, $2... here.
   Timestamps are exchanged as 'YYYY-MM-DD HH:MM:SS' UTC strings, dates as 'YYYY-MM-DD'. */
const pad = n => String(n).padStart(2, '0');
const ts = (d = new Date()) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
const iso = s => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toISOString() : null);

const toPg = sql => { let n = 0; return sql.replace(/\?/g, () => '$' + (++n)); };
const NUMERIC_ID_TABLES = /^\s*INSERT\s+INTO\s+(users|email_otps|password_resets|audit_log|notifications|document_types|requests|request_history|request_files|announcements)\b/i;
const withReturning = sql => (NUMERIC_ID_TABLES.test(sql) && !/\bRETURNING\b/i.test(sql) ? sql.replace(/;?\s*$/, '') + ' RETURNING id' : sql);

/* `pg` is only needed for this adapter, so tests can inject a fake and never load it */
function wrap(exec) {
  const q = async (sql, p) => exec(toPg(sql), (p || []).map(v => (v === undefined ? null : v)));
  const dup = e => { if (e && e.code === '23505') e.code = 'DUPLICATE_KEY'; throw e; };   // unique violation -> same code the app checks everywhere
  return {
    all: async (sql, p) => (await q(sql, p).catch(dup)).rows,
    get: async (sql, p) => (await q(sql, p).catch(dup)).rows[0] || null,
    run: async (sql, p) => {
      const r = await q(withReturning(sql), p).catch(dup);
      return { affectedRows: r.rowCount, insertId: r.rows && r.rows[0] && r.rows[0].id != null ? Number(r.rows[0].id) : 0 };
    }
  };
}
function sslOption(cfg) {
  if (!cfg.ssl) return false;
  if (cfg.sslCa) return { ca: require('fs').readFileSync(cfg.sslCa, 'utf8'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };   // encrypted but certificate not verified; provide DB_SSL_CA to verify (see AUTH_SETUP.md)
}
function createPgDb(cfg, pgLib) {
  const pg = pgLib || require('pg');
  const types = {   // return dates/timestamps as plain strings and bigint as numbers (no timezone surprises)
    getTypeParser: (oid, fmt) => (oid === 1114 || oid === 1082 ? v => v : oid === 20 ? v => parseInt(v, 10) : pg.types.getTypeParser(oid, fmt))
  };
  const pool = new pg.Pool({ connectionString: cfg.url, ssl: sslOption(cfg), max: cfg.poolMax, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, types });
  pool.on('error', e => console.error('[db] idle client error:', e.message));
  return Object.assign(wrap((sql, p) => pool.query(sql, p)), {
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const out = await fn(wrap((sql, p) => c.query(sql, p))); await c.query('COMMIT'); return out; }
      catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
      finally { c.release(); }
    },
    ping: () => pool.query('SELECT 1'),
    close: () => pool.end()
  });
}
module.exports = { createPgDb, ts, iso, toPg, withReturning, wrap };
