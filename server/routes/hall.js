'use strict';
/* Barangay Hall open/closed switch.
   GET   /hall-status  (any signed-in user) -> { open:boolean, updatedAt:ISO|null }
   PATCH /admin/hall-status { open:boolean } (admin) -> same shape. Stored as one row in `settings`. */
const { ts, iso } = require('../db');
const { HttpError, json } = require('../http');
const { audit } = require('../services/common');

const KEY = 'hall_open';
const DDL = 'CREATE TABLE IF NOT EXISTS settings (name VARCHAR(60) PRIMARY KEY, value VARCHAR(255) NOT NULL, updated_at TIMESTAMP(0) NOT NULL DEFAULT (timezone(\'utc\', now())))';

module.exports = function hallRoutes({ db }) {
  let ready = false;
  async function ensure() { if (ready) return; try { await db.get('SELECT 1 FROM settings LIMIT 1'); } catch (e) { await db.run(DDL); } ready = true; }   // older databases get the table automatically
  const dto = row => ({ open: !row || row.value !== '0', updatedAt: row ? iso(row.updated_at) : null });   // open unless an admin closed it

  async function read() { await ensure(); return db.get('SELECT value, updated_at FROM settings WHERE name=?', [KEY]); }
  async function get() { return json(200, dto(await read())); }

  async function set(ctx) {
    const b = ctx.body || {};
    if (typeof b.open !== 'boolean') throw new HttpError(422, 'validation_failed', 'Send { "open": true } or { "open": false }.');
    await ensure();
    await db.tx(async q => {
      const now = ts();
      const r = await q.run('UPDATE settings SET value=?, updated_at=? WHERE name=?', [b.open ? '1' : '0', now, KEY]);
      if (!r.affectedRows) await q.run('INSERT INTO settings (name, value, updated_at) VALUES (?,?,?)', [KEY, b.open ? '1' : '0', now]);
      await audit(q, { actor: ctx.session.user.id, action: 'hall.' + (b.open ? 'open' : 'close'), details: { open: b.open }, ip: ctx.ip });
    });
    return json(200, dto(await read()));
  }

  return [
    { method: 'GET', path: '/hall-status', auth: 'user', handler: get },
    { method: 'PATCH', path: '/admin/hall-status', auth: 'admin', handler: set }
  ];
};
