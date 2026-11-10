'use strict';
/* The Postgres adapter is tested against a fake `pg` library (no database needed). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPgDb, toPg, withReturning } = require('../server/db');

function fakePg(script = () => ({ rows: [], rowCount: 0 })) {
  const log = [];
  const run = (sql, p) => { log.push({ sql, p }); const r = script(sql, p); if (r instanceof Error) throw r; return Promise.resolve(r); };
  class Pool {
    constructor(o) { log.opts = o; }
    on() {} query(sql, p) { return run(sql, p); } end() { return Promise.resolve(); }
    async connect() { return { query: (sql, p) => run(sql, p), release() { log.released = (log.released || 0) + 1; } }; }
  }
  return { lib: { Pool, types: { getTypeParser: () => v => 'default:' + v } }, log };
}
const cfg = { url: 'postgresql://x', ssl: true, sslCa: '', poolMax: 5 };

test('? placeholders become $1..$n, in order', () => {
  assert.equal(toPg('SELECT * FROM users WHERE email=? AND role=? LIMIT 1'), 'SELECT * FROM users WHERE email=$1 AND role=$2 LIMIT 1');
  assert.equal(toPg('SELECT 1'), 'SELECT 1');
});
test('RETURNING id is added only to inserts into tables with a numeric id', () => {
  assert.match(withReturning('INSERT INTO users (a) VALUES (?)'), / RETURNING id$/);
  assert.match(withReturning('INSERT INTO audit_log (a) VALUES (?);'), /\) RETURNING id$/);
  assert.equal(withReturning('INSERT INTO sessions (id) VALUES (?)'), 'INSERT INTO sessions (id) VALUES (?)');
  assert.equal(withReturning('UPDATE users SET a=? WHERE id=?'), 'UPDATE users SET a=? WHERE id=?');
});
test('get / all / run map results the way the app expects', async () => {
  const f = fakePg((sql) => /INSERT/.test(sql) ? { rows: [{ id: '42' }], rowCount: 1 } : /UPDATE/.test(sql) ? { rows: [], rowCount: 3 } : { rows: [{ n: 1 }, { n: 2 }], rowCount: 2 });
  const db = createPgDb(cfg, f.lib);
  assert.deepEqual(await db.get('SELECT n FROM t WHERE a=?', [1]), { n: 1 });
  assert.equal((await db.all('SELECT n FROM t')).length, 2);
  assert.deepEqual(await db.run('INSERT INTO users (a) VALUES (?)', [undefined]), { affectedRows: 1, insertId: 42 });
  assert.equal(f.log.at(-1).p[0], null, 'undefined is sent as NULL');
  assert.deepEqual(await db.run('UPDATE users SET a=? WHERE id=?', [1, 2]), { affectedRows: 3, insertId: 0 });
  assert.equal(f.log.at(-1).sql, 'UPDATE users SET a=$1 WHERE id=$2');
});
test('unique violation (23505) becomes the DUPLICATE_KEY code', async () => {
  const f = fakePg(() => Object.assign(new Error('duplicate key'), { code: '23505' }));
  await assert.rejects(createPgDb(cfg, f.lib).run('INSERT INTO users (a) VALUES (?)', [1]), e => e.code === 'DUPLICATE_KEY');
});
test('transactions: BEGIN, COMMIT, and ROLLBACK on error; connection always released', async () => {
  let f = fakePg(); let db = createPgDb(cfg, f.lib);
  await db.tx(async q => { await q.run('UPDATE a SET b=?', [1]); });
  assert.deepEqual(f.log.map(l => l.sql), ['BEGIN', 'UPDATE a SET b=$1', 'COMMIT']); assert.equal(f.log.released, 1);
  f = fakePg(); db = createPgDb(cfg, f.lib);
  await assert.rejects(db.tx(async q => { await q.run('UPDATE a SET b=?', [1]); throw new Error('boom'); }), /boom/);
  assert.deepEqual(f.log.map(l => l.sql), ['BEGIN', 'UPDATE a SET b=$1', 'ROLLBACK']); assert.equal(f.log.released, 1);
});
test('timestamps/dates stay strings, bigint becomes a number, other types use the default parser', () => {
  const f = fakePg(); createPgDb(cfg, f.lib);
  const gp = f.log.opts.types.getTypeParser;
  assert.equal(gp(1114)('2026-10-27 02:14:00'), '2026-10-27 02:14:00');
  assert.equal(gp(1082)('1990-05-17'), '1990-05-17');
  assert.strictEqual(gp(20)('7'), 7);
  assert.equal(gp(25)('x'), 'default:x');
  assert.equal(f.log.opts.max, 5); assert.deepEqual(f.log.opts.ssl, { rejectUnauthorized: false });
});
