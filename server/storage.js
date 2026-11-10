'use strict';
/* Private storage for uploaded valid IDs. Files live outside the web root and are only served to admins. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const TYPES = [
  { ext: '.jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', test: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.pdf', mime: 'application/pdf', test: b => b.subarray(0, 5).toString('latin1') === '%PDF-' }
];
const detect = buf => TYPES.find(t => t.test(buf)) || null;
async function saveId(dir, buf, type) {
  await fs.promises.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(20).toString('hex') + type.ext;
  await fs.promises.writeFile(path.join(dir, name), buf, { mode: 0o600, flag: 'wx' });
  return name;
}
const removeId = (dir, name) => name ? fs.promises.unlink(resolveId(dir, name)).catch(() => {}) : Promise.resolve();
function resolveId(dir, name) {
  const p = path.resolve(dir, path.basename(String(name)));
  if (path.dirname(p) !== path.resolve(dir)) throw new Error('bad path');
  return p;
}
const mimeFor = name => (TYPES.find(t => String(name).endsWith(t.ext)) || {}).mime || 'application/octet-stream';
module.exports = { detect, saveId, removeId, resolveId, mimeFor };
