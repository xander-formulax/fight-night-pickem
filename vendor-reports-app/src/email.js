// Email adapter. `console` is the default so nothing can be sent by accident
// before a provider is chosen and a sending domain is set up.

import { config } from './config.js';

async function sendViaPostmark({ to, subject, html, from, apiKey }) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': apiKey,
    },
    body: JSON.stringify({ From: from, To: to.join(','), Subject: subject, HtmlBody: html, MessageStream: 'outbound' }),
  });
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
  return { id: (await res.json()).MessageID, driver: 'postmark' };
}

async function sendViaResend({ to, subject, html, from, apiKey }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return { id: (await res.json()).id, driver: 'resend' };
}

export async function sendEmail({ to, subject, html }) {
  const recipients = config.redirectTo ? [config.redirectTo] : to;
  const payload = { to: recipients, subject, html, from: config.emailFrom, apiKey: config.emailApiKey };

  switch (config.emailDriver) {
    case 'postmark': return sendViaPostmark(payload);
    case 'resend': return sendViaResend(payload);
    default:
      console.log(`[email:console] to=${recipients.join(',')} subject="${subject}" bytes=${html.length}`);
      return { id: null, driver: 'console' };
  }
}
