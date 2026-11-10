'use strict';
/* Resident side: document types, submit a request, list/open MY requests. Every query is scoped by the session's user id. */
const crypto = require('crypto');
const { ts } = require('../db');
const { HttpError, json } = require('../http');
const storage = require('../storage');
const forms = require('../forms');
const S = require('../services/requests');
const { audit, notify, cleanText, limit: rate } = require('../services/common');

module.exports = function requestRoutes({ config: cfg, db, limiter }) {
  const typeDto = t => { const f = forms.formFor(t.name); return { id: String(t.id), name: t.name, description: t.description, fields: f.fields, banner: f.banner || null, guide: f.guide || [] }; };

  async function types() {
    const rows = await db.all('SELECT * FROM document_types WHERE active=1 ORDER BY id');
    return json(200, { data: rows.map(typeDto), purposes: forms.PURPOSES, guide: forms.GUIDE });
  }

  async function submit(ctx) {
    const user = ctx.session.user, f = ctx.fields;
    rate(limiter, 'req:submit:' + user.id, 20, 3600e3);
    const token = String(f.client_token || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw new HttpError(422, 'validation_failed', 'Please reload the page and try again.');
    const existing = async () => db.get('SELECT * FROM requests WHERE user_id=? AND client_token=?', [user.id, token]);
    const dup = await existing();
    if (dup) return json(200, Object.assign(S.residentDto(dup), { duplicate: true }));   // same submission sent twice -> same request, nothing new created

    const errors = {};
    const type = /^\d+$/.test(String(f.document_type_id || '')) ? await db.get('SELECT * FROM document_types WHERE id=? AND active=1', [parseInt(f.document_type_id, 10)]) : null;
    if (!type) throw new HttpError(422, 'validation_failed', 'Select an available document type.', { fields: { document_type: 'Select an available document type.' } });
    const comments = cleanText(f.comments, 500, true), pf = forms.purposeField(type.name);
    let purpose = cleanText(f.purpose, 80);
    if (!pf && !forms.PURPOSES.includes(purpose)) errors.purpose = 'Choose a purpose of request.';   // forms that already ask for a purpose are not asked twice
    let raw = {}; try { raw = JSON.parse(f.answers || '{}'); } catch (e) { errors.answers = 'Malformed form data.'; }
    const v = forms.validate(type.name, raw, ts(new Date(Date.now() + 14 * 3600e3)).slice(0, 10));
    Object.assign(errors, v.errors);
    if (pf) purpose = (v.answers.find(a => a.label === pf.label) || {}).value || '';
    // uploaded requirements: one file per file field (Valid ID, Cedula, ...). A field is required unless it depends on another answer that is blank.
    const picked = [];
    for (const f of forms.fileFields(type.name)) {
      const file = ctx.files[f.key], needed = f.required !== false && (!f.requiredIf || String((raw && raw[f.requiredIf]) || '').trim());
      if (!file) { if (needed) errors[f.key] = 'Upload a readable copy.'; continue; }
      let ftype;
      if (file.data.length > 5 * 1024 * 1024) errors[f.key] = 'File is larger than 5 MB.';
      else if (!(ftype = storage.detect(file.data))) errors[f.key] = 'Use a JPG, PNG or PDF file.';
      else picked.push({ f, file, ftype });
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields: errors });

    const saved = [];
    const cleanup = () => Promise.all(saved.map(x => storage.removeId(cfg.uploadDir, x.stored)));
    try {
      for (const x of picked) saved.push({ f: x.f, stored: await storage.saveId(cfg.uploadDir, x.file.data, x.ftype), name: cleanText(x.file.filename.split(/[\\/]/).pop(), 120) || 'upload' });
      const id = await db.tx(async q => {
        const now = ts(), r = await q.run('INSERT INTO requests (tracking_no, user_id, document_type_id, document_type, purpose, comments, form_data, status, client_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          ['TMP-' + crypto.randomBytes(12).toString('hex'), user.id, type.id, type.name, purpose, comments || null, JSON.stringify(v.answers), 'pending', token, now, now]);
        for (const x of saved) await q.run('INSERT INTO request_files (request_id, field_key, label, stored_path, original_name, created_at) VALUES (?,?,?,?,?,?)', [r.insertId, x.f.key, x.f.label, x.stored, x.name, now]);
        const tracking = S.trackingFor(r.insertId);
        await q.run('UPDATE requests SET tracking_no=? WHERE id=?', [tracking, r.insertId]);
        await q.run('INSERT INTO request_history (request_id, event, status, note, actor_user_id, created_at) VALUES (?,?,?,?,?,?)', [r.insertId, 'submitted', 'pending', null, user.id, now]);
        await notify(q, user.id, 'submitted', 'Request Submitted Successfully', 'Your ' + type.name + ' request (' + tracking + ') was submitted and is waiting for review by barangay staff.', { tracking, ref: 'req:' + r.insertId + ':submitted' });
        await audit(q, { actor: user.id, action: 'request.submitted', target: user.id, details: { request: tracking }, ip: ctx.ip });
        return r.insertId;
      });
      return json(201, S.residentDto(await db.get('SELECT * FROM requests WHERE id=?', [id])));
    } catch (e) {
      await cleanup();
      if (e && e.code === 'DUPLICATE_KEY') { const again = await existing(); if (again) return json(200, Object.assign(S.residentDto(again), { duplicate: true })); }
      throw e;
    }
  }

  async function list(ctx) {
    const uid = ctx.session.user.id, { limit, page, offset } = S.pageOf(ctx.query), f = S.filters(ctx.query, { admin: false });
    const where = ['r.user_id=?'].concat(f.c).join(' AND '), params = [uid].concat(f.p);
    const total = await db.get('SELECT COUNT(*) AS n FROM requests r WHERE ' + where, params);
    const rows = await db.all('SELECT r.* FROM requests r WHERE ' + where + ' ORDER BY r.id DESC LIMIT ' + limit + ' OFFSET ' + offset, params);
    const counts = S.countsOf(await db.all('SELECT status, COUNT(*) AS n FROM requests WHERE user_id=? GROUP BY status', [uid]));
    const types = (await db.all('SELECT DISTINCT document_type FROM requests WHERE user_id=? ORDER BY document_type', [uid])).map(t => t.document_type);
    return json(200, { data: rows.map(r => S.residentDto(r)), total: Number(total.n), page, pages: Math.max(1, Math.ceil(Number(total.n) / limit)), limit, counts, types });
  }

  async function one(ctx) {
    const r = await db.get('SELECT * FROM requests WHERE tracking_no=? AND user_id=?', [ctx.params.ref, ctx.session.user.id]);   // someone else's tracking number is simply "not found"
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.');
    const h = await db.all('SELECT * FROM request_history WHERE request_id=? ORDER BY id', [r.id]);
    const last = h[h.length - 1];
    return json(200, Object.assign(S.residentDto(r, h), { infoRequested: !!last && last.event === 'info' && ['pending', 'processing'].includes(r.status) }));
  }

  /* The resident answers an "additional information" request: a text answer and/or one image. Only possible while that request is outstanding. */
  async function respond(ctx) {
    const user = ctx.session.user;
    rate(limiter, 'req:respond:' + user.id, 20, 3600e3);
    const r = await db.get('SELECT * FROM requests WHERE tracking_no=? AND user_id=?', [ctx.params.ref, user.id]);
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.');
    const open = async q => { const l = await q.get('SELECT event FROM request_history WHERE request_id=? ORDER BY id DESC LIMIT 1', [r.id]); return !!l && l.event === 'info' && ['pending', 'processing'].includes(r.status); };
    if (!(await open(db))) throw new HttpError(409, 'not_requested', 'No additional information is being requested for this request right now.');
    const message = cleanText(ctx.fields.message, 500, true), file = ctx.files.image, errors = {};
    let ftype = null;
    if (!message && !file) errors.message = 'Enter the requested information or attach an image.';
    if (file) {
      if (file.data.length > 5 * 1024 * 1024) errors.image = 'Image is larger than 5 MB.';
      else if (!(ftype = storage.detect(file.data)) || ftype.ext === '.pdf') errors.image = 'Use a JPG or PNG image.';
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields: errors });
    const stored = file ? await storage.saveId(cfg.uploadDir, file.data, ftype) : null;
    try {
      await db.tx(async q => {
        if (!(await open(q))) throw new HttpError(409, 'not_requested', 'This information was already sent.');
        const now = ts();
        await q.run('INSERT INTO request_history (request_id, event, status, note, actor_user_id, created_at) VALUES (?,?,?,?,?,?)', [r.id, 'reply', r.status, message || 'Image attached.', user.id, now]);
        if (stored) await q.run('INSERT INTO request_files (request_id, field_key, label, stored_path, original_name, created_at) VALUES (?,?,?,?,?,?)', [r.id, 'info_reply', 'Additional information (image)', stored, cleanText(file.filename.split(/[\\/]/).pop(), 120) || 'image', now]);
        await q.run('UPDATE requests SET updated_at=? WHERE id=?', [now, r.id]);
        await audit(q, { actor: user.id, action: 'request.reply', target: user.id, details: { request: r.tracking_no }, ip: ctx.ip });
      });
    } catch (e) { await storage.removeId(cfg.uploadDir, stored); throw e; }
    const h = await db.all('SELECT * FROM request_history WHERE request_id=? ORDER BY id', [r.id]);
    return json(200, Object.assign(S.residentDto(r, h), { infoRequested: false }));
  }

  return [
    { method: 'GET', path: '/document-types', auth: 'user', handler: types },
    { method: 'POST', path: '/requests', auth: 'resident', multipart: true, maxParts: 16, maxBytes: 12 * 1024 * 1024, handler: submit },
    { method: 'GET', path: '/requests', auth: 'resident', handler: list },
    { method: 'GET', path: '/requests/:ref', auth: 'resident', handler: one },
    { method: 'POST', path: '/requests/:ref/respond', auth: 'resident', multipart: true, maxParts: 4, handler: respond }
  ];
};
