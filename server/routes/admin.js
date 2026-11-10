'use strict';
const fs = require('fs');
const { ts } = require('../db');
const { HttpError, json } = require('../http');
const storage = require('../storage');
const sessions = require('../services/sessions');
const { audit, notify, residentDto } = require('../services/common');
const tpl = require('../mailer/templates');

module.exports = function adminRoutes({ config: cfg, db, mailer, log }) {
  /* GET /admin/residents -> every EMAIL-VERIFIED registration (the approval queue + history) */
  async function list() {
    const rows = await db.all("SELECT * FROM users WHERE role='resident' AND email_verified=1 ORDER BY created_at DESC, id DESC");
    return json(200, { data: rows.map(r => residentDto(r, cfg)) });
  }

  /* PATCH /admin/residents/:id  { status:'approved'|'rejected', reason? } */
  async function decide(ctx) {
    const id = parseInt(ctx.params.id, 10), b = ctx.body || {}, admin = ctx.session.user;
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'Registration not found.');
    if (b.status !== 'approved' && b.status !== 'rejected') throw new HttpError(422, 'validation_failed', 'Status must be "approved" or "rejected".');
    const reason = String(b.reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
    if (b.status === 'rejected' && !reason) throw new HttpError(422, 'validation_failed', 'A reason is required when rejecting a registration.', { fields: { reason: 'Enter a reason for rejection.' } });

    await db.tx(async q => {
      const u = await q.get("SELECT id, account_status, email_verified FROM users WHERE id=? AND role='resident'", [id]);
      if (!u) throw new HttpError(404, 'not_found', 'Registration not found.');
      if (!u.email_verified) throw new HttpError(409, 'email_not_verified', 'This resident has not verified their email yet.');
      if (u.account_status !== 'pending') throw new HttpError(409, 'invalid_state', 'This registration was already ' + u.account_status + '.');
      const now = ts();
      // conditional update = atomic: two admins clicking at once cannot both succeed
      const r = b.status === 'approved'
        ? await q.run("UPDATE users SET account_status='approved', approved_at=?, approved_by=?, updated_at=? WHERE id=? AND account_status='pending' AND email_verified=1", [now, admin.id, now, id])
        : await q.run("UPDATE users SET account_status='rejected', rejected_at=?, rejected_by=?, rejection_reason=?, updated_at=? WHERE id=? AND account_status='pending'", [now, admin.id, reason, now, id]);
      if (r.affectedRows !== 1) throw new HttpError(409, 'invalid_state', 'This registration was already decided.');
      if (b.status === 'approved') await notify(q, id, 'account', 'Account Approved', 'Welcome to BarangayDocs! The barangay has approved your account. You may now request digital documents.');
      await sessions.destroyAllFor(q, id);
      await audit(q, { actor: admin.id, action: 'account.' + b.status, target: id, details: b.status === 'rejected' ? { reason } : null, ip: ctx.ip });
    });

    const row = await db.get('SELECT * FROM users WHERE id=?', [id]);
    let emailSent = false;
    if (mailer.isConfigured()) {
      try {
        const m = b.status === 'approved' ? tpl.approvedEmail({ name: row.full_name, loginUrl: cfg.appUrl + '/index.html#login' })
          : tpl.rejectedEmail({ name: row.full_name, reason, registerUrl: cfg.appUrl + '/index.html#register' });
        await mailer.send(Object.assign({ to: row.email }, m)); emailSent = true;
      } catch (e) { log.error('[mail] decision email failed (' + e.code + ')'); }
    }
    await audit(db, { actor: admin.id, action: 'decision.email.' + (emailSent ? 'sent' : 'not_sent'), target: id, ip: ctx.ip });
    return json(200, Object.assign(residentDto(row, cfg), { emailSent }));
  }

  /* GET /admin/residents/:id/id-file  (private upload, admins only) */
  async function idFile(ctx) {
    const id = parseInt(ctx.params.id, 10);
    const row = Number.isSafeInteger(id) ? await db.get("SELECT id_file_path FROM users WHERE id=? AND role='resident'", [id]) : null;
    if (!row || !row.id_file_path) throw new HttpError(404, 'not_found', 'File not found.');
    const p = storage.resolveId(cfg.uploadDir, row.id_file_path);
    if (!fs.existsSync(p)) throw new HttpError(404, 'not_found', 'File not found.');
    await audit(db, { actor: ctx.session.user.id, action: 'id.viewed', target: id, ip: ctx.ip });
    return { status: 200, file: { path: p, mime: storage.mimeFor(p) } };
  }

  return [
    { method: 'GET', path: '/admin/residents', auth: 'admin', handler: list },
    { method: 'PATCH', path: '/admin/residents/:id', auth: 'admin', handler: decide },
    { method: 'GET', path: '/admin/residents/:id/id-file', auth: 'admin', handler: idFile }
  ];
};
