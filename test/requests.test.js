'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, JPEG, ts } = require('./helpers');
const { hashPassword } = require('../server/security');
const API = '/api/v1';

const today = () => new Date().toISOString().slice(0, 10);
const JPG = { name: 'id.jpg', type: 'image/jpeg', data: JPEG };
/* builds a multipart body by hand: text fields + any number of named files */
const submitForm = (typeId, over = {}, answers, files = {}) => {
  const f = Object.assign({ document_type_id: typeId, purpose: 'Employment', comments: 'For work', client_token: 'tok-' + Math.random().toString(36).slice(2, 12), answers: JSON.stringify(answers) }, over);
  const boundary = '----t' + Math.random().toString(36).slice(2), parts = [];
  for (const [k, v] of Object.entries(f)) parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  for (const [k, x] of Object.entries(files)) parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"; filename="' + x.name + '"\r\nContent-Type: ' + x.type + '\r\n\r\n'), x.data, Buffer.from('\r\n'));
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { form: { body: Buffer.concat(parts), boundary }, token: f.client_token };
};
const BID = { last_name: 'Santos', first_name: 'Maria', address: 'x', birth_place: 'y', birth_date: '1995-01-02', gender: 'Female', nationality: 'Filipino', civil_status: 'Single', emergency_name: 'Z', emergency_no: '09170000000' };
const CERT = { full_name: 'Maria Santos', age: '31', civil_status: 'Single', birth_date: '1995-01-02', address: '1 Mabini St' };

