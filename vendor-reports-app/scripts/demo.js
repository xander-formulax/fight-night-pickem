// Local UI development server. Serves the real frontend against the recorded
// board snapshot in test/real-data.js, so the centre can be worked on without
// a monday token and without touching the account.
//
//   npm run demo   ->  http://localhost:8080
//
// This is a dev tool. It is not imported by src/ and never runs on monday-code.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { buildReport } from '../src/buildReport.js';
import { periodsFor } from '../src/centre.js';
import { formatDay, formatWeekRange } from '../src/week.js';
import { vendors, jobsByVendor, tasksById } from '../test/real-data.js';

const TODAY = process.env.DEMO_TODAY || '2026-08-20';
const label = (d) => (d ? formatDay(d) : null);

function centre() {
  const periods = periodsFor(TODAY);
  return {
    today: TODAY,
    ranges: periods.map((p) => ({ key: p.key, label: p.label, range: formatWeekRange(p) })),
    vendors: vendors.map((v) => {
      const reports = {};
      for (const p of periods) {
        const rep = buildReport({
          vendor: v, jobs: jobsByVendor[v.id], tasksById,
          week: { start: p.start, end: p.end }, today: TODAY,
        });
        for (const j of rep.jobs) {
          j.lastActivityLabel = label(j.lastActivity);
          j.nextScheduledLabel = label(j.nextScheduled);
        }
        reports[p.key] = rep;
      }
      const live = reports['this-week'];
      return {
        id: v.id, name: v.name, homes: live.activeHomes, counts: live.counts,
        lastActivity: live.lastActivity, lastActivityLabel: label(live.lastActivity),
        nextScheduled: live.nextScheduled, nextScheduledLabel: label(live.nextScheduled),
        reports,
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    readiness: { note: 'demo snapshot' },
  };
}

const app = express();
app.get('/api/centre', (_req, res) => res.json(centre()));
app.post('/api/refresh', (_req, res) => res.json(centre()));
app.get('/vendor/monday-sdk.js', (_req, res) => res.type('js').send('window.mondaySdk=null;'));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`demo centre on http://localhost:${port}  (snapshot, today=${TODAY})`));
