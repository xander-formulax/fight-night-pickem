// Sends through Gmail's own servers (smtp.gmail.com) authenticated as the
// configured account — to Google and to every receiving mailbox this is the
// same as that person pressing Send by hand. Requires a Gmail App Password
// (Google Account -> Security -> 2-Step Verification -> App passwords).
import nodemailer from 'nodemailer';

function transport({ address, appPassword }) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: address, pass: appPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

/** Check the credentials actually log in. Throws with a readable message. */
export async function verifyCredentials(settings) {
  try {
    await transport(settings).verify();
  } catch (err) {
    if (err?.code === 'EAUTH') {
      throw new Error('Gmail rejected the sign-in. Check the address, and make sure this is an App Password (not the normal account password).');
    }
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET' || err?.code === 'ECONNECTION') {
      throw new Error(`Could not reach Gmail's mail server from this host (${err.code}). Outbound SMTP may be blocked.`);
    }
    throw new Error(`Gmail connection failed: ${err.message}`);
  }
}

export async function sendEmail({ settings, to, subject, html }) {
  const info = await transport(settings).sendMail({
    from: settings.address,
    to: to.join(', '),
    subject,
    html,
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
