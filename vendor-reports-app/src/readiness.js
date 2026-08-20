// A vendor missing half their homes gets a report that reads as "you lost my
// house" — worse than no report. So a vendor that fails any check is skipped
// and reported, never sent a partial.

import { VENDOR_COLUMNS } from './monday.js';

export function checkVendor(vendor, jobs) {
  const problems = [];
  if (!vendor) problems.push('vendor record not found');
  if (!vendor?.recipients?.length) problems.push('no report recipients set');
  if (!jobs?.length) problems.push('no active jobs');
  return { ok: problems.length === 0, problems };
}

/** Account-level issues worth surfacing in the app's Readiness tab. */
export function accountReadiness({ vendorsById, jobsByVendorId, orphanJobs, totalJobs }) {
  const missingColumns = Object.entries({
    'Report Recipients': VENDOR_COLUMNS.recipients,
    'Weekly Report': VENDOR_COLUMNS.enabled,
    'Last Report Sent': VENDOR_COLUMNS.lastSent,
  }).filter(([, id]) => !id).map(([title]) => title);

  const vendorsMissingEmail = [...vendorsById.values()]
    .filter((v) => !v.recipients.length)
    .map((v) => ({ id: v.id, name: v.name, jobs: jobsByVendorId.get(v.id)?.length || 0 }))
    .sort((a, b) => b.jobs - a.jobs);

  return {
    totalJobs,
    jobsMissingVendor: orphanJobs.length,
    jobsMissingVendorSample: orphanJobs.slice(0, 25).map((j) => ({ id: j.id, name: j.name })),
    vendorsMissingEmail,
    missingColumns,
  };
}
