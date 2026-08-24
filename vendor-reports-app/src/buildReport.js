// The report builder.
//
// This is a pure function: board state in, report object out. No network, no
// clock, no randomness, no model. The same input always produces the same
// output, which is what makes the tests in test/ meaningful.
//
// Nothing here reads Updates or notes. Those are internal.

import { PHASES, COMPLETE_STATUSES } from './phases.js';
import { formatDay, inWeek, addDays } from './week.js';

// A home with nothing finished and nothing booked for this long is the one a
// vendor phones about. Surfaced in the reporting centre, never in the report.
const STALE_AFTER_DAYS = 21;

const isComplete = (task) => COMPLETE_STATUSES.has(task?.status);
const min = (dates) => dates.filter(Boolean).sort()[0] || null;
const max = (dates) => dates.filter(Boolean).sort().at(-1) || null;

// Tasks are named "Pad for William Pierce" on the board. Inside that home's own
// section the suffix is noise, so drop it.
function taskLabel(task, jobName) {
  const name = String(task?.name || '').trim();
  const suffix = ` for ${jobName}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() || name : name;
}

// Resolved in order — first match wins — across every incomplete task in a phase.
function pendingSuffix(tasks) {
  const open = tasks.filter((t) => !isComplete(t));
  if (open.some((t) => t.status === 'Working on it')) return { label: 'In progress', tone: 'active' };
  if (open.some((t) => t.status === 'Waiting')) return { label: 'On hold', tone: 'hold' };
  const next = min(open.map((t) => t.scheduleStart));
  if (next) return { label: `Scheduled ${formatDay(next)}`, tone: 'scheduled', date: next };
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
 * Build one home's section.
 *
 * A phase normally maps to one task and is labelled with the phase name, which
 * is always present even where no task exists yet. Where a phase links several
 * tasks (Foundation = prep, pour, backfill) each task is listed under its own
 * name, since those are real steps the customer can follow.
 */
export function buildJob(job, tasksById, week, today = week.end) {
  const inScope = PHASES
    .map((phase, order) => ({
      phase,
      order,
      tasks: (job.taskIdsByPhase?.[phase.name] || []).map((id) => tasksById.get(id)).filter(Boolean),
    }))
    .filter(({ phase }) => job.scope?.[phase.scope] === 'Yes');

  const done = inScope.filter(({ tasks }) => tasks.length > 0 && tasks.every(isComplete));

  const completed = [];
  for (const { phase, tasks } of done) {
    const thisWeek = tasks.filter((t) => inWeek(t.finishedDate, week));
    for (const task of thisWeek) {
      completed.push({
        name: tasks.length > 1 ? taskLabel(task, job.name) : phase.name,
        date: task.finishedDate,
        dateLabel: formatDay(task.finishedDate),
      });
    }
  }
  completed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  const pending = inScope
    .filter(({ tasks }) => !(tasks.length > 0 && tasks.every(isComplete)))
    .map(({ phase, order, tasks }) => {
      const suffix = pendingSuffix(tasks);
      return { name: phase.name, order, date: suffix.date, status: suffix.label, tone: suffix.tone };
    })
    .sort(byUrgency);

  const total = inScope.length;
  const allTasks = inScope.flatMap(({ tasks }) => tasks);
  const lastActivity = max(allTasks.map((t) => t.finishedDate));
  const nextScheduled = min(pending.map((p) => p.date));

  // Three states the reporting centre needs to tell apart, in priority order.
  let state;
  if (total === 0) state = 'unscoped';
  else if (pending.length === 0) state = 'complete';
  else if (!nextScheduled && !pending.some((p) => p.tone === 'active')
           && (!lastActivity || lastActivity < addDays(today, -STALE_AFTER_DAYS))) state = 'stalled';
  else state = 'active';

  return {
    id: job.id,
    name: job.name,
    address: job.address || '',
    note: job.note || '',
    state,
    progress: { done: done.length, total, pct: total ? Math.round((done.length / total) * 100) : 0 },
    completed,
    pending,
    lastActivity,
    nextScheduled,
  };
}

/**
 * Build a vendor's whole report.
 * `jobs` should already be filtered to this vendor.
 */
export function buildReport({ vendor, jobs, tasksById, week, today = week.end }) {
  const sections = jobs
    .map((job) => buildJob(job, tasksById, week, today))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = sections.reduce((acc, j) => ({ ...acc, [j.state]: (acc[j.state] || 0) + 1 }), {});

  return {
    vendor: { id: vendor.id, name: vendor.name },
    week,
    activeHomes: sections.length,
    completedCount: sections.reduce((n, j) => n + j.completed.length, 0),
    counts,
    nextScheduled: min(sections.map((j) => j.nextScheduled)),
    lastActivity: max(sections.map((j) => j.lastActivity)),
    jobs: sections,
  };
}
