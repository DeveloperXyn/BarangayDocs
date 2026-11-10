'use strict';
/* Official document generation.
   - Templates are the barangay's ORIGINAL Word pages (server/docgen/templates/*.docx, built by tools/build_templates.py) with {{PLACEHOLDERS}}.
   - Every value comes from the resident's real request (form answers + profile). Nothing is invented: if something the certificate needs
     is missing, `prepare()` reports it and no document is produced.
   - The PDF used for preview/printing is produced by LibreOffice from the filled .docx. Temp files are deleted right away. */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { readZip, writeZip } = require('./zip');
const { FORMS } = require('../forms');

const DIR = path.join(__dirname, 'templates');
const TZ = 'Asia/Manila';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------- small formatters ---------- */
const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const upper = s => clean(s).toLocaleUpperCase('en-PH');
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const isoParts = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const todayManila = (now = new Date()) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); return isoParts(p); };
const longUpper = iso => { const p = isoParts(iso); return p ? MONTHS[p.m - 1].toUpperCase() + ' ' + p.d + ', ' + p.y : ''; };
function ageOn(iso, t) { const p = isoParts(iso); if (!p) return null; let a = t.y - p.y; if (t.m < p.m || (t.m === p.m && t.d < p.d)) a--; return a; }
function monthsSince(iso, t) { const p = isoParts(iso); if (!p) return null; let n = (t.y - p.y) * 12 + (t.m - p.m); if (t.d < p.d) n--; return Math.max(0, n); }

/* The barangay's own wording: "<address> Brgy. Malinta ..." is added only when the resident's address does not already say Malinta. */
function address(raw, comma) {
  let a = clean(raw).replace(/[\s,.;]+$/, '');
  if (!a) return '';
  if (!/malinta/i.test(a)) a += comma ? ' Brgy. Malinta, Los Baños, Laguna' : ' Brgy. Malinta Los Baños Laguna';
  return a;
}

/* ---------- what each certificate needs and how it is worded ---------- */
const fieldKey = (type, label) => { const f = (FORMS[type] || { fields: [] }).fields.find(x => x.label === label); return f ? f.key : null; };
const answersOf = (type, list) => { const o = {}; for (const a of list || []) { const k = fieldKey(type, a && a.label); if (k) o[k] = clean(a.value); } return o; };
const labelOf = (type, key) => { const f = (FORMS[type] || { fields: [] }).fields.find(x => x.key === key); return f ? f.label : key; };

const SPECS = {
  'Barangay Certification': {
    template: () => 'certification',
    need: ['full_name', 'nationality', 'cert_purpose', 'years_residency', 'address'],
    values: (a, ctx) => ({
      NAME: upper(a.full_name), NATIONALITY: clean(a.nationality), ADDRESS: address(a.address, false), YEARS: String(Number(a.years_residency)),
      PURPOSE_CHECKS: ['Financial', 'Medical', 'Burial'].map(p => (p === a.cert_purpose ? '(/)' : '()') + ' ' + p.toLowerCase()).join(' ')
    })
  },
  'Certificate of Indigency': {
    template: a => (a.representative ? 'indigency-rep' : 'indigency'),
    need: a => ['full_name', 'reason'].concat(a.representative ? ['representative', 'rep_age'] : []),
    values: (a, ctx) => ({ NAME: upper(a.full_name), PURPOSE: clean(a.reason), REP_NAME: upper(a.representative), REP_AGE: String(Number(a.rep_age)) })
  },
  'Certificate of Residency': {
    template: () => 'residency',
    need: ['full_name', 'age', 'birth_date', 'address', 'residency_date'],
    values: (a, ctx) => {
      const m = monthsSince(a.residency_date, ctx.today), y = Math.floor(m / 12);
      return { NAME: upper(a.full_name), AGE: String(Number(a.age)), BIRTH_LONG: longUpper(a.birth_date), ADDRESS: address(a.address, true),
        RESIDENCY: y >= 1 ? y + (y === 1 ? ' year' : ' years') : m >= 1 ? m + (m === 1 ? ' month' : ' months') : 'less than a month',
        PURPOSE: clean(ctx.purpose) };
    },
    extraNeed: ctx => (clean(ctx.purpose) ? [] : ['Purpose of Request']),
    warn: (a, ctx) => { const w = [], c = ageOn(a.birth_date, ctx.today); if (c != null && Math.abs(c - Number(a.age)) > 1) w.push('The age entered (' + a.age + ') does not match the birth date (computed age ' + c + '). Please check before printing.'); return w; }
  }
};

