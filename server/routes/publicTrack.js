'use strict';
/* Public request tracking (landing page, no sign-in). Privacy rules:
   - only the exact code entered is looked up; codes carry a random suffix so they cannot be guessed or counted up to;
   - the answer contains ONLY the status and the timeline (dates + the staff's status message). No name, email, phone, address,
     document type, uploaded files, internal notes, or anything the resident typed;
   - unknown, malformed and older-format codes all get the same "not found" reply, and lookups are rate-limited per IP. */
const { iso } = require('../db');
const { HttpError, json } = require('../http');
const S = require('../services/requests');
const { limit } = require('../services/common');

const PUBLIC_LABEL = { submitted: 'Request Submitted', processing: 'Under Processing', info: 'Additional Information Requested', reply: 'Additional Information Provided', ready: 'Approved · Ready for Release', completed: 'Completed', rejected: 'Rejected' };

module.exports = function publicTrackRoutes({ db, limiter }) {
  async function track(ctx) {
    limit(limiter, 'track:ip:' + ctx.ip + ':min', 20, 60e3, 'rate_limited', 'Too many lookups. Please wait a minute and try again.');
    limit(limiter, 'track:ip:' + ctx.ip + ':hr', 200, 3600e3, 'rate_limited', 'Too many lookups. Please try again later.');
    const code = String(ctx.params.code || '').trim().toUpperCase();
    const notFound = () => new HttpError(404, 'not_found', 'We couldn’t find a request with that tracking code. Check the code and try again.');
    if (!S.PUBLIC_CODE.test(code)) throw notFound();
    const r = await db.get('SELECT id, tracking_no, status, created_at, updated_at FROM requests WHERE tracking_no=?', [code]);
    if (!r) throw notFound();
    const h = await db.all('SELECT event, status, note, created_at FROM request_history WHERE request_id=? ORDER BY id', [r.id]);
    const timeline = h.map(x => {
      const o = { event: x.event, label: PUBLIC_LABEL[x.event] || S.LABEL[x.status], at: iso(x.created_at), note: '', claimDate: null };
      if (x.event === 'rejected' || x.event === 'info') o.note = x.note || '';                            // the reason / what staff asked for
      if (x.event === 'ready') { const m = /^Claim date: (\d{4}-\d{2}-\d{2})/.exec(x.note || ''); o.claimDate = m ? m[1] : null; }
      return o;                                                                                           // 'reply' notes (what the resident wrote) are never included
    });
    return json(200, { trackingNo: r.tracking_no, status: r.status, statusLabel: S.LABEL[r.status], submittedAt: iso(r.created_at), updatedAt: iso(r.updated_at), timeline });
  }
  return [{ method: 'GET', path: '/public/track/:code', handler: track }];
};
