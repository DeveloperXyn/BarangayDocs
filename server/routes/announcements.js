'use strict';
/* Announcements: admins create/edit/unpublish/delete. Residents only ever see them as notifications:
   publishing notifies every approved resident once; unpublishing or deleting removes those notifications again; editing updates their text. */
const { ts, iso } = require('../db');
const { HttpError, json } = require('../http');
const { audit, notify, cleanText } = require('../services/common');
const { likeEsc } = require('../services/requests');

module.exports = function announcementRoutes({ db }) {
  const dto = a => ({ id: String(a.id), title: a.title, message: a.message, status: a.status, publishedAt: iso(a.published_at), createdAt: iso(a.created_at), updatedAt: iso(a.updated_at) });
  const id = ctx => { const n = parseInt(ctx.params.id, 10); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'not_found', 'Announcement not found.'); return n; };

  /* the bell shows a short preview; this returns the complete text of ONE published announcement for the expanded view */
  async function one(ctx) {
    const n = parseInt(ctx.params.id, 10), a = Number.isSafeInteger(n) ? await db.get("SELECT * FROM announcements WHERE id=? AND status='published'", [n]) : null;
    if (!a) throw new HttpError(404, 'not_found', 'Announcement not found.');
    return json(200, { id: String(a.id), title: a.title, message: a.message, publishedAt: iso(a.published_at) });
  }
  async function adminList(ctx) {
    const q = String(ctx.query.get('q') || '').trim().slice(0, 60), p = [];
    const rows = await db.all('SELECT * FROM announcements' + (q ? " WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(message) LIKE ? ESCAPE '\\'" : '') + ' ORDER BY id DESC LIMIT 200', q ? [likeEsc(q), likeEsc(q)] : p);
    return json(200, { data: rows.map(dto) });
  }
  function read(b) {
    const rawTitle = cleanText(b.title, 400), title = rawTitle.slice(0, 150), message = cleanText(b.message, 2000, true), status = b.status === 'draft' ? 'draft' : b.status === 'published' ? 'published' : null, fields = {};
    if (!title) fields.title = 'Enter a title.'; else if (rawTitle.length > 50) fields.title = 'Title must be 50 characters or fewer.'; if (!message) fields.message = 'Enter a message.'; if (!status) fields.status = 'Choose Published or Draft.';
    if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields });
    return { title, message, status };
  }
  /* one notification per approved resident per announcement; republishing or retrying can never create a second one */
  const broadcast = (q, a) => q.run("INSERT INTO notifications (user_id, type, title, message, ref_key) SELECT u.id, 'announcement', ?, ?, ? FROM users u WHERE u.role='resident' AND u.account_status='approved' AND u.email_verified=1 ON CONFLICT (user_id, ref_key) DO NOTHING",
    ['New Announcement', (a.title + ': ' + a.message).slice(0, 500), 'ann:' + a.id]);   // created_at comes from the column default (UTC)

  async function create(ctx) {
    const b = read(ctx.body || {}), admin = ctx.session.user, now = ts();
    const out = await db.tx(async q => {
      const r = await q.run('INSERT INTO announcements (title, message, status, published_at, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [b.title, b.message, b.status, b.status === 'published' ? now : null, admin.id, now, now]);
      if (b.status === 'published') await broadcast(q, { id: r.insertId, title: b.title, message: b.message });
      await audit(q, { actor: admin.id, action: 'announcement.create', details: { id: r.insertId, status: b.status }, ip: ctx.ip });
      return r.insertId;
    });
    return json(201, dto(await db.get('SELECT * FROM announcements WHERE id=?', [out])));
  }
  async function update(ctx) {
    const aid = id(ctx), b = read(ctx.body || {}), admin = ctx.session.user, now = ts();
    await db.tx(async q => {
      const a = await q.get('SELECT * FROM announcements WHERE id=?', [aid]);
      if (!a) throw new HttpError(404, 'not_found', 'Announcement not found.');
      const publishing = b.status === 'published' && a.status !== 'published';
      await q.run('UPDATE announcements SET title=?, message=?, status=?, published_at=?, updated_at=? WHERE id=?', [b.title, b.message, b.status, publishing ? now : (b.status === 'draft' ? null : a.published_at), now, aid]);
      if (publishing) await broadcast(q, { id: aid, title: b.title, message: b.message });
      else if (b.status === 'draft') await q.run('DELETE FROM notifications WHERE ref_key=?', ['ann:' + aid]);   // unpublished -> disappears from every resident's bell
      else await q.run('UPDATE notifications SET message=? WHERE ref_key=?', [(b.title + ': ' + b.message).slice(0, 500), 'ann:' + aid]);   // edited while published -> bell shows the new text
      await audit(q, { actor: admin.id, action: 'announcement.update', details: { id: aid, status: b.status }, ip: ctx.ip });
    });
    return json(200, dto(await db.get('SELECT * FROM announcements WHERE id=?', [aid])));
  }
  async function remove(ctx) {
    const aid = id(ctx);
    await db.tx(async q => {
      const r = await q.run('DELETE FROM announcements WHERE id=?', [aid]);
      if (r.affectedRows !== 1) throw new HttpError(404, 'not_found', 'Announcement not found.');
      await q.run('DELETE FROM notifications WHERE ref_key=?', ['ann:' + aid]);
      await audit(q, { actor: ctx.session.user.id, action: 'announcement.delete', details: { id: aid }, ip: ctx.ip });
    });
    return { status: 204 };
  }
  return [
    { method: 'GET', path: '/announcements/:id', auth: 'user', handler: one },
    { method: 'GET', path: '/admin/announcements', auth: 'admin', handler: adminList },
    { method: 'POST', path: '/admin/announcements', auth: 'admin', handler: create },
    { method: 'PATCH', path: '/admin/announcements/:id', auth: 'admin', handler: update },
    { method: 'DELETE', path: '/admin/announcements/:id', auth: 'admin', handler: remove }
  ];
};
