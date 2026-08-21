import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, renderSubject } from '../src/renderEmail.js';

const report = {
  vendor: { id: '1', name: 'Titan <Midland>' },
  jobs: [
    { name: 'A & B', address: '1 "Main" St', state: 'active',
      progress: { done: 1, total: 3, pct: 33 },
      completed: [{ name: 'Pad', dateLabel: 'Mon, Aug 17' }],
      pending: [{ name: 'Set Up', status: 'In progress', tone: 'active' }] },
    { name: 'Hidden Home', address: '', state: 'unscoped',
      progress: { done: 0, total: 0, pct: 0 }, completed: [], pending: [] },
  ],
};

test('unscoped homes are excluded from the email', () => {
  const html = renderEmail(report, 'August 17-23, 2026');
  assert.ok(!html.includes('Hidden Home'));
  assert.ok(html.includes('1 home'));
});

test('names are escaped', () => {
  const html = renderEmail(report, 'August 17-23, 2026');
  assert.ok(html.includes('Titan &lt;Midland&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(!html.includes('Titan <Midland>'));
});

test('subject matches the email header', () => {
  assert.equal(renderSubject(report, 'August 17-23, 2026'),
    'Progress Report from Dragon Transports!');
});

test('internal triage labels never reach the email', () => {
  const html = renderEmail(report, 'August 17-23, 2026');
  assert.ok(!/stalled|on track|not scoped/i.test(html));
});
