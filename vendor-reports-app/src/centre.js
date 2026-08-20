// Assembles everything the reporting centre needs, in one pass over the boards.
//
// The centre is read-only. Nothing is sent, nothing is scheduled, nothing is
// written back to monday. A person reviews every report before it goes out.

import { config } from './config.js';
import { loadReportData } from './monday.js';
import { buildReport } from './buildReport.js';
import { accountReadiness } from './readiness.js';
import { reportWeek, addDays, formatDay, formatWeekRange, todayInChicago } from './week.js';

/** The periods offered in the centre, relative to today. */
export function periodsFor(today) {
  const week = reportWeek(new Date(`${today}T12:00:00Z`));
  const lastWeek = { start: addDays(week.start, -7), end: addDays(week.start, -1) };
  const last30 = { start: addDays(today, -29), end: today };
  return [
    { key: 'this-week', label: 'This week', ...week },
    { key: 'last-week', label: 'Last week', ...lastWeek },
    { key: 'last-30', label: 'Last 30 days', ...last30 },
  ];
}

const label = (d) => (d ? formatDay(d) : null);

/**
 * One load, every vendor, every period. At ~140 jobs this is a handful of
 * GraphQL calls and well inside a single request, so there is no reason to
 * page it per vendor.
 */
export async function loadCentre({ now = new Date() } = {}) {
  const token = config.mondayToken;
  if (!token) throw new Error('MONDAY_API_TOKEN is not configured');

  const today = todayInChicago(now);
  const periods = periodsFor(today);
  const earliest = periods.reduce((a, p) => (p.start < a ? p.start : a), today);

  const data = await loadReportData({
    token,
    recentlyCompletedSince: addDays(earliest, -config.completedGraceDays),
  });

  const vendors = [];
  for (const [vendorId, jobs] of data.jobsByVendorId) {
    const vendor = data.vendorsById.get(vendorId);
    if (!vendor) continue;

    const reports = {};
    for (const p of periods) {
      const rep = buildReport({
        vendor, jobs, tasksById: data.tasksById,
        week: { start: p.start, end: p.end }, today,
      });
      for (const j of rep.jobs) {
        j.lastActivityLabel = label(j.lastActivity);
        j.nextScheduledLabel = label(j.nextScheduled);
      }
      reports[p.key] = rep;
    }

    const live = reports['this-week'];
    vendors.push({
      id: vendor.id,
      name: vendor.name,
      recipients: vendor.recipients || [],
      homes: live.activeHomes,
      counts: live.counts,
      lastActivity: live.lastActivity,
      lastActivityLabel: label(live.lastActivity),
      nextScheduled: live.nextScheduled,
      nextScheduledLabel: label(live.nextScheduled),
      reports,
    });
  }

  vendors.sort((a, b) => a.name.localeCompare(b.name));

  return {
    today,
    ranges: periods.map((p) => ({ key: p.key, label: p.label, range: formatWeekRange(p) })),
    vendors,
    readiness: accountReadiness(data),
  };
}
