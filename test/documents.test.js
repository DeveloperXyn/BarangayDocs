'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, ts } = require('./helpers');
const { hashPassword } = require('../server/security');
const { readZip } = require('../server/docgen/zip');
const docgen = require('../server/docgen');
const API = '/api/v1';

describe('Official document generation', () => {
  let S, admin, maria, juan, n = 0;
  const mkUser = async (email, name, role = 'resident') => {
    const h = await hashPassword('Str0ng!Pass'), now = ts();
    const r = S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, phone, date_of_birth, role, account_status, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'approved', 1, ?, ?)")
      .run('CID-' + email, name, email, h, '09170000000', '1990-01-01', role, now, now);
    const c = new Client(S.base); assert.equal((await c.login(email, 'Str0ng!Pass')).status, 200); c.uid = Number(r.lastInsertRowid); return c;
  };
  const mkReq = (user, type, purpose, answers, status = 'processing') => {
    const now = ts(), r = S.db.raw.prepare('INSERT INTO requests (tracking_no, user_id, document_type, purpose, form_data, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('BR-TEST-' + (++n), user.uid, type, purpose, JSON.stringify(answers), status, now, now);
    return Number(r.lastInsertRowid);
  };
  const A = (o) => Object.entries(o).map(([label, value]) => ({ label, value }));
  const bin = async (c, p) => { const r = await fetch(S.base + p, { headers: { Cookie: c.cookie } }); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), buf: Buffer.from(await r.arrayBuffer()) }; };
  const docText = buf => { const x = readZip(buf).get('word/document.xml').toString('utf8'); return (x.match(/<w:t[^>]*>[^<]*/g) || []).map(s => s.replace(/<w:t[^>]*>/, '')).join(' ').replace(/&amp;/g, '&'); };

  before(async () => { S = await startServer(); admin = await mkUser('admin@x.ph', 'Ana Reyes', 'admin'); maria = await mkUser('maria@x.ph', 'Maria Santos'); juan = await mkUser('juan@x.ph', 'Juan Dela Cruz'); });
  after(() => S.close());

  test('only signed-in administrators can generate; residents and visitors cannot', async () => {
    const id = mkReq(maria, 'Certificate of Indigency', 'Medical', A({ 'Full Name': 'Maria Santos', Reason: 'Medical' }));
    for (const f of ['', '.docx', '.pdf']) {
      assert.equal((await new Client(S.base).req('GET', API + '/admin/requests/' + id + '/document' + f)).status, 401);
      assert.equal((await maria.req('GET', API + '/admin/requests/' + id + '/document' + f)).status, 403, 'a resident must never reach the official document');
    }
  });

  test('the filled .docx uses the real request data and keeps the official images', async () => {
    const id = mkReq(maria, 'Certificate of Residency', 'Employment', A({ 'Full Name': 'maria  santos', Age: '31', 'Birth Date': '1995-03-14', 'Civil Status': 'Single', 'Residency Date': '2015-06-01', Address: 'Purok 1' }));
    let r = await admin.req('GET', API + '/admin/requests/' + id + '/document'); assert.equal(r.status, 200); assert.equal(r.data.ready, true);
    const w = await bin(admin, API + '/admin/requests/' + id + '/document.docx'); assert.equal(w.status, 200); assert.match(w.type, /wordprocessingml/); assert.match(w.cache, /no-store/);
    const buf = w.buf; assert.ok(buf.length > 1000);
    const txt = docText(buf);
    assert.match(txt, /MARIA SANTOS 31 years old/); assert.match(txt, /MARCH 14, 1995/); assert.match(txt, /Purok 1 Brgy\. Malinta, Los Baños, Laguna/); assert.match(txt, /requirement for Employment/);
    assert.ok(!/\{\{|OCHOA|RITCHIE|NENITA|RODOLFO/.test(txt), 'no placeholder and no other resident\'s sample data may remain');
    const p = await bin(admin, API + '/admin/requests/' + id + '/document.pdf');   // PDF needs LibreOffice: without it the server says so plainly
    assert.ok(p.status === 200 ? p.buf.subarray(0, 4).toString() === '%PDF' : p.status === 501, 'PDF or a clear "LibreOffice missing" answer, got ' + p.status);
    const files = readZip(buf); assert.ok([...files.keys()].filter(k => k.startsWith('word/media/')).length >= 3, 'logo, background and signature are kept');
    assert.ok(![...files.keys()].some(k => /image6/.test(k)), 'the unrelated resident photo from the original file is not carried over');
  });

  test('missing information blocks generation instead of printing an incomplete certificate', async () => {
    const id = mkReq(maria, 'Certificate of Residency', 'Employment', A({ 'Full Name': 'Maria Santos', Age: '31', 'Civil Status': 'Single' }));
    let r = await admin.req('GET', API + '/admin/requests/' + id + '/document'); assert.equal(r.data.ready, false);
    assert.deepEqual(r.data.missing.sort(), ['Address', 'Birth Date', 'Residency Date']);
    r = await admin.req('GET', API + '/admin/requests/' + id + '/document.docx'); assert.equal(r.status, 422); assert.match(r.data.message, /Address/);
  });

  test('the right template is chosen: representative wording, purpose ticks, rejected and untemplated types', async () => {
    const withRep = docgen.prepare({ document_type: 'Certificate of Indigency', purpose: 'Burial', form_data: JSON.stringify(A({ 'Full Name': 'Juan Dela Cruz', Reason: 'Burial', 'Representative’s Name': 'Pedro Dela Cruz', 'Representative’s Age': '21' })) });
    assert.equal(withRep.template, 'indigency-rep'); assert.equal(withRep.values.REP_AGE, '21');
    assert.equal(docgen.prepare({ document_type: 'Certificate of Indigency', purpose: 'x', form_data: JSON.stringify(A({ 'Full Name': 'Juan', Reason: 'Medical' })) }).template, 'indigency');
    const cert = docgen.prepare({ document_type: 'Barangay Certification', purpose: 'Medical', form_data: JSON.stringify(A({ 'Full Name': 'Maria Santos', Nationality: 'Filipino', Purpose: 'Medical', Age: '34', 'Years of Residency': '12', Address: 'Purok 3, Malinta' })) });
    assert.equal(cert.values.PURPOSE_CHECKS, '() financial (/) medical () burial'); assert.equal(cert.values.ADDRESS, 'Purok 3, Malinta', 'address already names Malinta: not repeated');
    const rep = mkReq(juan, 'Certificate of Indigency', 'Medical', A({ 'Full Name': 'Juan Dela Cruz', Reason: 'Medical' }), 'rejected');
    assert.equal((await admin.req('GET', API + '/admin/requests/' + rep + '/document.docx')).status, 409);
    const lor = mkReq(juan, 'Letter of Residency', 'Employment', A({ 'Full Name': 'Juan Dela Cruz' }));
    let r = await admin.req('GET', API + '/admin/requests/' + lor + '/document'); assert.equal(r.data.available, false);
    assert.equal((await admin.req('GET', API + '/admin/requests/' + lor + '/document.docx')).status, 404);
  });

  test('official templates and signature are never reachable from the web', async () => {
    for (const u of ['/server/docgen/templates/residency.docx', '/server/docgen/templates/indigency.docx', '/docgen/templates/residency.docx', '/templates/residency.docx', '/word/media/image4.jpeg', '/tools/build_templates.py'])
      assert.notEqual((await new Client(S.base).req('GET', u)).status, 200, u + ' must not be served');
    const any = await admin.req('GET', '/server/docgen/templates/residency.docx'); assert.notEqual(any.status, 200, 'not even to an administrator');
  });

  test('wording helpers', () => {
    const t = docgen._t;
    assert.equal(t.ordinal(1), '1st'); assert.equal(t.ordinal(2), '2nd'); assert.equal(t.ordinal(3), '3rd'); assert.equal(t.ordinal(11), '11th'); assert.equal(t.ordinal(22), '22nd'); assert.equal(t.ordinal(30), '30th');
    assert.equal(t.address('Purok 5,', true), 'Purok 5 Brgy. Malinta, Los Baños, Laguna');
    assert.equal(t.monthsSince('2015-06-01', { y: 2026, m: 11, d: 9 }), 137);
  });
});

