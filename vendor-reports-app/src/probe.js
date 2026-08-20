// Answers one question: can this host open an SMTP connection to Gmail?
// No auth and no parameters on purpose — it can only ever talk to
// smtp.gmail.com, reads the greeting banner, and hangs up.
import net from 'node:net';
import tls from 'node:tls';

const HOST = 'smtp.gmail.com';
const TIMEOUT = 8000;

function attempt(port, useTls) {
  return new Promise((resolve) => {
    const done = (result) => { try { socket.destroy(); } catch { /* closed */ } resolve({ port, ...result }); };
    const socket = useTls
      ? tls.connect({ host: HOST, port, timeout: TIMEOUT, servername: HOST })
      : net.connect({ host: HOST, port, timeout: TIMEOUT });

    let banner = '';
    socket.on('data', (chunk) => {
      banner += chunk.toString('utf8');
      if (banner.includes('\n')) done({ ok: banner.startsWith('220'), banner: banner.trim().slice(0, 80) });
    });
    socket.on('timeout', () => done({ ok: false, error: 'timeout — port likely blocked' }));
    socket.on('error', (err) => done({ ok: false, error: `${err.code || ''} ${err.message}`.trim() }));
  });
}

export async function probeGmailSmtp() {
  const [p465, p587] = await Promise.all([attempt(465, true), attempt(587, false)]);
  return {
    host: HOST,
    results: [p465, p587],
    verdict: p465.ok || p587.ok
      ? 'SMTP reachable — the app password route will work.'
      : 'SMTP blocked from this host — we fall back to the OAuth route.',
  };
}
