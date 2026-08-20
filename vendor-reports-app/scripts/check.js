// Verifies that MONDAY_API_TOKEN works and prints what the centre will show.
// Read-only. Useful before deploying, and for diagnosing an empty vendor list.
//
//   MONDAY_API_TOKEN=xxx npm run check

import { config } from '../src/config.js';
import { loadCentre } from '../src/centre.js';

if (!config.mondayToken) {
  console.error('\n  Missing MONDAY_API_TOKEN.\n');
  console.error('  Get one at: monday.com -> your avatar -> Developers -> My Access Tokens');
  console.error('  Then run:   MONDAY_API_TOKEN=your_token_here npm run check\n');
  process.exit(1);
}

console.log('\nReading monday...');
const centre = await loadCentre();

console.log(`Report periods: ${centre.ranges.map((r) => r.label).join(', ')}\n`);
console.table(centre.vendors.map((v) => ({
  Vendor: v.name.slice(0, 34),
  Homes: v.homes,
  'Done this week': v.reports['this-week'].completedCount,
  Stalled: v.counts.stalled || 0,
  'Not scoped': v.counts.unscoped || 0,
})));

const r = centre.readiness;
console.log('\nData quality:');
console.log(`  ${r.jobsMissingVendor} of ${r.totalJobs} jobs have no "Bill to" vendor — they appear under no vendor.`);
console.log('');
