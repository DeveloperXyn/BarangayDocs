'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0284c7;padding:18px 28px;color:#ffffff;font-size:20px;font-weight:bold">BarangayDocs</td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:20px;color:#0f172a">${esc(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">This is an automated message from BarangayDocs. Please do not reply.</td></tr>
</table></td></tr></table></body></html>`;
}
const p = t => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">${t}</p>`;
const button = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;font-size:15px">${esc(label)}</a></p>`;

function otpEmail({ name, code, ttlMin, purpose }) {
  const reset = purpose === 'reset', first = esc(String(name || '').split(' ')[0] || 'there');
  const subject = reset ? 'Your BarangayDocs password reset code' : 'Your BarangayDocs verification code';
  const html = layout(reset ? 'Reset your password' : 'Verify your email address',
    p('Hi ' + first + ',') + p(reset ? 'Use this code to reset your BarangayDocs password:' : 'Use this code to verify your email address and finish registering:') +
    `<p style="margin:18px 0;text-align:center"><span style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:bold;font-family:'Courier New',monospace;background:#f0f9ff;border:1px solid #bae6fd;color:#075985;padding:14px 22px;border-radius:10px">${esc(code)}</span></p>` +
    p('This code expires in <b>' + esc(ttlMin) + ' minutes</b> and can be used only once.') +
    `<p style="margin:0;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;line-height:1.5;color:#92400e"><b>Security notice:</b> Never share this code with anyone. BarangayDocs staff will never ask for it. If you did not request it, you can ignore this email.</p>`);
  const text = `Hi ${String(name || '').split(' ')[0] || 'there'},\n\nYour BarangayDocs ${reset ? 'password reset' : 'verification'} code is: ${code}\n\nIt expires in ${ttlMin} minutes and can be used once.\nNever share this code with anyone. If you did not request it, ignore this email.`;
  return { subject, html, text };
}
function approvedEmail({ name, loginUrl }) {
  const subject = 'Your Account Has Been Approved';
  const html = layout('Your account is approved', p('Hi ' + esc(name) + ',') +
    p('Good news! The barangay has verified your registration. Your BarangayDocs account is now <b>approved</b>, and you can log in to request documents online.') + button(loginUrl, 'Log in to BarangayDocs') +
    p('If the button does not work, copy this link into your browser:<br>' + esc(loginUrl)));
  return { subject, html, text: `Hi ${name},\n\nYour BarangayDocs account has been approved. You can now log in: ${loginUrl}` };
}
function rejectedEmail({ name, reason, registerUrl }) {
  const subject = 'Your BarangayDocs Registration Was Not Approved';
  const html = layout('Registration not approved', p('Hi ' + esc(name) + ',') +
    p('We could not approve your registration for the following reason:') +
    `<p style="margin:0 0 14px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:14px;color:#991b1b">${esc(reason)}</p>` +
    p('You may register again with a clearer valid ID and matching details.') + button(registerUrl, 'Register again'));
  return { subject, html, text: `Hi ${name},\n\nYour BarangayDocs registration was not approved.\nReason: ${reason}\n\nYou may register again: ${registerUrl}` };
}
module.exports = { otpEmail, approvedEmail, rejectedEmail };
