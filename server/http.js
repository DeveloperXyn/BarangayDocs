'use strict';
class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra || {}; }
}
const json = (status, body, extra) => Object.assign({ status, body }, extra);

function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) { req.resume(); return reject(new HttpError(413, 'payload_too_large', 'The request is too large.')); }
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); reject(new HttpError(413, 'payload_too_large', 'The request is too large.')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
/* multipart/form-data -> { fields:{name:string}, files:{name:{filename,contentType,data:Buffer}} } */
function parseMultipart(buf, contentType, maxParts = 12) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const bad = () => new HttpError(400, 'bad_request', 'Malformed form data.');
  if (!m) throw bad();
  const boundary = m[1] || m[2], delim = Buffer.from('--' + boundary), next = Buffer.from('\r\n--' + boundary);
  const fields = {}, files = {};
  let pos = buf.indexOf(delim); if (pos < 0) throw bad();
  pos += delim.length;
  for (let parts = 0; ; parts++) {
    if (parts > maxParts) throw bad();
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;
    if (buf[pos] !== 0x0d || buf[pos + 1] !== 0x0a) throw bad();
    pos += 2;
    const he = buf.indexOf('\r\n\r\n', pos); if (he < 0) throw bad();
    const head = buf.toString('utf8', pos, he), start = he + 4, end = buf.indexOf(next, start); if (end < 0) throw bad();
    const data = buf.subarray(start, end); pos = end + next.length;
    const disp = /content-disposition:[^\r\n]*/i.exec(head); if (!disp) continue;
    const name = /\bname="([^"]*)"/i.exec(disp[0]), fn = /filename="([^"]*)"/i.exec(disp[0]);
    if (!name) continue;
    if (fn !== null) { const ct = /content-type:\s*([^\r\n;]+)/i.exec(head); if (fn[1]) files[name[1]] = { filename: fn[1], contentType: ct ? ct[1].trim() : '', data }; }
    else fields[name[1]] = data.toString('utf8').slice(0, 8000);
  }
  return { fields, files };
}
module.exports = { HttpError, json, parseCookies, readBody, parseMultipart };
