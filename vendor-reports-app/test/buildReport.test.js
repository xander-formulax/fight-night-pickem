import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJob, buildReport } from '../src/buildReport.js';
import { PHASES } from '../src/phases.js';

const week = { start: '2026-08-17', end: '2026-08-23' };
const scopeOf = (...names) =>
  Object.fromEntries(PHASES.filter((p) => names.includes(p.name)).map((p) => [p.scope, 'Yes']));

const job = (name, phases, taskIdsByPhase = {}) => ({
  id: name, name, address: '1 Test Rd', scope: scopeOf(...phases), taskIdsByPhase,
});

const tasks = (entries) => new Map(entries.map((t) => [t.id, t]));

test('progress counts only in-scope phases', () => {
  const j = buildJob(
    job('A', ['Pad', 'Delivery', 'Set Up'], { Pad: ['t1'], Delivery: ['t2'] }),
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
    job('A', ['Pad'], { Pad: ['t1'] }),
    tasks([{ id: 't1', status: 'Invoiced', finishedDate: '2026-08-19' }]),
    week,
  );
  assert.equal(j.progress.done, 1);
  assert.equal(j.pending.length, 0);
  assert.deepEqual(j.completed.map((c) => c.name), ['Pad']);
});

test('completed section is scoped to the report week', () => {
  const j = buildJob(
    job('A', ['Pad', 'Delivery'], { Pad: ['t1'], Delivery: ['t2'] }),
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
      'Site Check': ['w'], Pad: ['h'], Delivery: ['s'],
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
        { Pad: ['a'], Delivery: ['b'], 'Set Up': ['c'], Steps: ['d'] }),
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
      job('Zeta', ['Pad'], { Pad: ['t1'] }),
      job('Alpha', ['Pad'], { Pad: ['t2'] }),
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
    jobs: [job('A', ['Pad', 'Set Up'], { Pad: ['t1'] })],
    tasksById: tasks([{ id: 't1', status: 'Done', finishedDate: '2026-08-18' }]),
    week,
  });
  assert.equal(JSON.stringify(buildReport(args())), JSON.stringify(buildReport(args())));
});


test('a phase linking several tasks completes only when all of them do', () => {
  const foundation = ['f1', 'f2', 'f3'];
  const partly = buildJob(
    job('Liliana', ['Foundation'], { Foundation: foundation }),
    tasks([
      { id: 'f1', name: 'Foundation Prep+Forms for Liliana', status: 'Done', finishedDate: '2026-08-18' },
      { id: 'f2', name: 'Pour concrete for Liliana', status: 'Done', finishedDate: '2026-08-19' },
      { id: 'f3', name: 'Remove Forms+Backfill for Liliana', status: 'Not done' },
    ]),
    week,
  );
  assert.equal(partly.progress.done, 0, 'one open sub-task keeps the phase open');
  assert.deepEqual(partly.pending.map((p) => p.name), ['Foundation']);

  const all = buildJob(
    job('Liliana', ['Foundation'], { Foundation: foundation }),
    tasks([
      { id: 'f1', name: 'Foundation Prep+Forms for Liliana', status: 'Done', finishedDate: '2026-08-18' },
      { id: 'f2', name: 'Pour concrete for Liliana', status: 'Done', finishedDate: '2026-08-19' },
      { id: 'f3', name: 'Remove Forms+Backfill for Liliana', status: 'Done', finishedDate: '2026-08-19' },
    ]),
    week,
  );
  assert.equal(all.progress.done, 1);
  // Multi-task phases list each real step, with the " for <home>" suffix dropped.
  assert.deepEqual(all.completed.map((c) => c.name),
    ['Foundation Prep+Forms', 'Pour concrete', 'Remove Forms+Backfill']);
});

test('a single-task phase is labelled with the phase name, not the task name', () => {
  const j = buildJob(
    job('William Pierce', ['Pad'], { Pad: ['t1'] }),
    tasks([{ id: 't1', name: 'Pad for William Pierce', status: 'Done', finishedDate: '2026-08-18' }]),
    week,
  );
  assert.deepEqual(j.completed.map((c) => c.name), ['Pad']);
});

test('a home with no phases marked Yes is unscoped, not 0%', () => {
  const j = buildJob(job('Michael Casares', []), tasks([]), week);
  assert.equal(j.state, 'unscoped');
  assert.equal(j.progress.total, 0);
});

test('stalled means nothing booked, nothing running, nothing finished lately', () => {
  const stalled = buildJob(
    job('A', ['Pad'], { Pad: ['t1'] }),
    tasks([{ id: 't1', status: 'Not done' }]),
    week, '2026-08-23',
  );
  assert.equal(stalled.state, 'stalled');

  const booked = buildJob(
    job('A', ['Pad'], { Pad: ['t1'] }),
    tasks([{ id: 't1', status: 'Not done', scheduleStart: '2026-09-01' }]),
    week, '2026-08-23',
  );
  assert.equal(booked.state, 'active', 'a booked date is not stalled');

  const recent = buildJob(
    job('A', ['Pad', 'Delivery'], { Pad: ['t1'], Delivery: ['t2'] }),
    tasks([
      { id: 't1', status: 'Done', finishedDate: '2026-08-18' },
      { id: 't2', status: 'Not done' },
    ]),
    week, '2026-08-23',
  );
  assert.equal(recent.state, 'active', 'recent activity is not stalled');
});

test('a finished home is complete, not stalled', () => {
  const j = buildJob(
    job('A', ['Pad'], { Pad: ['t1'] }),
    tasks([{ id: 't1', status: 'Invoiced', finishedDate: '2026-01-05' }]),
    week, '2026-08-23',
  );
  assert.equal(j.state, 'complete');
});


test('the vendor note passes through to the report untouched', () => {
  const j = buildJob(
    { ...job('A', ['Pad'], { Pad: ['t1'] }), note: 'Delivery moved to Friday.\nGate code is 4411.' },
    tasks([{ id: 't1', status: 'Done', finishedDate: '2026-08-18' }]),
    week,
  );
  assert.equal(j.note, 'Delivery moved to Friday.\nGate code is 4411.');
});