const hasTemplate = type => Object.prototype.hasOwnProperty.call(SPECS, type);

/* Checks a request and builds the values. Returns { available, ready, template, missing[], warnings[], values }. Never throws for data problems. */
function prepare(req, now = new Date()) {
  const type = req.document_type;
  if (!hasTemplate(type)) return { available: false, ready: false, missing: [], warnings: [], reason: 'No official template has been set up for “' + type + '” yet.' };
  const spec = SPECS[type];
  let list = []; try { list = JSON.parse(req.form_data || '[]'); } catch (e) {}
  const a = answersOf(type, list), today = todayManila(now), ctx = { today, purpose: req.purpose };
  const need = typeof spec.need === 'function' ? spec.need(a) : spec.need;
  const missing = need.filter(k => !clean(a[k])).map(k => labelOf(type, k)).concat(spec.extraNeed ? spec.extraNeed(ctx) : []);
  // numbers must be real numbers, dates real dates (otherwise the sentence would print "NaN")
  const numeric = ['age', 'years_residency', 'rep_age'].filter(k => need.includes(k) && clean(a[k]) && !/^\d{1,3}$/.test(a[k])).map(k => labelOf(type, k));
  const dates = ['birth_date', 'residency_date'].filter(k => need.includes(k) && clean(a[k]) && !isoParts(a[k])).map(k => labelOf(type, k));
  const bad = missing.concat(numeric, dates);
  const out = { available: true, template: spec.template(a), missing: bad, warnings: [], ready: bad.length === 0 };
  if (!out.ready) return out;
  out.values = Object.assign(spec.values(a, ctx), { DAY_ORD: ordinal(today.d), MONTH: MONTHS[today.m - 1], YEAR: String(today.y) });
  out.warnings = spec.warn ? spec.warn(a, ctx) : [];
  out.issuedOn = today.y + '-' + String(today.m).padStart(2, '0') + '-' + String(today.d).padStart(2, '0');
  return out;
}

/* ---------- fill the original .docx ---------- */
const cache = new Map();
function loadTemplate(name) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Bad template name.');
  if (!cache.has(name)) cache.set(name, readZip(fs.readFileSync(path.join(DIR, name + '.docx'))));
  return cache.get(name);
}
const textOf = xml => (xml.match(/<w:t[ >][^<]*|<w:t>[^<]*/g) || []).map(s => s.replace(/<w:t[^>]*>/, '')).join('');

/* Word often splits what you type into several pieces ("{{" / "NAME" / "}}"), especially after editing. So placeholders are found in the
   paragraph's joined text and may span pieces; {{ name }}, {{Name}} and {{NAME}} are all accepted. */
