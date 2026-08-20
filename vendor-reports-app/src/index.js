import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadCentre, periodsFor } from './centre.js';
import { verifySessionToken } from './auth.js';
import { probeGmailSmtp } from './probe.js';
import { getEmailSettings, setEmailSettings, clearEmailSettings, publicView } from './emailSettings.js';
import { verifyCredentials, sendEmail } from './gmail.js';
import { renderEmail, renderSubject } from './renderEmail.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Fixed-destination connectivity check for the Gmail route. Harmless and
// parameterless, so it sits outside auth: it can only ever dial smtp.gmail.com.
app.get('/probe/email', async (_req, res) => res.json(await probeGmailSmtp()));

// One monday read serves every vendor and every period, so the UI stays snappy
// when someone clicks between vendors. Short TTL — the boards change all day.
const TTL_MS = 60_000;
let cache = null;

async function centre() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await loadCentre();
  cache = { at: Date.now(), value };
  return value;
}

const api = express.Router();
api.use(verifySessionToken);

api.get('/centre', async (_req, res, next) => {
  try { res.json(await centre()); } catch (err) { next(err); }
});

api.post('/refresh', async (_req, res, next) => {
  try { cache = null; res.json(await centre()); } catch (err) { next(err); }
});

// ---- email settings (the sending account is data, not code) ---------------

api.get('/settings', async (_req, res, next) => {
  try { res.json(publicView(await getEmailSettings())); } catch (err) { next(err); }
});

api.post('/settings', async (req, res, next) => {
  try {
    const { address, appPassword } = req.body || {};
    if (!address?.includes('@') || !appPassword) {
      return res.status(400).json({ error: 'An email address and an App Password are both required.' });
    }
    const candidate = { address: address.trim(), appPassword };
    await verifyCredentials(candidate); // only store credentials that actually log in
    await setEmailSettings(candidate);
    res.json(publicView(candidate));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.delete('/settings', async (_req, res, next) => {
  try { await clearEmailSettings(); res.json({ connected: false, address: null }); } catch (err) { next(err); }
});

api.post('/settings/test', async (_req, res, next) => {
  try {
    const settings = await getEmailSettings();
    if (!settings) return res.status(400).json({ error: 'No sending account connected yet.' });
    const result = await sendEmail({
      settings,
      to: [settings.address],
      subject: 'Vendor Reports — test email',
      html: '<p>This is a test from the Dragon Transport Vendor Reporting Centre. Sending works.</p>',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- send one vendor's report ---------------------------------------------
// Human-triggered from the report screen. The server re-renders from its own
// data (never trusts HTML from the browser) and sends via the stored account.

api.post('/send', async (req, res, next) => {
  try {
    const { vendorId, periodKey, to } = req.body || {};
    const recipients = [...new Set(String(to || '').split(/[;,]/).map((s) => s.trim()).filter((s) => s.includes('@')))];
    if (!recipients.length) return res.status(400).json({ error: 'Enter at least one recipient email address.' });

    const settings = await getEmailSettings();
    if (!settings) return res.status(400).json({ error: 'Connect a sending account in Settings first.' });

    const data = await centre();
    const vendor = data.vendors.find((v) => String(v.id) === String(vendorId));
    const report = vendor?.reports?.[periodKey];
    const period = data.ranges.find((r) => r.key === periodKey);
    if (!report || !period) return res.status(400).json({ error: 'Unknown vendor or report period.' });

    const result = await sendEmail({
      settings,
      to: recipients,
      subject: renderSubject(report, period.range),
      html: renderEmail(report, period.range, { officePhone: config.officePhone }),
    });
    console.log(`report sent: ${vendor.name} (${periodKey}) -> ${recipients.join(', ')}`);
    res.json({ ok: true, to: recipients, from: settings.address, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/api', api);

// The monday client SDK, served from our own origin rather than a CDN.
app.get('/vendor/monday-sdk.js', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../node_modules/monday-sdk-js/dist/main.js', import.meta.url))));

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => console.log(`vendor reporting centre on ${config.port}`));
