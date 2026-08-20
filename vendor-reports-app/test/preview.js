// Renders the fixture to sample-email.html so the template can be eyeballed
// without touching the monday API or sending anything.
import { writeFileSync } from 'node:fs';
import { buildReport } from '../src/buildReport.js';
import { renderEmail, renderSubject } from '../src/renderEmail.js';
import { vendor, jobs, tasksById, week } from './fixture.js';

const report = buildReport({ vendor, jobs, tasksById, week });
writeFileSync(new URL('../sample-email.html', import.meta.url), renderEmail(report));

console.log('subject:', renderSubject(report));
console.log('homes:  ', report.activeHomes, '| completed this week:', report.completedCount);
for (const j of report.jobs) {
  console.log(`  ${j.name}: ${j.progress.done}/${j.progress.total} (${j.progress.pct}%)` +
    ` done=[${j.completed.map((c) => c.name).join(', ')}]` +
    ` pending=[${j.pending.map((p) => `${p.name}/${p.status}`).join(', ')}]`);
}
