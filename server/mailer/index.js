'use strict';
/* Reusable email service. The rest of the app only calls mailer.isConfigured() and mailer.send({to,subject,html,text}). */
const providers = require('./providers');
class MailError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function createMailer(cfg, log = console) {
  const p = providers[cfg.provider];
  const configured = () => !!(p && cfg.apiKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.fromAddress));
  return {
    isConfigured: configured,
    async send(msg) {
      if (!configured()) throw new MailError('not_configured', 'Email provider is not configured.');
      const req = p.build(cfg, msg), url = (cfg.apiBaseUrl || p.baseUrl).replace(/\/+$/, '') + req.path;
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, req.headers),
          body: JSON.stringify(req.body), signal: AbortSignal.timeout(10000) });
      } catch (e) { throw new MailError('network', 'Could not reach the email provider (' + (e.name || 'error') + ').'); }
      if (!res.ok) { let why = ''; try { why = (await res.text()).slice(0, 300); } catch (e) {} log.error('[mail] provider ' + cfg.provider + ' answered HTTP ' + res.status + (why ? ' - ' + why : '')); throw new MailError('provider_' + res.status, 'The email provider rejected the message (HTTP ' + res.status + ').'); }
    }
  };
}
module.exports = { createMailer, MailError };
