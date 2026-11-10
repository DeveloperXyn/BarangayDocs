'use strict';
/* Shared request logic: status labels, allowed transitions, DTOs, list filters, and the one place that changes a request's status. */
const { ts, iso } = require('../db');
const { HttpError } = require('../http');
const { audit, notify, cleanText } = require('./common');

const STATUS = ['pending', 'processing', 'ready', 'completed', 'rejected'];
const LABEL = { pending: 'Pending Review', processing: 'Processing', ready: 'Ready for Claim', completed: 'Completed', rejected: 'Rejected' };
const EVENT_LABEL = { reply: 'Additional Information Provided', submitted: 'Submitted', processing: 'Under Processing', ready: 'Ready for Claim', completed: 'Completed', rejected: 'Rejected', info: 'Additional Information Requested' };
/* action -> { from: statuses it may start from, to: resulting status (null = status stays) } */
const ACTIONS = {
  start: { from: ['pending'], to: 'processing' },
  approve: { from: ['pending', 'processing'], to: 'ready' },
  reject: { from: ['pending', 'processing'], to: 'rejected' },
  info: { from: ['pending', 'processing'], to: null },
  complete: { from: ['ready'], to: 'completed' }
};
const pad = (n, w) => String(n).padStart(w, '0');
/* Codes carry a random 5-character suffix (BR-2026-00125-K7Q9X) so a code cannot be guessed by counting. Older codes without a suffix still work for signed-in residents. */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const trackingFor = (id, now = new Date()) => 'BR-' + now.getUTCFullYear() + '-' + pad(id, 5) + '-' + Array.from({ length: 5 }, () => ALPHA[require('crypto').randomInt(ALPHA.length)]).join('');
const PUBLIC_CODE = /^BR-\d{4}-\d{5}-[A-HJ-NP-Z2-9]{5}$/;
const likeEsc = s => '%' + String(s).toLowerCase().replace(/[\\%_]/g, c => '\\' + c) + '%';
const isDate = v => { const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? new Date(v + 'T00:00:00Z') : null; return !!d && !isNaN(d) && d.toISOString().slice(0, 10) === v; };
const isoToTs = v => { const d = new Date(String(v || '')); return v && !isNaN(d) ? ts(d) : null; };
const pageOf = (query, def = 10) => {
  const limit = Math.min(Math.max(parseInt(query.get('limit'), 10) || def, 1), 50), page = Math.max(parseInt(query.get('page'), 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
};
/* Builds the WHERE fragments shared by resident and admin lists. Everything user-supplied goes through placeholders. */
function filters(query, { admin }) {
  const c = [], p = [], status = query.get('status'), type = query.get('type'), q = String(query.get('q') || '').trim().slice(0, 60);
  if (STATUS.includes(status)) { c.push('r.status=?'); p.push(status); }
  if (query.get('active') === '1') c.push("r.status IN ('pending','processing','ready')");
  if (type) { c.push('r.document_type=?'); p.push(type.slice(0, 80)); }
  const from = isoToTs(query.get('from')), to = isoToTs(query.get('to'));
  if (from) { c.push('r.created_at>=?'); p.push(from); }
  if (to) { c.push('r.created_at<?'); p.push(to); }
  if (q) {
    if (admin) { c.push("(LOWER(r.tracking_no) LIKE ? ESCAPE '\\' OR LOWER(u.full_name) LIKE ? ESCAPE '\\' OR LOWER(u.citizen_id) LIKE ? ESCAPE '\\')"); p.push(likeEsc(q), likeEsc(q), likeEsc(q)); }
    else { c.push("LOWER(r.tracking_no) LIKE ? ESCAPE '\\'"); p.push(likeEsc(q)); }
  }
  return { c, p };
}
const countsOf = rows => { const o = { pending: 0, processing: 0, ready: 0, completed: 0, rejected: 0 }; rows.forEach(r => { o[r.status] = Number(r.n); }); return o; };
const histDto = h => ({ event: h.event, status: h.status, label: EVENT_LABEL[h.event] || LABEL[h.status], note: h.note || '', at: iso(h.created_at) });

/* what a RESIDENT may see: never admin notes, form internals, attachment paths or other people's data */
const residentDto = (r, history) => Object.assign({
  id: String(r.id), trackingNo: r.tracking_no, documentType: r.document_type, purpose: r.purpose, status: r.status, statusLabel: LABEL[r.status],
  submittedAt: iso(r.created_at), updatedAt: iso(r.updated_at), claimDate: r.claim_date || null,
  comments: r.comments || '', residentNote: r.resident_note || ''
}, history ? { history: history.map(histDto) } : {});

/* The ONLY place a request's status changes: validates the transition, updates atomically, records history, and notifies the resident once. */
async function applyAction(db, admin, id, body, ip) {
  const a = ACTIONS[body.action];
  const notesGiven = typeof body.notes === 'string', notes = notesGiven ? cleanText(body.notes, 1000, true) : null;
  if (body.action !== 'note' && !a) throw new HttpError(422, 'validation_failed', 'Unknown action.');
  const reason = cleanText(body.reason, 500), message = cleanText(body.message, 500), claim = String(body.claim_date || '').trim();
  const fields = {};
  if (body.action === 'reject' && !reason) fields.reason = 'Enter a reason for rejection.';
  if (body.action === 'info' && !message) fields.message = 'Tell the resident what is missing.';
  if (body.action === 'approve' && !isDate(claim)) fields.claim_date = 'Choose a valid claim date.';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Please correct the highlighted fields.', { fields });

  return db.tx(async q => {
    const r = await q.get('SELECT * FROM requests WHERE id=?', [id]);
    if (!r) throw new HttpError(404, 'not_found', 'Request not found.');
    const now = ts();
    if (body.action === 'note') {
      if (!notesGiven) throw new HttpError(422, 'validation_failed', 'Nothing to save.');
      await q.run('UPDATE requests SET admin_notes=?, updated_at=? WHERE id=?', [notes || null, now, id]);
      await audit(q, { actor: admin.id, action: 'request.note', target: r.user_id, details: { request: r.tracking_no }, ip });
      return;
    }
    if (!a.from.includes(r.status)) throw new HttpError(409, 'invalid_transition', 'This request is already "' + LABEL[r.status] + '" and cannot be changed that way.');
    const ev = a.to || 'info', note = body.action === 'approve' ? ['Claim date: ' + claim, message].filter(Boolean).join('. ') : (reason || message || null);
    const resNote = body.action === 'approve' ? (message || null) : (reason || message || null);
    const set = a.to
      ? await q.run('UPDATE requests SET status=?, claim_date=COALESCE(?, claim_date), resident_note=?, admin_notes=COALESCE(?, admin_notes), updated_at=? WHERE id=? AND status=?', [a.to, body.action === 'approve' ? claim : null, resNote, notes, now, id, r.status])
      : await q.run('UPDATE requests SET resident_note=?, admin_notes=COALESCE(?, admin_notes), updated_at=? WHERE id=? AND status=?', [resNote, notes, now, id, r.status]);
    if (set.affectedRows !== 1) throw new HttpError(409, 'invalid_transition', 'Someone else just updated this request. Reload and try again.');
    const h = await q.run('INSERT INTO request_history (request_id, event, status, note, actor_user_id, created_at) VALUES (?,?,?,?,?,?)', [id, ev, a.to || r.status, note ? note.slice(0, 500) : null, admin.id, now]);
    const T = r.document_type, N = r.tracking_no, ref = 'req:' + id + ':h' + h.insertId, opt = { tracking: N, ref };
    if (ev === 'processing') await notify(q, r.user_id, 'processing', 'Request being reviewed', 'Your ' + T + ' request (' + N + ') is now being reviewed by barangay staff.', opt);
    else if (ev === 'ready') await notify(q, r.user_id, 'ready', 'Document Ready for Claim', 'Your ' + T + ' (' + N + ') has been approved and is ready for pickup on ' + claim + '. Please proceed to the Barangay Hall Express Counter.' + (message ? ' ' + message : ''), opt);
    else if (ev === 'completed') await notify(q, r.user_id, 'approved', 'Request Completed', 'Your ' + T + ' (' + N + ') has been claimed. Thank you for using BarangayDocs.', opt);
    else if (ev === 'rejected') await notify(q, r.user_id, 'rejected', 'Request Rejected', 'Your ' + T + ' request (' + N + ') was not approved. Reason: ' + reason, opt);
    else await notify(q, r.user_id, 'processing', 'Additional Information Needed', 'For your ' + T + ' request (' + N + '): ' + message, opt);
    await audit(q, { actor: admin.id, action: 'request.' + body.action, target: r.user_id, details: { request: N, from: r.status, to: a.to || r.status }, ip });
  });
}
module.exports = { PUBLIC_CODE, STATUS, LABEL, ACTIONS, trackingFor, likeEsc, isDate, isoToTs, pageOf, filters, countsOf, histDto, residentDto, applyAction };
