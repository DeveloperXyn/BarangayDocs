'use strict';
/* Each provider turns a normalized message into an HTTP request. Add a provider = add one entry here. */
module.exports = {
  brevo: {   // https://developers.brevo.com/reference/sendtransacemail
    baseUrl: 'https://api.brevo.com',
    build: (c, m) => ({ path: '/v3/smtp/email', headers: { 'api-key': c.apiKey },
      body: { sender: { name: c.fromName, email: c.fromAddress }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text } })
  },
  resend: {  // https://resend.com/docs/api-reference/emails/send-email
    baseUrl: 'https://api.resend.com',
    build: (c, m) => ({ path: '/emails', headers: { Authorization: 'Bearer ' + c.apiKey },
      body: { from: c.fromName + ' <' + c.fromAddress + '>', to: [m.to], subject: m.subject, html: m.html, text: m.text } })
  }
};