describe('Template placeholders survive Word editing', () => {
  const { fillXml } = require('../server/docgen')._t, V = { NAME: 'MARIA SANTOS', MONTH: 'November' };
  const w = x => '<w:p><w:r><w:t>' + x + '</w:t></w:r></w:p>', txt = x => x.replace(/<[^>]+>/g, '');
  test('split across pieces, any case, spaces inside the braces, repeated', () => {
    assert.equal(txt(fillXml(w('Hi {{NAME}}!'), V)), 'Hi MARIA SANTOS!');
    assert.equal(txt(fillXml('<w:p><w:r><w:t>Hi {{</w:t></w:r><w:proofErr/><w:r><w:rPr><w:b/></w:rPr><w:t>NA</w:t></w:r><w:r><w:t>ME}} in {{ month }}</w:t></w:r></w:p>', V)), 'Hi MARIA SANTOS in November');
    assert.equal(txt(fillXml(w('{{name}} / {{Name}} / {{ NAME }}'), V)), 'MARIA SANTOS / MARIA SANTOS / MARIA SANTOS');
    assert.equal(txt(fillXml(w('A &amp; {{NAME}}'), { NAME: 'D&G <X>' })), 'A &amp; D&amp;G &lt;X&gt;', 'values are XML-escaped');
  });
  test('broken or unknown placeholders refuse to print and say where', () => {
    assert.throws(() => fillXml(w('Hello {{NAME}'), V), /broken near/);
    assert.throws(() => fillXml(w('Hello {{NA ME}}'), V), /broken near/);
    assert.throws(() => fillXml(w('Call {{CONTACT_NUMBER}}'), V), /needs a value for CONTACT_NUMBER/);
  });
});

describe('Generated copy only', () => {
  const { dropTrailingBlank } = require('../server/docgen')._t;
  test('a blank last paragraph is dropped; one with text or a picture is kept', () => {
    const tail = '<w:sectPr><w:pgSz w:w="1" w:h="1"/></w:sectPr></w:body>';
    assert.equal(dropTrailingBlank('<w:p><w:r><w:t>Hi</w:t></w:r></w:p><w:p><w:pPr/></w:p>' + tail), '<w:p><w:r><w:t>Hi</w:t></w:r></w:p>' + tail);
    const keepText = '<w:p><w:r><w:t>Hi</w:t></w:r></w:p>' + tail; assert.equal(dropTrailingBlank(keepText), keepText);
    const keepPic = '<w:p><w:r><w:drawing/></w:r></w:p>' + tail; assert.equal(dropTrailingBlank(keepPic), keepPic);
  });
});
