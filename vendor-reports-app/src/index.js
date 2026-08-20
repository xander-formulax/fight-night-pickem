import express from 'express';
import { config } from './config.js';
import { runWeek, previewVendor } from './run.js';
import { verifySessionToken } from './auth.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// --- scheduled run -----------------------------------------------------------
// Registered with:
//   mapps scheduler:create -a APP_ID -s "0 20 * * 5" -u "weekly-reports" \
//     -n "weekly-vendor-reports" -z us -r 3 -t 300
//
// Cron is UTC and does not follow US daylight saving: "0 20 * * 5" is 3:00 PM
// Central in summer, 2:00 PM in winter.
//
// Retries are expected, so the run is idempotent — a vendor already recorded
// for this week is skipped rather than sent to twice.
app.post('/mndy-cronjob/weekly-reports', async (_req, res) => {
  try {
    const summary = await runWeek({});
    console.log('weekly run', JSON.stringify(summary.tally));
    res.json(summary);
  } catch (err) {
    console.error('weekly run failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- app UI ------------------------------------------------------------------
const api = express.Router();
api.use(verifySessionToken);

api.get('/week', async (_req, res, next) => {
  try { res.json(await runWeek({ dryRun: true })); } catch (err) { next(err); }
});

api.get('/report/:vendorId', async (req, res, next) => {
  try {
    const { report, subject, readiness } = await previewVendor({ vendorId: req.params.vendorId });
    res.json({ report, subject, readiness });
  } catch (err) { next(err); }
});

api.get('/report/:vendorId/preview', async (req, res, next) => {
  try {
    const { html } = await previewVendor({ vendorId: req.params.vendorId });
    res.type('html').send(html);
  } catch (err) { next(err); }
});

api.post('/report/:vendorId/send', async (req, res, next) => {
  try {
    const summary = await runWeek({ onlyVendorIds: [String(req.params.vendorId)], force: Boolean(req.body?.force) });
    res.json(summary);
  } catch (err) { next(err); }
});

app.use('/api', api);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => console.log(`vendor-reports listening on ${config.port}`));