const T_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
function fillParagraph(p, values) {
  const segs = []; let m; T_RE.lastIndex = 0;
  while ((m = T_RE.exec(p))) segs.push({ at: m.index, open: m[1], text: m[2], close: m[3], len: m[0].length });
  if (!segs.length) return p;
  let joined = segs.map(x => x.text).join('');
  if (!/\{\{/.test(joined)) return p;
  const toks = []; const R = /\{\{\s*([A-Za-z_]+)\s*\}\}/g; let t;
  while ((t = R.exec(joined))) toks.push({ a: t.index, b: t.index + t[0].length, key: t[1].toUpperCase() });
  for (const tk of toks) if (!(tk.key in values) || !String(values[tk.key]).length) throw new Error('Template needs a value for ' + tk.key + '.');
  for (let n = toks.length - 1; n >= 0; n--) {     // last to first, so earlier offsets stay valid
    const { a, b, key } = toks[n], val = esc(values[key]); let pos = 0, placed = false;
    for (const sg of segs) {
      const s = pos, e = pos + sg.text.length; pos = e;
      if (e <= a || s >= b) continue;
      const from = Math.max(a, s) - s, to = Math.min(b, e) - s;
      sg.text = sg.text.slice(0, from) + (placed ? '' : val) + sg.text.slice(to); placed = true;
    }
  }
  let out = '', last = 0;
  segs.forEach(sg => { out += p.slice(last, sg.at) + sg.open.replace(/ xml:space="[^"]*"/, '').replace(/^<w:t/, '<w:t xml:space="preserve"') + sg.text + sg.close; last = sg.at + sg.len; });
  return out + p.slice(last);
}
function fillXml(xml, values) {
  const filled = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, p => fillParagraph(p, values));
  for (const p of filled.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {   // anything still looking like a placeholder is a broken one: refuse to print
    const txt = (p.match(/<w:t(?:\s[^>]*)?>[^<]*/g) || []).map(x => x.replace(/<w:t[^>]*>/, '')).join('');
    const i = txt.search(/\{\{|\}\}/);
    if (i >= 0) throw new Error('A placeholder in the template is broken near “' + txt.slice(Math.max(0, i - 15), i + 25) + '”. Retype it as {{NAME}} (capital letters, no spaces inside the letters) in one go in Word.');
  }
  return filled;
}

/* The templates fill a whole page edge to edge (zero page margins). When a real name wraps one line longer than the sample, the empty paragraph that
   ends the file can spill onto a blank second page. That last paragraph has no text or pictures, so it is dropped from the generated copy only:
   the stored template is never modified and nothing visible changes. */
function dropTrailingBlank(xml) {
  const i = xml.lastIndexOf('<w:sectPr');
  if (i < 0) return xml;
  const head = xml.slice(0, i), m = /<w:p[ >](?:(?!<w:p[ >])[\s\S])*?<\/w:p>\s*$/.exec(head);
  if (!m || /<w:t[ >]|<w:drawing|<w:pict|<mc:AlternateContent|<w:sectPr|<w:br[ \/]|<w:fldChar|<w:bookmark/.test(m[0])) return xml;
  return head.slice(0, m.index) + xml.slice(i);
}

function render(template, values) {
  const parts = new Map(loadTemplate(template));
  const filled = fillXml(parts.get('word/document.xml').toString('utf8'), values);
  // accuracy gate: the resident's name must really be on the page
  const plain = textOf(filled).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  if (values.NAME && !plain.includes(values.NAME)) throw new Error('The resident’s name did not make it onto the document.');
  parts.set('word/document.xml', dropTrailingBlank(filled));
  const ordered = new Map(); for (const k of ['[Content_Types].xml', '_rels/.rels']) if (parts.has(k)) ordered.set(k, parts.get(k));
  for (const [k, v] of parts) if (!ordered.has(k)) ordered.set(k, v);
  return writeZip(ordered);
}

/* ---------- .docx -> PDF with LibreOffice (one conversion at a time) ---------- */
function findOffice() {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  const c = ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice'];
  return c.find(p => fs.existsSync(p)) || 'soffice';
}
let chain = Promise.resolve();
function toPdf(docx) {
  const job = chain.then(() => convert(docx));
  chain = job.catch(() => {});
  return job;
}
function convert(docx) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdocs-')), file = path.join(dir, 'document.docx'), profile = path.join(os.tmpdir(), 'bdocs-lo-profile');
    const done = (err, pdf) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} err ? reject(err) : resolve(pdf); };
    try { fs.writeFileSync(file, docx, { mode: 0o600 }); } catch (e) { return done(e); }
    let child, finished = false, stderr = '';
    const timer = setTimeout(() => { if (child) child.kill(); fail(Object.assign(new Error('The PDF converter took too long.'), { code: 'convert_timeout' })); }, 90000);
    const fail = e => { if (finished) return; finished = true; clearTimeout(timer); done(e); };
    try {
      child = spawn(findOffice(), ['--headless', '--nologo', '--nolockcheck', '-env:UserInstallation=' + pathToFileURL(profile).href, '--convert-to', 'pdf', '--outdir', dir, file], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: Object.assign({ SAL_USE_VCLPLUGIN: 'svp' }, process.env) });   // svp = no screen needed (servers)
    } catch (e) { return fail(Object.assign(new Error('LibreOffice is not installed.'), { code: 'no_converter' })); }
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => fail(Object.assign(new Error(e.code === 'ENOENT' ? 'LibreOffice is not installed.' : 'The PDF converter could not start.'), { code: e.code === 'ENOENT' ? 'no_converter' : 'convert_failed' })));
    child.on('close', () => {
      if (finished) return;
      const out = path.join(dir, 'document.pdf');
      if (!fs.existsSync(out)) return fail(Object.assign(new Error('The PDF could not be created.'), { code: 'convert_failed' }));
      finished = true; clearTimeout(timer); done(null, fs.readFileSync(out));
    });
  });
}

module.exports = { prepare, render, toPdf, hasTemplate, findOffice, _t: { fillXml, dropTrailingBlank, address, ordinal, monthsSince, ageOn, longUpper } };
