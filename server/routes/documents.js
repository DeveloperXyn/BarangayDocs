'use strict';
/* Official document generation for administrators.
   GET /admin/requests/:id/document       -> readiness check (which template, anything missing, warnings)
   GET /admin/requests/:id/document.pdf   -> print-ready PDF (preview + browser print)
   GET /admin/requests/:id/document.docx  -> the filled Word file
   Admin-only (enforced by the router on the server). Official templates and the signature never leave the server except inside
   the finished document, which is sent with no-store headers and is never written to a public folder. */
const { HttpError, json } = require('../http');
const { audit } = require('../services/common');
const docgen = require('../docgen');

module.exports = function documentRoutes({ db, log = console }) {
  const rid = ctx => { const n = parseInt(ctx.params.id, 10); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'not_found', 'Request not found.'); return n; };
  const load = async ctx => {
    const id = rid(ctx), r = await db.get('SELECT r.*, u.full_name AS resident_name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?', [id]);
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.');
    return r;
  };
  const gate = r => {
    if (r.status === 'rejected') throw new HttpError(409, 'not_allowed', 'A rejected request cannot be issued as an official document.');
    const p = docgen.prepare(r);
    if (!p.available) throw new HttpError(404, 'no_template', p.reason);
    if (!p.ready) throw new HttpError(422, 'incomplete', 'This request is missing: ' + p.missing.join(', ') + '. The document was not generated.', { missing: p.missing });
    return p;
  };
  const safeName = (r, ext) => (r.tracking_no || 'document').replace(/[^\w.-]+/g, '_') + '.' + ext;

  async function check(ctx) {
    const r = await load(ctx), p = docgen.prepare(r);
    return json(200, {
      available: p.available, ready: p.available && p.ready && r.status !== 'rejected', missing: p.missing || [], warnings: p.warnings || [],
      reason: r.status === 'rejected' ? 'A rejected request cannot be issued as an official document.' : p.reason || '',
      documentType: r.document_type, trackingNo: r.tracking_no
    });
  }

  async function build(ctx) {
    const r = await load(ctx), p = gate(r);
    let docx; try { docx = docgen.render(p.template, p.values); } catch (e) { log.error('[docgen] render failed: ' + e.message); throw new HttpError(500, 'render_failed', 'The document could not be prepared: ' + e.message); }
    return { r, p, docx };
  }

  async function pdf(ctx) {
    const { r, p, docx } = await build(ctx);
    let data;
    try { data = await docgen.toPdf(docx); }
    catch (e) {
      log.error('[docgen] pdf failed (' + (e.code || 'error') + ')');
      if (e.code === 'no_converter') throw new HttpError(501, 'no_converter', 'PDF preview needs LibreOffice installed on the server (free: libreoffice.org). You can still download the Word file.');
      throw new HttpError(502, 'convert_failed', 'The PDF could not be created. You can still download the Word file.');
    }
    await audit(db, { actor: ctx.session.user.id, action: 'document.previewed', target: r.user_id, details: { request: r.id, template: p.template }, ip: ctx.ip });
    return { status: 200, buffer: { data, mime: 'application/pdf', disposition: 'inline; filename="' + safeName(r, 'pdf') + '"', frame: true } };
  }

  async function word(ctx) {
    const { r, p, docx } = await build(ctx);
    await audit(db, { actor: ctx.session.user.id, action: 'document.downloaded', target: r.user_id, details: { request: r.id, template: p.template }, ip: ctx.ip });
    return { status: 200, buffer: { data: docx, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', disposition: 'attachment; filename="' + safeName(r, 'docx') + '"' } };
  }

  return [
    { method: 'GET', path: '/admin/requests/:id/document', auth: 'admin', handler: check },
    { method: 'GET', path: '/admin/requests/:id/document.pdf', auth: 'admin', handler: pdf },
    { method: 'GET', path: '/admin/requests/:id/document.docx', auth: 'admin', handler: word }
  ];
};
