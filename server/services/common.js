'use strict';
const { ts, iso } = require('../db');
const { HttpError } = require('../http');

async function audit(q, { actor = null, action, target = null, details = null, ip = null }) {
  await q.run('INSERT INTO audit_log (actor_user_id, action, target_user_id, details, ip_address, created_at) VALUES (?,?,?,?,?,?)',
    [actor, action, target, details ? JSON.stringify(details) : null, ip, ts()]);
}
const clip = (v, n) => { v = String(v == null ? '' : v); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
/* Inserts ONE notification. `ref` identifies the event (e.g. 'req:12:h40'); a repeated call with the same ref is a no-op,
   so refreshing the page or repeating a database operation never produces a duplicate. */
async function notify(q, userId, type, title, message, { tracking = null, ref = null } = {}) {
  const r = await q.run('INSERT INTO notifications (user_id, type, title, message, tracking_no, ref_key, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (user_id, ref_key) DO NOTHING',
    [userId, type, clip(title, 150), clip(message, 500), tracking, ref, ts()]);
  return r.affectedRows;
}
/* Control characters out, whitespace tidy, length capped (server-side sanitising of free text). Multi-line text keeps its line breaks. */
const cleanText = (v, max, multiline) => String(v == null ? '' : v).replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').replace(multiline ? /[ \t]+/g : /\s+/g, ' ').trim().slice(0, max);
/* Resident object expected by js/portal.js */
function residentDto(r, cfg) {
  return { id: String(r.id), citizenId: r.citizen_id, name: r.full_name, email: r.email, phone: r.phone || '', dob: r.date_of_birth || '',
    createdAt: iso(r.created_at), status: r.account_status, note: r.rejection_reason || '', decidedAt: iso(r.approved_at || r.rejected_at),
    emailVerified: !!r.email_verified, idFileName: r.id_file_name || '',
    idUrl: r.id_file_path ? cfg.apiBase + '/admin/residents/' + r.id + '/id-file' : null };
}
function limit(limiter, key, max, windowMs, code = 'rate_limited', msg = 'Too many attempts. Please wait a moment and try again.') {
  const r = limiter.hit(key, max, windowMs);
  if (!r.ok) throw new HttpError(429, code, msg, { retryAfter: r.retryAfter });
}
module.exports = { audit, notify, cleanText, residentDto, limit };
