import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJob, buildReport } from '../src/buildReport.js';
import { PHASES } from '../src/phases.js';

const week = { start: '2026-08-17', end: '2026-08-23' };
const scopeOf = (...names) =>
  Object.fromEntries(PHASES.filter((p) => names.includes(p.name)).map((p) => [p.scope, 'Yes']));

const job = (name, phases, taskIdByPhase = {}) => ({
  id: name, name, address: '1 Test Rd', scope: scopeOf(...phases), taskIdByPhase,
});

const tasks = (entries) => new Map(entries.map((t) => [t.id, t]));

test('progress counts only in-scope phases', () => {
  const j = buildJob(
    job('A', ['Pad', 'Delivery', 'Set Up'], { Pad: 't1', Delivery: 't2' }),
    tasks([
      { id: 't1', status: 'Done', finishedDate: '2026-08-18' },
      { id: 't2', status: 'Not done' },
    ]),
    week,
  );
  // 3 in scope, 1 done — a home needing no septic is not penalised for it.
  assert.equal(j.progress.total, 3);
  assert.equal(j.progress.done, 1);
});

test('Invoiced counts as complete', () => {
  const j = buildJob(
    job('A', ['Pad'], { Pad: 't1' }),
    tasks([{ id: 't1', status: 'Invoiced', finishedDate: '2026-08-19' }]),
    week,
  );
  assert.equal(j.progress.done, 1);
  assert.equal(j.pending.length, 0);
  assert.deepEqual(j.completed.map((c) => c.name), ['Pad']);
});

test('completed section is scoped to the report week', () => {
  const j = buildJob(
    job('A', ['Pad', 'Delivery'], { Pad: 't1', Delivery: 't2' }),
    tasks([
      { id: 't1', status: 'Done', finishedDate: '2026-08-18' }, // in week
      { id: 't2', status: 'Done', finishedDate: '2026-08-03' }, // earlier
    ]),
    week,
  );
  assert.deepEqual(j.completed.map((c) => c.name), ['Pad']);
  assert.equal(j.progress.done, 2, 'both still count toward progress');
});

test('pending suffix resolves first-match-wins', () => {
  const j = buildJob(
    job('A', ['Site Check', 'Pad', 'Delivery', 'Set Up'], {
      'Site Check': 'w', Pad: 'h', Delivery: 's',
    }),
    tasks([
      { id: 'w', status: 'Working on it', scheduleStart: '2026-09-01' }, // status wins over date
      { id: 'h', status: 'Waiting', scheduleStart: '2026-09-02' },
      { id: 's', status: 'Not done', scheduleStart: '2026-08-25' },
    ]),
    week,
  );
  const got = Object.fromEntries(j.pending.map((p) => [p.name, p.status]));
  assert.deepEqual(got, {
    'Site Check': 'In progress',
    Pad: 'On hold',
    Delivery: 'Scheduled Tue, Aug 25',
    'Set Up': 'Not yet scheduled', // in scope, no task linked at all
  });
});

test('pending sorts by urgency: in progress, booked, blocked, unbooked', () => {
  const j = buildJob(
    job('A', ['Pad', 'Delivery', 'Set Up', 'Steps', 'Trim Out'],
        { Pad: 'a', Delivery: 'b', 'Set Up': 'c', Steps: 'd' }),
    tasks([
      { id: 'a', status: 'Not done', scheduleStart: '2026-08-28' },
      { id: 'b', status: 'Waiting' },
      { id: 'c', status: 'Not done', scheduleStart: '2026-08-25' },
      { id: 'd', status: 'Working on it' },
    ]),
    week,
  );
  assert.deepEqual(j.pending.map((p) => p.name), [
    'Steps',    // in progress
    'Set Up',   // booked Aug 25
    'Pad',      // booked Aug 28
    'Delivery', // on hold
    'Trim Out', // no task at all
  ]);
});

test('a phase with no linked task still appears as pending', () => {
  const j = buildJob(job('A', ['Pad']), tasks([]), week);
  assert.equal(j.progress.total, 1);
  assert.deepEqual(j.pending, [
    { name: 'Pad', order: 1, date: undefined, status: 'Not yet scheduled', tone: 'unscheduled' },
  ]);
});

test('report totals aggregate across homes', () => {
  const r = buildReport({
    vendor: { id: '1', name: 'Titan Midland' },
    jobs: [
      job('Zeta', ['Pad'], { Pad: 't1' }),
      job('Alpha', ['Pad'], { Pad: 't2' }),
    ],
    tasksById: tasks([
      { id: 't1', status: 'Done', finishedDate: '2026-08-18' },
      { id: 't2', status: 'Done', finishedDate: '2026-08-19' },
    ]),
    week,
  });
  assert.equal(r.activeHomes, 2);
  assert.equal(r.completedCount, 2);
  assert.deepEqual(r.jobs.map((j) => j.name), ['Alpha', 'Zeta'], 'sorted by name');
});

test('same input twice produces identical output', () => {
  const args = () => ({
    vendor: { id: '1', name: 'Titan Midland' },
    jobs: [job('A', ['Pad', 'Set Up'], { Pad: 't1' })],
    tasksById: tasks([{ id: 't1', status: 'Done', finishedDate: '2026-08-18' }]),
    week,
  });
  assert.equal(JSON.stringify(buildReport(args())), JSON.stringify(buildReport(args())));
});