describe('BarangayDocs requests, announcements and notifications', () => {
  let S, admin, maria, juan, types;
  const mkUser = async (email, name, role = 'resident') => {
    const h = await hashPassword('Str0ng!Pass'), now = ts();
    S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, phone, date_of_birth, role, account_status, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'approved',1,?,?)").run((role === 'admin' ? 'ADM-' : 'RES-2026-') + Math.floor(Math.random() * 9000 + 1000), name, email, h, '09171234567', '1995-01-02', role, now, now);
    const c = new Client(S.base); const r = await c.login(email, 'Str0ng!Pass'); assert.equal(r.status, 200); return c;
  };
  const typeId = name => String(types.find(t => t.name === name).id);
  const nRows = (sql, ...p) => S.db.raw.prepare(sql).get(...p).n;

  before(async () => {
    S = await startServer(); admin = await mkUser('admin@x.ph', 'Ana Reyes', 'admin'); maria = await mkUser('maria@x.ph', 'Maria Santos'); juan = await mkUser('juan@x.ph', 'Juan Cruz');
    types = (await maria.req('GET', API + '/document-types')).data.data;
  });
  after(() => S.close());

  test('document types are served from the database with their server-defined forms', async () => {
    assert.equal(types.length, 6); const cl = types.find(t => t.name === 'Barangay Clearance');
    assert.ok(cl.fields.some(f => f.type === 'file') && cl.banner);
    assert.equal((await new Client(S.base).req('GET', API + '/document-types')).status, 401);
  });

  test('1-2. announcements reach residents only as notifications; unpublish/delete remove them again', async () => {
    const annNotes = async c => (await c.req('GET', API + '/notifications?limit=50')).data.data.filter(n => n.type === 'announcement');
    let r = await admin.req('POST', API + '/admin/announcements', { json: { title: 'Clean-up Drive', message: 'Saturday 6AM at the plaza.', status: 'draft' } });
    assert.equal(r.status, 201); const id = r.data.id;
    assert.equal((await annNotes(maria)).length, 0, 'drafts notify nobody');
    r = await admin.req('PATCH', API + '/admin/announcements/' + id, { json: { title: 'Clean-up Drive', message: 'Saturday 6AM at the plaza.', status: 'published' } });
    assert.equal(r.status, 200); assert.ok(r.data.publishedAt);
    for (const c of [maria, juan]) { const n = await annNotes(c); assert.equal(n.length, 1); assert.match(n[0].message, /Clean-up Drive/); assert.equal((await c.req('GET', API + '/notifications')).data.unread_count, 1); }
    assert.equal(nRows("SELECT COUNT(*) n FROM notifications WHERE type='announcement'"), 2, 'admins are not notified');
    assert.equal((await maria.req('GET', API + '/announcements')).status, 404, 'there is no resident announcement feed any more');
    // editing a published announcement updates the text in the bell (no new notification)
    await admin.req('PATCH', API + '/admin/announcements/' + id, { json: { title: 'Clean-up Drive', message: 'Moved to Sunday 7AM.', status: 'published' } });
    assert.equal(nRows("SELECT COUNT(*) n FROM notifications WHERE type='announcement'"), 2); assert.match((await annNotes(maria))[0].message, /Sunday 7AM/);
    // unpublish -> gone from every bell, unread count drops
    await admin.req('PATCH', API + '/admin/announcements/' + id, { json: { title: 'Clean-up Drive', message: 'x', status: 'draft' } });
    for (const c of [maria, juan]) { assert.equal((await annNotes(c)).length, 0); assert.equal((await c.req('GET', API + '/notifications')).data.unread_count, 0); }
    // republish -> one notification each again, never two
    await admin.req('PATCH', API + '/admin/announcements/' + id, { json: { title: 'Clean-up Drive', message: 'Back on for Saturday.', status: 'published' } });
    assert.equal(nRows("SELECT COUNT(*) n FROM notifications WHERE type='announcement'"), 2);
    // validation + authorization
    r = await admin.req('POST', API + '/admin/announcements', { json: { title: '', message: '', status: 'published' } }); assert.equal(r.status, 422); assert.ok(r.data.fields.title && r.data.fields.message);
    assert.equal((await maria.req('POST', API + '/admin/announcements', { json: { title: 'a', message: 'b', status: 'published' } })).status, 403);
    assert.equal((await maria.req('DELETE', API + '/admin/announcements/' + id)).status, 403);
    // delete -> removed from the bell too
    assert.equal((await admin.req('DELETE', API + '/admin/announcements/' + id)).status, 204);
    assert.equal(nRows("SELECT COUNT(*) n FROM notifications WHERE type='announcement'"), 0);
    assert.equal((await maria.req('GET', API + '/notifications')).data.unread_count, 0);
    assert.equal((await admin.req('DELETE', API + '/admin/announcements/' + id)).status, 404);
    // leave one published announcement behind for the read/unread test below
    await admin.req('POST', API + '/admin/announcements', { json: { title: 'Office Hours', message: 'Closed Nov 1.', status: 'published' } });
  });

  let req1, tracking;
  test('3. resident submits a request: validation, unique tracking number, correct owner, duplicate protection', async () => {
    const id = typeId('Certificate of Residency');
    let r = await maria.req('POST', API + '/requests', submitForm(id, {}, { full_name: '', age: 'abc' }));
    assert.equal(r.status, 422); assert.ok(r.data.fields.full_name && r.data.fields.age && r.data.fields.birth_date);
    r = await maria.req('POST', API + '/requests', submitForm(id, { purpose: 'Hacking' }, CERT)); assert.equal(r.status, 422); assert.ok(r.data.fields.purpose);
    r = await maria.req('POST', API + '/requests', submitForm('99999', {}, CERT)); assert.equal(r.status, 422);
    assert.equal(nRows('SELECT COUNT(*) n FROM requests'), 0, 'invalid submissions create nothing');
    const RES = Object.assign({}, CERT, { residency_date: '2020-01-01' });
    r = await maria.req('POST', API + '/requests', submitForm(id, {}, RES)); assert.equal(r.status, 422); assert.ok(r.data.fields.valid_id, 'Valid ID upload is required');
    const s = submitForm(id, { comments: '<script>x</script>' }, RES, { valid_id: JPG });
    r = await maria.req('POST', API + '/requests', s); assert.equal(r.status, 201);
    assert.match(r.data.trackingNo, /^BR-\d{4}-\d{5}-[A-HJ-NP-Z2-9]{5}$/); assert.equal(r.data.status, 'pending'); assert.equal(r.data.statusLabel, 'Pending Review');
    req1 = r.data; tracking = r.data.trackingNo;
    const again = await maria.req('POST', API + '/requests', s); assert.equal(again.status, 200); assert.equal(again.data.trackingNo, tracking); assert.equal(again.data.duplicate, true);
    assert.equal(nRows('SELECT COUNT(*) n FROM requests'), 1, 'double-click / retry never creates a second request');
    const row = S.db.raw.prepare('SELECT * FROM requests').get(); assert.equal(row.user_id, S.db.raw.prepare("SELECT id FROM users WHERE email='maria@x.ph'").get().id); assert.equal(row.document_type, 'Certificate of Residency');
    assert.equal(nRows("SELECT COUNT(*) n FROM request_history WHERE event='submitted'"), 1);
    const n = (await maria.req('GET', API + '/notifications')).data; assert.equal(n.data[0].type, 'submitted'); assert.equal(n.data[0].tracking_no, tracking);
    assert.equal((await admin.req('POST', API + '/requests', submitForm(id, {}, CERT))).status, 403, 'admins do not file resident requests');
  });

  test('document-specific uploads: Clearance needs Cedula + Valid ID; Indigency needs the representative ID only when a representative is named', async () => {
    const id = typeId('Barangay Clearance'), A = Object.assign({}, CERT, { gender: 'Female', cedula_no: 'CTC-1', cedula_date: '2026-01-01', cedula_place: 'QC' });
    const before = nRows('SELECT COUNT(*) n FROM request_files');
    let r = await maria.req('POST', API + '/requests', submitForm(id, {}, A)); assert.equal(r.status, 422); assert.ok(r.data.fields.cedula_file && r.data.fields.valid_id);
    r = await maria.req('POST', API + '/requests', submitForm(id, {}, A, { cedula_file: JPG })); assert.equal(r.status, 422); assert.ok(r.data.fields.valid_id && !r.data.fields.cedula_file);
    r = await maria.req('POST', API + '/requests', submitForm(id, {}, A, { cedula_file: JPG, valid_id: { name: 'c.jpg', type: 'image/jpeg', data: Buffer.from('<?php evil ?>') } })); assert.equal(r.status, 422); assert.ok(r.data.fields.valid_id);
    assert.equal(nRows('SELECT COUNT(*) n FROM request_files'), before, 'a rejected submission leaves no files behind');
    r = await maria.req('POST', API + '/requests', submitForm(id, {}, A, { cedula_file: JPG, valid_id: JPG })); assert.equal(r.status, 201);
    const ad = await admin.req('GET', API + '/admin/requests/' + r.data.id); assert.deepEqual(ad.data.files.map(f => f.label), ['Cedula Upload', 'Valid ID']);
    const f = await admin.req('GET', ad.data.files[1].url); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/jpeg');
    assert.equal((await maria.req('GET', ad.data.files[1].url)).status, 403, 'residents cannot download via the admin route');
    assert.equal((await admin.req('GET', API + '/admin/requests/' + (Number(r.data.id) + 99) + '/files/' + ad.data.files[1].url.split('/').pop())).status, 404, 'file ids are tied to their request');
    assert.ok(!JSON.stringify((await maria.req('GET', API + '/requests/' + r.data.trackingNo)).data).match(/stored|valid_id|files/), 'residents never get file paths back');
    // Indigency: recipient ID always, representative ID only when a representative is named
    const ind = typeId('Certificate of Indigency'), I = { full_name: 'Maria Santos', age: '31', civil_status: 'Single', address: '1 Mabini St', reason: 'Medical' };
    r = await maria.req('POST', API + '/requests', submitForm(ind, {}, I)); assert.equal(r.status, 422); assert.ok(r.data.fields.valid_id && !r.data.fields.rep_valid_id);
    r = await maria.req('POST', API + '/requests', submitForm(ind, {}, Object.assign({ representative: 'Pedro Santos', rep_age: '35' }, I), { valid_id: JPG })); assert.equal(r.status, 422); assert.ok(r.data.fields.rep_valid_id && !r.data.fields.valid_id);
    r = await maria.req('POST', API + '/requests', submitForm(ind, {}, Object.assign({ representative: 'Pedro Santos', rep_age: '35' }, I), { valid_id: JPG, rep_valid_id: JPG })); assert.equal(r.status, 201);
    assert.equal(nRows('SELECT COUNT(*) n FROM request_files WHERE request_id=?', Number(r.data.id)), 2);
    r = await maria.req('POST', API + '/requests', submitForm(ind, {}, I, { valid_id: JPG })); assert.equal(r.status, 201, 'no representative -> no representative ID needed');
    // no age limit on the document forms (registration is the only 18+ gate); the representative's age is required once a representative is named
    const { validate, FORMS } = require('../server/forms'), V = x => validate('Certificate of Indigency', Object.assign({}, I, x), '2026-11-05').errors;
    assert.equal(V({ age: '10' }).age, undefined, 'a young recipient is accepted on the form'); assert.ok(V({ age: '0' }).age, 'but the age must still be a real number');
    assert.ok(V({ representative: 'Pedro Santos' }).rep_age, 'representative age is required once a representative is named');
    assert.equal(V({ representative: 'Pedro Santos', rep_age: '17' }).rep_age, undefined);
    assert.equal(V({ rep_age: '12' }).rep_age, undefined, 'ignored when nobody is representing');
    assert.ok(Object.values(FORMS).every(f => f.fields.every(x => !x.prefill)), 'no form field is pre-filled');
    assert.ok(FORMS['Certificate of Indigency'].fields.find(x => x.key === 'address').placeholder, 'address shows a Purok example');
    // every remaining built-in type asks for a Valid ID too
    for (const n of ['Barangay Certification', 'Barangay ID', 'Certificate of Residency', 'Letter of Residency']) assert.ok(types.find(t => t.name === n).fields.some(f => f.key === 'valid_id' && f.type === 'file'), n);
  });

  test('3/6. request appears for admin and ONLY for its owner; other residents get 404', async () => {
    let r = await admin.req('GET', API + '/admin/requests'); assert.equal(r.status, 200); assert.equal(r.data.total, 4);
    const mine = r.data.data.find(x => x.trackingNo === tracking); assert.equal(mine.residentName, 'Maria Santos'); assert.equal(mine.documentType, 'Certificate of Residency');
    r = await maria.req('GET', API + '/requests'); assert.equal(r.data.total, 4); assert.equal(r.data.counts.pending, 4);
    r = await juan.req('GET', API + '/requests'); assert.equal(r.data.total, 0); assert.equal(r.data.counts.pending, 0);
    assert.equal((await juan.req('GET', API + '/requests/' + tracking)).status, 404);
    assert.equal((await maria.req('GET', API + '/requests/' + tracking)).status, 200);
    assert.equal((await maria.req('GET', API + '/admin/requests')).status, 403);
    assert.equal((await maria.req('PATCH', API + '/admin/requests/' + req1.id, { json: { action: 'approve', claim_date: today() } })).status, 403);
    assert.equal((await new Client(S.base).req('GET', API + '/requests')).status, 401);
    const own = (await maria.req('GET', API + '/requests/' + tracking)).data; assert.ok(!('adminNotes' in own) && !('form_data' in own) && !('userId' in own));
  });

  test('admin search, filters and pagination work against real data', async () => {
    const g = async q => (await admin.req('GET', API + '/admin/requests?' + q)).data;
    assert.equal((await g('q=' + tracking.toLowerCase())).total, 1); assert.equal((await g('q=maria')).total, 4); assert.equal((await g('q=nobody')).total, 0);
    assert.equal((await g('q=%25')).total, 0, 'LIKE wildcards are escaped');
    assert.equal((await g('type=' + encodeURIComponent('Barangay Clearance'))).total, 1); assert.equal((await g('status=ready')).total, 0); assert.equal((await g('status=pending')).total, 4);
    assert.equal((await g('limit=1&page=2')).data.length, 1); assert.equal((await g('limit=1')).pages, 4);
    assert.equal((await g('from=' + encodeURIComponent(new Date(Date.now() + 864e5).toISOString()))).total, 0);
    const mp = await maria.req('GET', API + '/requests?q=' + tracking); assert.equal(mp.data.total, 1);
    const d = (await admin.req('GET', API + '/admin/dashboard?today=' + new Date(Date.now() - 36e5).toISOString())).data; assert.equal(d.receivedToday, 4); assert.equal(d.pending, 4);
  });

  test('4-5. status flow: transitions are enforced, each change notifies the resident once, history is kept', async () => {
    const id = req1.id, p = (json) => admin.req('PATCH', API + '/admin/requests/' + id, { json });
    let r = await p({ action: 'complete' }); assert.equal(r.status, 409, 'cannot complete a pending request');
    r = await p({ action: 'approve' }); assert.equal(r.status, 422); assert.ok(r.data.fields.claim_date);
    r = await p({ action: 'reject' }); assert.equal(r.status, 422); assert.ok(r.data.fields.reason);
    r = await p({ action: 'bogus' }); assert.equal(r.status, 422);
    assert.equal((await admin.req('PATCH', API + '/admin/requests/' + id, { json: { action: 'start' }, csrf: false })).status, 403);
    r = await p({ action: 'start', notes: 'ID matches registry' }); assert.equal(r.status, 200); assert.equal(r.data.status, 'processing'); assert.equal(r.data.adminNotes, 'ID matches registry');
    assert.equal((await p({ action: 'start' })).status, 409, 'repeating a status change is refused (no duplicate notification)');
    r = await p({ action: 'info', message: 'Please bring a valid ID.' }); assert.equal(r.status, 200); assert.equal(r.data.status, 'processing');
    r = await p({ action: 'approve', claim_date: '2099-01-15' }); assert.equal(r.data.status, 'ready'); assert.equal(r.data.claimDate, '2099-01-15');
    assert.equal((await p({ action: 'reject', reason: 'late' })).status, 409);
    r = await p({ action: 'complete' }); assert.equal(r.data.status, 'completed'); assert.equal((await p({ action: 'start' })).status, 409);
    assert.deepEqual(r.data.history.map(h => h.event), ['submitted', 'processing', 'info', 'ready', 'completed']);
    const ns = (await maria.req('GET', API + '/notifications?limit=50')).data.data.filter(n => n.tracking_no === tracking);
    assert.deepEqual(ns.map(n => n.type).sort(), ['approved', 'processing', 'processing', 'ready', 'submitted']);
    // resident view: updated status, public history only, admin notes never exposed
    const own = (await maria.req('GET', API + '/requests/' + tracking)).data; assert.equal(own.status, 'completed'); assert.equal(own.history.length, 5);
    assert.ok(!JSON.stringify(own).includes('ID matches registry'), 'internal admin notes never reach the resident');
    assert.equal((await juan.req('GET', API + '/notifications')).data.data.filter(n => n.tracking_no).length, 0, 'other residents get no request notifications');
    assert.equal((await maria.req('GET', API + '/requests')).data.counts.completed, 1);
  });

  test('rejection reason reaches the resident; notes can be saved on their own', async () => {
    const cl = (await admin.req('GET', API + '/admin/requests?status=pending')).data.data[0];
    let r = await admin.req('PATCH', API + '/admin/requests/' + cl.id, { json: { action: 'reject', reason: 'Cedula is expired.', notes: 'internal: expired 2024' } });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'rejected'); assert.deepEqual(r.data.allowed, []);
    const own = (await maria.req('GET', API + '/requests/' + cl.trackingNo)).data; assert.equal(own.residentNote, 'Cedula is expired.'); assert.ok(!JSON.stringify(own).includes('internal'));
    const n = (await maria.req('GET', API + '/notifications?limit=50')).data.data.find(x => x.type === 'rejected'); assert.match(n.message, /Cedula is expired/);
    r = await admin.req('PATCH', API + '/admin/requests/' + cl.id, { json: { action: 'note', notes: 'closed' } }); assert.equal(r.status, 200); assert.equal(r.data.adminNotes, 'closed');
  });

  test('5. read/unread: mark one, mark all, scoped to the owner, persists across logout/login', async () => {
    let n = (await maria.req('GET', API + '/notifications?limit=50')).data; const unread = n.unread_count; assert.ok(unread >= 5);
    const one = n.data.find(x => !x.read_at);
    assert.equal((await juan.req('PATCH', API + '/notifications/' + one.id + '/read')).status, 404, "cannot touch someone else's notification");
    assert.equal((await maria.req('GET', API + '/notifications')).data.unread_count, unread);
    assert.ok((await maria.req('PATCH', API + '/notifications/' + one.id + '/read')).data.read_at);
    assert.equal((await maria.req('GET', API + '/notifications')).data.unread_count, unread - 1);
    await maria.req('PATCH', API + '/notifications/' + one.id + '/read'); assert.equal((await maria.req('GET', API + '/notifications')).data.unread_count, unread - 1, 'idempotent');
    const again = new Client(S.base); await again.login('maria@x.ph', 'Str0ng!Pass');
    assert.equal((await again.req('GET', API + '/notifications')).data.unread_count, unread - 1, 'still there after logging in again');
    await again.req('POST', API + '/notifications/read-all'); assert.equal((await again.req('GET', API + '/notifications')).data.unread_count, 0);
    assert.ok((await juan.req('GET', API + '/notifications')).data.unread_count >= 1, "other resident's unread count is untouched");
  });

  test('admin reports/dashboard match the database; document types CRUD', async () => {
    const rp = (await admin.req('GET', API + '/admin/reports')).data; assert.equal(rp.total, 4); assert.equal(rp.approved, 1); assert.equal(rp.rejected, 1); assert.equal(rp.pending, 2);
    assert.equal(rp.byType.reduce((a, b) => a + b.count, 0), 4); assert.ok(rp.activity.length >= 1 && /Maria Santos/.test(rp.activity[0].text));
    assert.equal((await admin.req('POST', API + '/admin/document-types', { json: { name: 'Business Permit', description: 'Small business clearance' } })).status, 405, 'adding document types is no longer possible');
    const tid = types.find(t => t.name === 'Letter of Residency').id;
    assert.equal((await admin.req('PATCH', API + '/admin/document-types/' + tid, { json: { name: 'Letter of Residency', description: '', active: true } })).status, 422);
    await admin.req('PATCH', API + '/admin/document-types/' + tid, { json: { name: 'Letter of Residency', description: 'Proof of at least 6 months of residency', active: false } });
    assert.ok(!(await maria.req('GET', API + '/document-types')).data.data.some(t => t.name === 'Letter of Residency'), 'inactive types are hidden from residents');
    assert.equal((await maria.req('POST', API + '/requests', submitForm(tid, {}, {}))).status, 422, 'and cannot be requested');
    assert.equal((await maria.req('PATCH', API + '/admin/document-types/' + tid, { json: { name: 'x', description: 'y' } })).status, 403);
    // deleting a type keeps existing requests
    const used = types.find(t => t.name === 'Certificate of Residency').id;
    assert.equal((await admin.req('DELETE', API + '/admin/document-types/' + used)).status, 204);
    assert.equal((await admin.req('GET', API + '/admin/requests')).data.total, 4); assert.equal((await maria.req('GET', API + '/requests/' + tracking)).data.documentType, 'Certificate of Residency');
  });

  test('no preferred date; purpose is not asked twice when the form already asks it', async () => {
    const cert = typeId('Barangay Certification'), t = types.find(t => t.name === 'Barangay Certification');
    assert.ok(!JSON.stringify(types).includes('preferred'), 'no form asks for a preferred date');
    assert.ok(t.fields.find(f => f.key === 'cert_purpose').isPurpose);
    const A = { full_name: 'Maria Santos', nationality: 'Filipino', civil_status: 'Single', cert_purpose: 'Medical', age: '31', years_residency: '9', address: '1 Mabini St' };
    // no separate "purpose" field is sent at all -> the answer to the form's own Purpose is used
    let r = await maria.req('POST', API + '/requests', submitForm(cert, { purpose: '' }, A, { valid_id: JPG })); assert.equal(r.status, 201);
    assert.equal(S.db.raw.prepare('SELECT purpose FROM requests WHERE id=?').get(Number(r.data.id)).purpose, 'Medical');
    // a form WITHOUT its own purpose still needs the shared one
    r = await maria.req('POST', API + '/requests', submitForm(typeId('Barangay ID'), { purpose: '' }, BID, { valid_id: JPG })); assert.equal(r.status, 422); assert.ok(r.data.fields.purpose);
  });

  let infoReq;
  test('additional information: resident can answer only while it is requested, with text and/or an image', async () => {
    const sub = await maria.req('POST', API + '/requests', submitForm(typeId('Barangay ID'), {}, BID, { valid_id: JPG }));
    infoReq = sub.data; const trk = infoReq.trackingNo, respond = (fields, files = {}) => maria.req('POST', API + '/requests/' + trk + '/respond', { form: submitForm('1', {}, {}, files).form && (() => { const b = '----r' + Math.random().toString(36).slice(2), parts = []; for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n')); for (const [k, x] of Object.entries(files)) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"; filename="' + x.name + '"\r\nContent-Type: ' + x.type + '\r\n\r\n'), x.data, Buffer.from('\r\n')); parts.push(Buffer.from('--' + b + '--\r\n')); return { body: Buffer.concat(parts), boundary: b }; })() });
    assert.equal((await maria.req('GET', API + '/requests/' + trk)).data.infoRequested, false);
    assert.equal((await respond({ message: 'hello' })).status, 409, 'nothing was requested yet');
    await admin.req('PATCH', API + '/admin/requests/' + infoReq.id, { json: { action: 'info', message: 'Please send a clearer ID photo.' } });
    let own = (await maria.req('GET', API + '/requests/' + trk)).data; assert.equal(own.infoRequested, true); assert.equal(own.residentNote, 'Please send a clearer ID photo.');
    assert.equal((await juan.req('POST', API + '/requests/' + trk + '/respond', { form: { body: Buffer.from('--x--\r\n'), boundary: 'x' } })).status, 404, 'someone else cannot answer');
    let r = await respond({ message: '' }); assert.equal(r.status, 422); assert.ok(r.data.fields.message);
    r = await respond({ message: 'x' }, { image: { name: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 x') } }); assert.equal(r.status, 422); assert.ok(r.data.fields.image, 'images only');
    r = await respond({ message: 'Here is a clearer photo.' }, { image: JPG }); assert.equal(r.status, 200); assert.equal(r.data.infoRequested, false);
    assert.equal((await respond({ message: 'again' })).status, 409, 'cannot answer twice');
    const ad = (await admin.req('GET', API + '/admin/requests/' + infoReq.id)).data;
    assert.deepEqual(ad.history.map(h => h.event), ['submitted', 'info', 'reply']); assert.equal(ad.history[2].note, 'Here is a clearer photo.');
    assert.ok(ad.files.some(f => f.label === 'Additional information (image)'));
    assert.equal(ad.status, 'pending', 'status is unchanged by the reply');
    await admin.req('PATCH', API + '/admin/requests/' + infoReq.id, { json: { action: 'info', message: 'One more thing.' } });
    assert.equal((await maria.req('GET', API + '/requests/' + trk)).data.infoRequested, true, 'a second request re-opens the box');
  });

  test('public tracking: only the timeline, nothing private, not guessable', async () => {
    const anon = new Client(S.base), trk = infoReq.trackingNo;
    await admin.req('PATCH', API + '/admin/requests/' + infoReq.id, { json: { action: 'reject', reason: 'ID is still unreadable.', notes: 'SECRET internal note' } });
    const r = await anon.req('GET', API + '/public/track/' + trk.toLowerCase());
    assert.equal(r.status, 200, 'no sign-in needed (and the code is case-insensitive)');
    assert.deepEqual(Object.keys(r.data).sort(), ['status', 'statusLabel', 'submittedAt', 'timeline', 'trackingNo', 'updatedAt']);
    assert.deepEqual(r.data.timeline.map(t => t.event), ['submitted', 'info', 'reply', 'info', 'rejected']);
    assert.equal(r.data.timeline[4].note, 'ID is still unreadable.'); assert.equal(r.data.timeline[1].note, 'Please send a clearer ID photo.');
    const raw = JSON.stringify(r.data);
    for (const secret of ['Maria', 'maria@x.ph', '09171234567', 'Mabini', 'Barangay ID', 'SECRET', 'clearer photo.', 'files', 'valid_id', 'RES-2026']) assert.ok(!raw.includes(secret.replace('clearer photo.', 'Here is a clearer photo')), 'public response leaks: ' + secret);
    assert.ok(!raw.includes('Here is a clearer photo'), "what the resident wrote is never public");
    // approved/ready exposes only the claim date
    const sub = (await maria.req('POST', API + '/requests', submitForm(typeId('Barangay ID'), {}, BID, { valid_id: JPG }))).data;
    await admin.req('PATCH', API + '/admin/requests/' + sub.id, { json: { action: 'approve', claim_date: '2099-02-03', message: 'Bring a pen and a pink folder' } });
    const ready = (await anon.req('GET', API + '/public/track/' + sub.trackingNo)).data; assert.equal(ready.timeline[1].claimDate, '2099-02-03'); assert.ok(!JSON.stringify(ready).includes('pink folder'));
    // guessing: wrong suffix, counting up, old format, junk -> the same 404
    const base = trk.split('-').slice(0, 3).join('-');
    for (const bad of [base + '-AAAAA', 'BR-2026-00001', 'BR-2026-00001-AAAAA', "BR-2026-00001-' OR 1=1", '../../etc/passwd', 'x'.repeat(200)]) { const g = await anon.req('GET', API + '/public/track/' + encodeURIComponent(bad)); assert.equal(g.status, 404, bad); assert.equal(g.data.message, 'We couldn’t find a request with that tracking code. Check the code and try again.'); }
    // rate limit
    let last; for (let i = 0; i < 25; i++) last = await anon.req('GET', API + '/public/track/BR-2026-00001-AAAAA'); assert.equal(last.status, 429);
    assert.equal((await new Client(S.base).req('GET', API + '/requests/' + trk)).status, 401, 'the signed-in details stay private');
  });

  test('announcements: 50-character title, full text readable for the expanded notification', async () => {
    let r = await admin.req('POST', API + '/admin/announcements', { json: { title: 'x'.repeat(51), message: 'm', status: 'draft' } }); assert.equal(r.status, 422); assert.match(r.data.fields.title, /50/);
    const long = Array.from({ length: 50 }, (_, i) => 'Line ' + i + ' of a very long announcement.').join('\n');
    r = await admin.req('POST', API + '/admin/announcements', { json: { title: 'y'.repeat(50), message: long, status: 'published' } }); assert.equal(r.status, 201);
    const n = (await maria.req('GET', API + '/notifications?limit=50')).data.data.find(x => x.announcement_id === r.data.id);
    assert.ok(n && n.message.length <= 500, 'the bell keeps a short preview');
    const full = await maria.req('GET', API + '/announcements/' + r.data.id); assert.equal(full.status, 200); assert.equal(full.data.message, long); assert.equal(full.data.title.length, 50);
    assert.equal((await maria.req('GET', API + '/announcements/' + r.data.id + '9')).status, 404);
    await admin.req('PATCH', API + '/admin/announcements/' + r.data.id, { json: { title: 'y', message: long, status: 'draft' } });
    assert.equal((await maria.req('GET', API + '/announcements/' + r.data.id)).status, 404, 'unpublished -> no longer readable');
    await admin.req('DELETE', API + '/admin/announcements/' + r.data.id);
  });
});
