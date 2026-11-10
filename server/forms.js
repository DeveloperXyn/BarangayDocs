'use strict';
/* Single source of truth for the document-specific application forms (what the resident fills in, and what the server validates).
   The resident portal renders its forms from GET /document-types, so the browser and the server can never disagree.
   Document types an admin adds later have no document-specific fields: they only use the shared "Application Details" step. */
const CS = ['Single', 'Married', 'Widowed', 'Separated'], PU = ['Medical', 'Financial', 'Burial'], GN = ['Male', 'Female'];
const F = (key, label, extra) => Object.assign({ key, label, type: 'text', required: true }, extra);
const NAME = F('full_name', 'Full Name'), AGE = F('age', 'Age', { type: 'number', min: 1, max: 120 });
const CIVIL = F('civil_status', 'Civil Status', { type: 'select', options: CS }), BIRTH = F('birth_date', 'Birth Date', { type: 'date', max: 'today' });
const ADDR = F('address', 'Address', { wide: true, max: 200, placeholder: 'e.g., Purok 1', help: 'Start with your Purok or street, e.g., Purok 1.' });
const IDHELP = 'JPG, PNG or PDF, maximum 5 MB.';
const VALID_ID = (label = 'Valid ID', extra) => F('valid_id', label, Object.assign({ type: 'file', wide: true, help: IDHELP }, extra));

const FORMS = {
  'Barangay Certification': { fields: [NAME, F('nationality', 'Nationality'), CIVIL, F('cert_purpose', 'Purpose', { type: 'select', options: PU, isPurpose: true, help: 'Available purposes: Medical, Financial, Burial.' }), AGE, F('years_residency', 'Years of Residency', { type: 'number', min: 0, max: 120 }), ADDR, VALID_ID()] },
  'Barangay Clearance': {
    fields: [NAME, AGE, CIVIL, BIRTH, ADDR, F('gender', 'Gender', { type: 'select', options: GN }), F('cedula_no', 'Cedula Number', { max: 40 }), F('cedula_date', 'Cedula Issue Date', { type: 'date', max: 'today' }), F('cedula_place', 'Cedula Place of Issue'),
      F('cedula_file', 'Cedula Upload', { type: 'file', wide: true, help: IDHELP }), VALID_ID()],
    banner: ['Cedula Required', 'A current Cedula is required for Barangay Clearance. Complete all Cedula details and upload a readable copy of your Cedula and a valid ID before continuing.'],
    guide: [['Cedula Required', 'Provide your current Cedula number, issue date, place of issue and a clear uploaded copy.']]
  },
  'Certificate of Indigency': { fields: [NAME, AGE, CIVIL, ADDR,
    F('representative', 'Representative’s Name', { required: false }),
    F('rep_age', 'Representative’s Age', { type: 'number', min: 1, max: 120, requiredIf: 'representative', help: 'Required when a representative is named.' }),
    F('reason', 'Reason', { type: 'select', options: PU, isPurpose: true, help: 'Available reasons: Medical, Financial, Burial.' }), VALID_ID('Valid ID of the Recipient'), VALID_ID('Valid ID of the Representative', { key: 'rep_valid_id', requiredIf: 'representative', help: 'Required only when a representative will claim the document. ' + IDHELP })] },
  'Barangay ID': { fields: [F('last_name', 'Last Name'), F('first_name', 'First Name'), F('middle_name', 'Middle Name', { required: false }), ADDR, F('birth_place', 'Birth Place', { wide: true }), BIRTH, F('gender', 'Gender', { type: 'select', options: GN }), F('nationality', 'Nationality'), CIVIL, F('emergency_name', 'Emergency Contact Name'), F('emergency_no', 'Emergency Contact Number', { pattern: '^09\\d{9}$', patternMsg: 'Enter a mobile number like 09XX XXX XXXX.' }), VALID_ID()] },
  'Certificate of Residency': { fields: [NAME, AGE, BIRTH, CIVIL, F('residency_date', 'Residency Date', { type: 'date', max: 'today' }), ADDR, VALID_ID()] },
  'Letter of Residency': {
    fields: [NAME, F('letter_date', 'Date', { type: 'date', max: 'today' }), F('letter_file', 'Letter of Residency Upload', { type: 'file', wide: true, help: IDHELP }), VALID_ID()],
    banner: ['Proof of at least 6 months of residency', 'This application is for a Letter of Residency confirming that you have lived in the barangay for at least six months.'],
    guide: [['Letter of Residency', 'This letter provides proof of at least 6 months of residency. It is distinct from a Certificate of Residency.']]
  }
};
const PURPOSES = ['Medical Assistance', 'Financial Assistance', 'Burial Assistance', 'Employment', 'School Requirement', 'Other'];
const GUIDE = [['Proof of Residency', 'Ensure your address matches your registration profile. Present 1 valid government ID upon claims.'], ['No Pending Obligations', 'Make sure you do not have active municipal penalties or pending dues on record.'], ['Claim Procedure', 'Bring your verification claim number and SMS notification when visiting the Express counter.']];

const formFor = name => FORMS[name] || { fields: [] };
const fileFields = name => formFor(name).fields.filter(f => f.type === 'file');
/* some forms already ask WHY the document is needed (Purpose / Reason); the shared details step then must not ask again */
const purposeField = name => formFor(name).fields.find(f => f.isPurpose) || null;

/* Validates the submitted answers against the form. Returns { answers:[{label,value}], errors:{key:msg} } (never trusts the browser). */
function validate(name, input, todayStr) {
  const answers = [], errors = {}, src = input && typeof input === 'object' ? input : {};
  for (const f of formFor(name).fields) {
    if (f.type === 'file') continue;   // checked separately (it arrives as a file, not text)
    if (f.requiredIf && f.type !== 'file' && !String(src[f.requiredIf] == null ? '' : src[f.requiredIf]).trim()) continue;   // only applies once the field it depends on is filled in
    let v = String(src[f.key] == null ? '' : src[f.key]).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const bad = m => { errors[f.key] = m; };
    if (!v) { if (f.required) bad(f.label + ' is required.'); continue; }
    if (v.length > (f.max && f.type === 'text' ? f.max : 200)) { bad(f.label + ' is too long.'); continue; }
    if (f.type === 'select' && !f.options.includes(v)) bad('Choose a valid ' + f.label.toLowerCase() + '.');
    else if (f.type === 'number') { const n = Number(v); if (!/^\d{1,3}$/.test(v) || n < (f.min == null ? 0 : f.min) || n > (f.max || 999)) bad(f.minMsg && /^\d{1,3}$/.test(v) && n < f.min ? f.minMsg : 'Enter a valid number for ' + f.label.toLowerCase() + '.'); else v = String(n); }
    else if (f.type === 'date') { const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : null; if (!d || isNaN(d) || d.toISOString().slice(0, 10) !== v || d.getUTCFullYear() < 1900) bad('Enter a valid date for ' + f.label.toLowerCase() + '.'); else if (f.max === 'today' && v > todayStr) bad(f.label + ' cannot be in the future.'); }
    else if (f.pattern && !new RegExp(f.pattern).test(v.replace(/\s/g, ''))) bad(f.patternMsg || 'Invalid value.');
    if (f.pattern && !errors[f.key]) v = v.replace(/\s/g, '');
    if (!errors[f.key]) answers.push({ label: f.label, value: v });
  }
  return { answers, errors };
}
module.exports = { FORMS, PURPOSES, GUIDE, formFor, fileFields, purposeField, validate };
