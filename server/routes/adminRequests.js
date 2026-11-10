'use strict';
/* Admin side: request queue, request review + status actions, dashboard/report numbers, document types. */
const fs = require('fs');
const { ts, iso } = require('../db');
const { HttpError, json } = require('../http');
const storage = require('../storage');
const S = require('../services/requests');
const { audit, cleanText } = require('../services/common');

module.exports = function adminRequestRoutes({ config: cfg, db }) {
  const rid = ctx => { const n = parseInt(ctx.params.id, 10); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'not_found', 'Request not found.'); return n; };
  const row = r => ({ id: String(r.id), trackingNo: r.tracking_no, residentName: r.full_name, documentType: r.document_type, submittedAt: iso(r.created_at), status: r.status, statusLabel: S.LABEL[r.status] });
  const JOIN = 'FROM requests r JOIN users u ON u.id=r.user_id';

  async function list(ctx) {
    const { limit, page, offset } = S.pageOf(ctx.query), f = S.filters(ctx.query, { admin: true }), where = f.c.length ? ' WHERE ' + f.c.join(' AND ') : '';
    const order = ctx.query.get('sort') === 'oldest' ? 'r.id ASC' : 'r.id DESC';
    const total = await db.get('SELECT COUNT(*) AS n ' + JOIN + where, f.p);
    const rows = await db.all('SELECT r.*, u.full_name ' + JOIN + where + ' ORDER BY ' + order + ' LIMIT ' + limit + ' OFFSET ' + offset, f.p);
    const types = (await db.all('SELECT DISTINCT document_type FROM requests ORDER BY document_type')).map(t => t.document_type);
    return json(200, { data: rows.map(row), total: Number(total.n), page, pages: Math.max(1, Math.ceil(Number(total.n) / limit)), limit, types });
  }

  async function detail(ctx) {
    const id = rid(ctx), r = await db.get('SELECT r.*, u.full_name, u.citizen_id, u.email, u.phone, u.date_of_birth ' + JOIN + ' WHERE r.id=?', [id]);
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.');
    const h = await db.all('SELECT * FROM request_history WHERE request_id=? ORDER BY id', [id]);
    let answers = []; try { answers = JSON.parse(r.form_data || '[]'); } catch (e) {}
    const files = await db.all('SELECT id, label, original_name FROM request_files WHERE request_id=? ORDER BY id', [id]);
    return json(200, Object.assign(row(r), {
      purpose: r.purpose, claimDate: r.claim_date || null, comments: r.comments || '', residentNote: r.resident_note || '', adminNotes: r.admin_notes || '',
      resident: { name: r.full_name, citizenId: r.citizen_id, email: r.email, phone: r.phone || '', dob: r.date_of_birth || '' }, answers,
      files: files.map(f => ({ label: f.label, name: f.original_name, url: cfg.apiBase + '/admin/requests/' + id + '/files/' + f.id })),
      history: h.map(S.histDto), allowed: Object.keys(S.ACTIONS).filter(a => S.ACTIONS[a].from.includes(r.status))
    }));
  }

  async function act(ctx) {
    const id = rid(ctx);
    await S.applyAction(db, ctx.session.user, id, ctx.body || {}, ctx.ip);
    return detail(ctx);
  }

  async function download(ctx) {
    const id = rid(ctx), fid = parseInt(ctx.params.fid, 10);
    const f = Number.isSafeInteger(fid) ? await db.get('SELECT f.stored_path, r.user_id FROM request_files f JOIN requests r ON r.id=f.request_id WHERE f.id=? AND f.request_id=?', [fid, id]) : null;
    if (!f) throw new HttpError(404, 'not_found', 'File not found.');
    const p = storage.resolveId(cfg.uploadDir, f.stored_path);
    if (!fs.existsSync(p)) throw new HttpError(404, 'not_found', 'File not found.');
    await audit(db, { actor: ctx.session.user.id, action: 'request.file.viewed', target: f.user_id, details: { request: id, file: fid }, ip: ctx.ip });
    return { status: 200, file: { path: p, mime: storage.mimeFor(p) } };
  }

  /* dashboard cards: every number is a COUNT over the real table. `today` = the browser's local midnight (ISO), so "today" follows the admin's clock. */
  async function dashboard(ctx) {
    const t = new Date(ctx.query.get('today') || ''), start = isNaN(t) ? new Date(new Date().setUTCHours(0, 0, 0, 0)) : t, prev = new Date(start.getTime() - 86400e3);
    const c = S.countsOf(await db.all('SELECT status, COUNT(*) AS n FROM requests GROUP BY status'));
    const today = await db.get('SELECT COUNT(*) AS n FROM requests WHERE created_at>=?', [ts(start)]);
    const yest = await db.get('SELECT COUNT(*) AS n FROM requests WHERE created_at>=? AND created_at<?', [ts(prev), ts(start)]);
    return json(200, { receivedToday: Number(today.n), receivedYesterday: Number(yest.n), pending: c.pending, processing: c.processing, ready: c.ready, completed: c.completed, rejected: c.rejected });
  }

  async function reports() {
    const c = S.countsOf(await db.all('SELECT status, COUNT(*) AS n FROM requests GROUP BY status'));
    const byType = (await db.all('SELECT document_type AS name, COUNT(*) AS n FROM requests GROUP BY document_type ORDER BY n DESC, document_type LIMIT 12')).map(t => ({ name: t.name, count: Number(t.n) }));
    const act = await db.all('SELECT h.event, h.created_at, r.document_type, r.tracking_no, u.full_name FROM request_history h JOIN requests r ON r.id=h.request_id JOIN users u ON u.id=r.user_id ORDER BY h.id DESC LIMIT 8');
    const verb = { submitted: 'requested', processing: 'had processing started for', ready: 'was approved for', completed: 'claimed', rejected: 'was rejected for', info: 'was asked for more information on', reply: 'sent more information for' };
    return json(200, { total: c.pending + c.processing + c.ready + c.completed + c.rejected, approved: c.ready + c.completed, pending: c.pending + c.processing, rejected: c.rejected, byType,
      activity: act.map(a => ({ text: a.full_name + ' ' + verb[a.event] + ' ' + a.document_type, at: iso(a.created_at) })) });
  }

  /* ---- document types ---- */
  const tdto = t => ({ id: String(t.id), name: t.name, description: t.description, active: !!t.active });
  function readType(b) {
    const name = cleanText(b.name, 80), description = cleanText(b.description, 500), fields = {};
    if (!name) fields.name = 'Enter a document type name.'; if (!description) fields.description = 'Enter a description.';
    if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields });
    return { name, description, active: b.active === false || b.active === 0 || b.active === 'false' ? 0 : 1 };
  }
  const dupName = e => { if (e && e.code === 'DUPLICATE_KEY') throw new HttpError(409, 'duplicate', 'A document type with this name already exists.', { fields: { name: 'This name is already used.' } }); throw e; };
  async function typesList() { return json(200, { data: (await db.all('SELECT * FROM document_types ORDER BY id')).map(tdto) }); }
  async function typeUpdate(ctx) {
    const id = rid(ctx), b = readType(ctx.body || {});
    const old = await db.get('SELECT * FROM document_types WHERE id=?', [id]);
    if (!old) throw new HttpError(404, 'not_found', 'Document type not found.');
    await db.tx(async q => {
      await q.run('UPDATE document_types SET name=?, description=?, active=?, updated_at=? WHERE id=?', [b.name, b.description, b.active, ts(), id]);
      if (old.name !== b.name) await q.run('UPDATE requests SET document_type=? WHERE document_type_id=?', [b.name, id]);   // keep existing requests labelled consistently
    }).catch(dupName);
    await audit(db, { actor: ctx.session.user.id, action: 'doctype.update', details: { id }, ip: ctx.ip });
    return json(200, tdto(await db.get('SELECT * FROM document_types WHERE id=?', [id])));
  }
  async function typeDelete(ctx) {
    const id = rid(ctx), r = await db.run('DELETE FROM document_types WHERE id=?', [id]);   // requests keep their own copy of the name, so history is preserved
    if (r.affectedRows !== 1) throw new HttpError(404, 'not_found', 'Document type not found.');
    await audit(db, { actor: ctx.session.user.id, action: 'doctype.delete', details: { id }, ip: ctx.ip });
    return { status: 204 };
  }

  return [
    { method: 'GET', path: '/admin/requests', auth: 'admin', handler: list },
    { method: 'GET', path: '/admin/requests/:id', auth: 'admin', handler: detail },
    { method: 'PATCH', path: '/admin/requests/:id', auth: 'admin', handler: act },
    { method: 'GET', path: '/admin/requests/:id/files/:fid', auth: 'admin', handler: download },
    { method: 'GET', path: '/admin/dashboard', auth: 'admin', handler: dashboard },
    { method: 'GET', path: '/admin/reports', auth: 'admin', handler: reports },
    { method: 'GET', path: '/admin/document-types', auth: 'admin', handler: typesList },
    { method: 'PATCH', path: '/admin/document-types/:id', auth: 'admin', handler: typeUpdate },
    { method: 'DELETE', path: '/admin/document-types/:id', auth: 'admin', handler: typeDelete }
  ];
};
