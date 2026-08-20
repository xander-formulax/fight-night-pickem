// The report builder.
//
// This is a pure function: board state in, report object out. No network, no
// clock, no randomness, no model. The same input always produces the same
// output, which is what makes the golden-file test in test/ meaningful.
//
// Nothing here reads Updates or notes. Those are internal.

import { PHASES, COMPLETE_STATUSES } from './phases.js';
import { formatDay, inWeek } from './week.js';

// Resolved in order — first match wins.
function pendingSuffix(task) {
  if (task?.status === 'Working on it') return { label: 'In progress', tone: 'active' };
  if (task?.status === 'Waiting') return { label: 'On hold', tone: 'hold' };
  if (task?.scheduleStart) {
    return { label: `Scheduled ${formatDay(task.scheduleStart)}`, tone: 'scheduled', date: task.scheduleStart };
  }
  return { label: 'Not yet scheduled', tone: 'unscheduled' };
}

// Ordered by how immediate the work is: happening now, then booked (soonest
// first), then blocked, then not yet booked. Build order breaks ties.
const URGENCY = { active: 0, scheduled: 1, hold: 2, unscheduled: 3 };

function byUrgency(a, b) {
  if (URGENCY[a.tone] !== URGENCY[b.tone]) return URGENCY[a.tone] - URGENCY[b.tone];
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.order - b.order;
}

/**
 * Build one job's section.
 *
 * The phase name — not the task name — is the customer-facing label. It is
 * always present (even when no task exists yet) and avoids leaking whatever
 * internal naming convention the office uses on the Tasks board.
 */
export function buildJob(job, tasksById, week) {
  const inScope = PHASES
    .map((phase, order) => ({ phase, order, task: tasksById.get(job.taskIdByPhase?.[phase.name]) }))
    .filter(({ phase }) => job.scope?.[phase.scope] === 'Yes');

  const done = inScope.filter(({ task }) => COMPLETE_STATUSES.has(task?.status));

  const completed = done
    .filter(({ task }) => inWeek(task.finishedDate, week))
    .map(({ phase, task }) => ({ name: phase.name, date: task.finishedDate, dateLabel: formatDay(task.finishedDate) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const pending = inScope
    .filter(({ task }) => !COMPLETE_STATUSES.has(task?.status))
    .map(({ phase, order, task }) => {
      const suffix = pendingSuffix(task);
      return { name: phase.name, order, date: suffix.date, status: suffix.label, tone: suffix.tone };
    })
    .sort(byUrgency);

  const total = inScope.length;
  return {
    id: job.id,
    name: job.name,
    address: job.address || '',
    progress: { done: done.length, total, pct: total ? Math.round((done.length / total) * 100) : 0 },
    completed,
    pending,
  };
}

/**
 * Build a vendor's whole weekly report.
 * `jobs` should already be filtered to this vendor.
 */
export function buildReport({ vendor, jobs, tasksById, week }) {
  const sections = jobs
    .map((job) => buildJob(job, tasksById, week))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    vendor: { id: vendor.id, name: vendor.name },
    week,
    activeHomes: sections.length,
    completedCount: sections.reduce((n, j) => n + j.completed.length, 0),
    jobs: sections,
  };
}
