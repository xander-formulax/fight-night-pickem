// Builds every vendor's report from live monday data and prints what WOULD be
// sent. Sends nothing — there is no email code path in here at all.
//
//   MONDAY_API_TOKEN=xxx npm run dry-run
//
// Add --write to also save each report as an .html file you can open.

import { writeFileSync, mkdirSync } from 'node:fs';
import { config } from '../src/config.js';
import { loadReportData } from '../src/monday.js';
import { buildReport } from '../src/buildReport.js';
import { renderEmail, renderSubject } from '../src/renderEmail.js';
import { accountReadiness, checkVendor } from '../src/readiness.js';
import { reportWeek, addDays, formatWeekRange } from '../src/week.js';

const write = process.argv.includes('--write');
const OUT = new URL('../out/', import.meta.url);

if (!config.mondayToken) {
  console.error('\n  Missing MONDAY_API_TOKEN.\n');
  console.error('  Get one at: monday.com -> your avatar -> Developers -> My Access Tokens');
  console.error('  Then run:   MONDAY_API_TOKEN=your_token_here npm run dry-run\n');
  process.exit(1);
}

const week = reportWeek();
console.log(`\nReport week: ${formatWeekRange(week)}\n`);
console.log('Reading monday...');

const data = await loadReportData({
  token: config.mondayToken,
  recentlyCompletedSince: addDays(week.start, -config.completedGraceDays),
});

console.log(`Found ${data.totalJobs} jobs, ${data.tasksById.size} linked tasks, ${data.vendorsById.size} vendors.\n`);

if (write) mkdirSync(OUT, { recursive: true });

const rows = [];
for (const [vendorId, jobs] of data.jobsByVendorId) {
  const vendor = data.vendorsById.get(vendorId);
  if (!vendor) continue;

  const report = buildReport({ vendor, jobs, tasksById: data.tasksById, week });
  const ready = checkVendor(vendor, jobs);

  rows.push({
    Vendor: vendor.name.slice(0, 30),
    Homes: report.activeHomes,
    'Done this week': report.completedCount,
    Recipients: vendor.recipients.length || '-',
    Status: ready.ok ? (vendor.enabled ? 'would send' : 'paused') : ready.problems[0],
  });

  if (write) {
    const safe = vendor.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    writeFileSync(new URL(`${safe}.html`, OUT), renderEmail(report, { officePhone: config.officePhone }));
  }
}

rows.sort((a, b) => b.Homes - a.Homes);
console.table(rows);

const r = accountReadiness(data);
console.log('\nBefore this can go live:');
if (r.missingColumns.length) console.log(`  - Vendors board is missing columns: ${r.missingColumns.join(', ')}`);
if (r.jobsMissingVendor) console.log(`  - ${r.jobsMissingVendor} of ${r.totalJobs} jobs have no "Bill to" vendor (they appear in NO report)`);
const noEmail = r.vendorsMissingEmail.filter((v) => v.jobs > 0);
if (noEmail.length) {
  console.log(`  - ${noEmail.length} vendors with jobs have no report recipients:`);
  for (const v of noEmail.slice(0, 10)) console.log(`      ${v.name} (${v.jobs} jobs)`);
}
if (write) console.log(`\nWrote ${rows.length} report previews to out/ — open any .html in your browser.`);
console.log('');
