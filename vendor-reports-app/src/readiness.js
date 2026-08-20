// What the centre can usefully tell the office about its own data.
//
// There is no send gate any more — a person reviews every report before it
// leaves — so nothing here blocks anything. It is a worklist, not a guard.

/** Account-level gaps worth surfacing in the centre. */
export function accountReadiness({ orphanJobs, totalJobs }) {
  return {
    totalJobs,
    jobsMissingVendor: orphanJobs.length,
    jobsMissingVendorSample: orphanJobs.slice(0, 25).map((j) => ({ id: j.id, name: j.name })),
  };
}
