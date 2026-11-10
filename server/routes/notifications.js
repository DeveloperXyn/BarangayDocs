'use strict';
const { ts, iso } = require('../db');
const { HttpError, json } = require('../http');
const dto = r => ({ id: String(r.id), type: r.type, title: r.title, message: r.message, tracking_no: r.tracking_no || null, announcement_id: ((/^ann:(\d+)$/.exec(r.ref_key || '')) || [])[1] || null, created_at: iso(r.created_at), read_at: iso(r.read_at) });

module.exports = function notificationRoutes({ db }) {
  async function list(ctx) {
    const uid = ctx.session.user.id, limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 20, 1), 50);
    const unreadOnly = ctx.query.get('status') === 'unread';
    const rows = await db.all('SELECT * FROM notifications WHERE user_id=?' + (unreadOnly ? ' AND read_at IS NULL' : '') + ' ORDER BY id DESC LIMIT ' + limit, [uid]);
    const c = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', [uid]);
    return json(200, { data: rows.map(dto), unread_count: Number(c.n), next_cursor: null });
  }
  async function markRead(ctx) {
    const uid = ctx.session.user.id, id = parseInt(ctx.params.id, 10);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'Notification not found.');
    await db.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', [ts(), id, uid]);
    const r = await db.get('SELECT * FROM notifications WHERE id=? AND user_id=?', [id, uid]);
    if (!r) throw new HttpError(404, 'not_found', 'Notification not found.');
    return json(200, dto(r));
  }
  async function readAll(ctx) {
    const r = await db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [ts(), ctx.session.user.id]);
    return json(200, { updated: r.affectedRows });
  }
  return [
    { method: 'GET', path: '/notifications', auth: 'user', handler: list },
    { method: 'PATCH', path: '/notifications/:id/read', auth: 'user', handler: markRead },
    { method: 'POST', path: '/notifications/read-all', auth: 'user', handler: readAll }
  ];
};
