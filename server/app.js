'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HttpError, parseCookies, readBody, parseMultipart } = require('./http');
const { RateLimiter } = require('./rateLimit');
const sessions = require('./services/sessions');
const { safeEqual } = require('./security');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
/* ONLY these files are public. Everything else (server/, database/, storage/, .env, scripts/...) can never be served. */
const PUBLIC_FILE = /^\/(index\.html|app\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js|assets\/(img|fonts)\/[\w.-]+)$/;
const PRIVATE_FILE = '/js/portal.js';   // the whole signed-in app: only sent to a valid session
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function createApp({ config: cfg, db, mailer, log = console }) {
  const limiter = new RateLimiter(), deps = { config: cfg, db, mailer, limiter, log };
  const routes = [].concat(require('./routes/auth')(deps), require('./routes/admin')(deps), require('./routes/notifications')(deps), require('./routes/requests')(deps), require('./routes/adminRequests')(deps), require('./routes/announcements')(deps), require('./routes/hall')(deps), require('./routes/documents')(deps), require('./routes/publicTrack')(deps))
    .map(r => ({ ...r, re: new RegExp('^' + r.path.replace(/:[a-z]+/g, '([^/]+)') + '$'), keys: (r.path.match(/:[a-z]+/g) || []).map(k => k.slice(1)) }));

  const ipOf = req => (cfg.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '';
  const originOk = req => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host || o === cfg.appUrl; } catch (e) { return false; } };

  function send(res, r) {
    const headers = Object.assign({ 'Cache-Control': 'no-store' }, r.headers);
    if (r.cookies && r.cookies.length) headers['Set-Cookie'] = r.cookies;
    if (r.file) {
      Object.assign(headers, { 'Content-Type': r.file.mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store' });
      res.writeHead(r.status, headers); return fs.createReadStream(r.file.path).on('error', () => res.destroy()).pipe(res);
    }
    if (r.buffer) {   // generated official documents: private, never cached, never sniffed
      Object.assign(headers, { 'Content-Type': r.buffer.mime, 'Content-Disposition': r.buffer.disposition, 'Cache-Control': 'private, no-store', 'Content-Length': r.buffer.data.length });
      if (r.buffer.frame) headers['Content-Security-Policy'] = "frame-ancestors 'self'";   // the browser's PDF viewer needs this narrower policy to render inside our preview
      res.writeHead(r.status, headers); return res.end(r.buffer.data);
    }
    if (r.status === 204 || r.body == null) { res.writeHead(r.status === 200 ? 204 : r.status, headers); return res.end(); }
    headers['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(r.status, headers); res.end(JSON.stringify(r.body));
  }
  const sendError = (res, e) => {
    if (!(e instanceof HttpError)) { log.error('[server] unhandled error:', e && e.stack || e); e = new HttpError(500, 'server_error', 'Something went wrong. Please try again.'); }
    const headers = {}; if (e.extra && e.extra.retryAfter) headers['Retry-After'] = String(e.extra.retryAfter);
    send(res, { status: e.status, headers, body: Object.assign({ code: e.code, message: e.message }, e.extra) });
  };

  async function handleApi(req, res, url) {
    const sub = url.pathname.slice(cfg.apiBase.length) || '/', method = req.method;
    let route = null, params = {}, pathMatched = false;
    for (const r of routes) { const m = r.re.exec(sub); if (!m) continue; pathMatched = true; if (r.method !== method) continue; route = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
    if (!route) throw pathMatched ? new HttpError(405, 'method_not_allowed', 'Method not allowed.') : new HttpError(404, 'not_found', 'Not found.');
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && !originOk(req)) throw new HttpError(403, 'bad_origin', 'Cross-site request blocked.');

    const session = await sessions.load(db, parseCookies(req.headers.cookie)[sessions.COOKIE]);
    if (route.auth) {
      if (!session) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
      if (route.auth === 'resident' && session.user.role !== 'resident') throw new HttpError(403, 'forbidden', 'This action is only available to residents.');
      if (route.auth === 'admin' && session.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'You do not have access to this resource.');
      if (mutating && !safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) throw new HttpError(403, 'csrf_failed', 'Your session token is invalid. Reload the page and try again.');
    }
    const ctx = { req, res, params, session, query: url.searchParams, ip: ipOf(req), body: null, fields: {}, files: {} };
    if (mutating) {
      const ct = String(req.headers['content-type'] || '');
      if (route.multipart) {
        if (!/^multipart\/form-data/i.test(ct)) throw new HttpError(415, 'unsupported_media_type', 'Expected form data.');
        const p = parseMultipart(await readBody(req, route.maxBytes || 6 * 1024 * 1024), ct, route.maxParts || 12); ctx.fields = p.fields; ctx.files = p.files;
      } else {
        const buf = await readBody(req, 100 * 1024);
        if (buf.length) { if (!/^application\/json/i.test(ct)) throw new HttpError(415, 'unsupported_media_type', 'Expected JSON.'); try { ctx.body = JSON.parse(buf.toString('utf8')); } catch (e) { throw new HttpError(400, 'bad_request', 'Malformed JSON.'); } }
      }
    }
    let out = await route.handler(ctx);
    if (out && out.status === undefined) out = { status: 200, body: out };
    send(res, out || { status: 204 });
  }

  async function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let p = url.pathname; if (p === '/') p = '/index.html';
    if (!PUBLIC_FILE.test(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    if (p === PRIVATE_FILE && !(await sessions.load(db, parseCookies(req.headers.cookie)[sessions.COOKIE]))) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Sign in required'); }
    fs.readFile(path.join(cfg.root, p), (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': p === PRIVATE_FILE ? 'private, no-store' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  const listener = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', CSP);
    if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === cfg.apiBase || url.pathname.startsWith(cfg.apiBase + '/')) await handleApi(req, res, url);
      else await handleStatic(req, res, url);
    } catch (e) { if (!res.headersSent) sendError(res, e); else res.destroy(); }
  };
  const timer = setInterval(() => { sessions.purgeExpired(db).catch(() => {}); }, 3600e3); timer.unref();
  return { listener, limiter, close() { clearInterval(timer); clearInterval(limiter.t); } };
}
module.exports = { createApp };
