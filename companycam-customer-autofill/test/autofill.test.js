import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { normalizePhone, last10, normalizeEmail, nameKey } from '../src/normalize.js';
import { processProject, sweep } from '../src/autofill.js';
import { createStore, memoryStorage } from '../src/store.js';
import { CompanyCamError } from '../src/companycam.js';
import { verifySignature, parseEvent } from '../src/server.js';

const CREATOR = '4362847';

test('phone normalization', () => {
  assert.equal(normalizePhone('(575) 390-7884'), '+15753907884');
  assert.equal(normalizePhone('1-575-390-7884'), '+15753907884');
  assert.equal(normalizePhone('+15753907884'), '+15753907884');
  assert.equal(normalizePhone('390-7884'), null);
  assert.equal(normalizePhone('25753907884'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(last10('+15755131711'), '5755131711');
  assert.equal(last10('5755131711'), '5755131711');
});

test('email and name normalization', () => {
  assert.equal(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(nameKey('  Anna   Torrez '), 'anna torrez');
  assert.notEqual(nameKey('Ana Torrez'), nameKey('Anna Torrez'));
});

test('signature verification', () => {
  const body = Buffer.from('{"event_type":"project.created"}');
  const sig = crypto.createHmac('sha1', 'tok').update(body).digest('base64');
  assert.equal(verifySignature(body, sig, 'tok'), true);
  assert.equal(verifySignature(body, sig, 'other'), false);
  assert.equal(verifySignature(body, undefined, 'tok'), false);
  assert.equal(verifySignature(body, sig, undefined), false);
});

test('parseEvent', () => {
  assert.deepEqual(
    parseEvent({ event_type: 'project.created', payload: { project: { id: '117093871' } } }),
    { type: 'project.created', projectId: '117093871', project: { id: '117093871' } },
  );
});

function fakes({ project, customer = null, items = [], customers = [] }) {
  const calls = [];
  let linked = customer;
  const cc = {
    getProject: async (id) => { calls.push(['getProject', id]); return project; },
    getProjectCustomer: async (id) => { calls.push(['getProjectCustomer', id]); return linked; },
    setProjectCustomer: async (pid, cid) => { calls.push(['setProjectCustomer', pid, cid]); linked = { id: cid }; },
    searchCustomers: async (q) => {
      calls.push(['searchCustomers', q]);
      return customers.filter((c) => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));
    },
    createCustomer: async (c) => { calls.push(['createCustomer', c]); return { id: 'new1', ...c }; },
    listProjects: async () => ({ items: [project], next: null }),
  };
  const monday = { findItemsByName: async () => items };
  const store = createStore(memoryStorage(), { minGapMs: 0, flushDelayMs: 0 });
  return { calls, deps: (cfg = {}) => ({ cc, monday, store, cfg: { dryRun: false, creatorId: CREATOR, boardId: 'b', ...cfg } }) };
}

const proj = { id: '1', name: 'Jane  Doe', creator_id: CREATOR, archived: false, created_at: new Date().toISOString() };
const item = { id: 'm1', name: 'Jane Doe', phone: '(575) 390-7884', email: 'Jane@x.com' };

test('creates and links when no customer matches', async () => {
  const f = fakes({ project: proj, items: [item] });
  const r = await processProject('1', { source: 'test' }, f.deps());
  assert.equal(r.outcome, 'created-and-linked');
  const create = f.calls.find((c) => c[0] === 'createCustomer')[1];
  assert.deepEqual(create, {
    name: 'Jane Doe', phone_number: '+15753907884', email: 'jane@x.com',
    contacts: [{ name: 'Jane Doe', phone_number: '+15753907884', email: 'jane@x.com' }],
  });
  assert.deepEqual(f.calls.at(-1), ['setProjectCustomer', '1', 'new1']);
});

test('dry run writes nothing', async () => {
  const f = fakes({ project: proj, items: [item] });
  const r = await processProject('1', { source: 'test' }, f.deps({ dryRun: true }));
  assert.equal(r.outcome, 'would-create-and-link');
  assert.ok(!f.calls.some((c) => c[0] === 'createCustomer' || c[0] === 'setProjectCustomer'));
});

test('links existing customer by legacy 10-digit phone', async () => {
  const f = fakes({ project: proj, items: [item], customers: [{ id: 'c9', name: 'Jane', phone_number: '5753907884' }] });
  const r = await processProject('1', { source: 'test' }, f.deps());
  assert.equal(r.outcome, 'linked-existing');
  assert.equal(r.customerId, 'c9');
  assert.ok(!f.calls.some((c) => c[0] === 'createCustomer'));
});

test('falls back to email, exact match only', async () => {
  const f = fakes({ project: proj, items: [{ ...item, phone: '' }], customers: [
    { id: 'c1', name: 'A', email: 'xjane@x.com', phone_number: '' },
    { id: 'c2', name: 'B', email: 'JANE@x.com', phone_number: '' },
  ] });
  const r = await processProject('1', { source: 'test' }, f.deps());
  assert.equal(r.customerId, 'c2');
});

test('multiple phone matches -> skip, no writes', async () => {
  const f = fakes({ project: proj, items: [item], customers: [
    { id: 'c1', name: 'A', phone_number: '+15753907884' },
    { id: 'c2', name: 'B', phone_number: '5753907884' },
  ] });
  const r = await processProject('1', { source: 'test' }, f.deps());
  assert.equal(r.outcome, 'skipped');
  assert.match(r.reason, /multiple customers/);
  assert.ok(!f.calls.some((c) => c[0] === 'setProjectCustomer'));
});

test('skips: wrong creator, customer set, 0 or 2 monday items, no contact info', async () => {
  let f = fakes({ project: { ...proj, creator_id: '999' }, items: [item] });
  assert.match((await processProject('1', { source: 't' }, f.deps())).reason, /creator/);

  f = fakes({ project: proj, items: [item], customer: { id: 'x' } });
  assert.equal((await processProject('1', { source: 't' }, f.deps())).reason, 'customer already set');

  f = fakes({ project: proj, items: [] });
  assert.match((await processProject('1', { source: 't' }, f.deps())).reason, /no monday item/);

  f = fakes({ project: proj, items: [item, { ...item, id: 'm2' }] });
  assert.match((await processProject('1', { source: 't' }, f.deps())).reason, /2 monday items/);

  f = fakes({ project: proj, items: [{ ...item, phone: '123', email: '' }] });
  const r = await processProject('1', { source: 't' }, f.deps());
  assert.match(r.reason, /no valid phone or email/);
  assert.ok(!f.calls.some((c) => c[0] === 'createCustomer'));
});

test('TEST_NAME_FILTER gates projects', async () => {
  const f = fakes({ project: proj, items: [item] });
  const r = await processProject('1', { source: 't' }, f.deps({ testNameFilter: 'xander test' }));
  assert.match(r.reason, /TEST_NAME_FILTER/);
});

test('second run is deduped after a successful link', async () => {
  const f = fakes({ project: proj, items: [item] });
  const d = f.deps();
  await processProject('1', { source: 't' }, d);
  const r = await processProject('1', { source: 't' }, d);
  assert.equal(r.reason, 'already-processed');
});

test('sweep processes recent integration projects only', async () => {
  const f = fakes({ project: proj, items: [item] });
  const s = await sweep(f.deps({ dryRun: true }), { days: 14 });
  assert.equal(s.candidates, 1);
  assert.equal(s.outcomes['would-create-and-link'], 1);
});

test('log entries are batched and noise skips stay out of storage', async () => {
  const mem = memoryStorage();
  let sets = 0;
  const counting = { ...mem, set: async (k, v) => { sets++; return mem.set(k, v); } };
  const store = createStore(counting, { minGapMs: 0, flushDelayMs: 50 });
  for (let i = 0; i < 5; i++) store.append({ projectId: String(i), outcome: 'skipped' });
  store.append({ projectId: 'x', outcome: 'skipped' }, { persist: false });
  const log = await store.readLog();
  assert.equal(log.length, 5);
  assert.equal(log[0].projectId, '4'); // newest first
  assert.equal(sets, 1);
});

test('email rejected by CompanyCam -> create with phone only', async () => {
  const f = fakes({ project: proj, items: [{ ...item, email: 'test@test.com' }] });
  const d = f.deps();
  const orig = d.cc.createCustomer;
  d.cc.createCustomer = async (c) => {
    if (c.email || c.contacts.some((k) => k.email)) {
      throw new CompanyCamError(422, { errors: [{ code: 'validation_failed', message: 'Email address is invalid', field: 'email_address' }] }, 'POST /customers');
    }
    return orig(c);
  };
  const r = await processProject('1', { source: 't' }, d);
  assert.equal(r.outcome, 'created-and-linked');
  assert.match(r.note, /rejected email/);
  const created = f.calls.find((c) => c[0] === 'createCustomer')[1];
  assert.deepEqual(created, { name: 'Jane Doe', phone_number: '+15753907884', contacts: [{ name: 'Jane Doe', phone_number: '+15753907884' }] });
});

test('email rejected and no phone -> error, nothing linked', async () => {
  const f = fakes({ project: proj, items: [{ ...item, phone: '', email: 'test@test.com' }] });
  const d = f.deps();
  d.cc.createCustomer = async () => { throw new CompanyCamError(422, { errors: [{ message: 'Email address is invalid' }] }, 'POST /customers'); };
  const r = await processProject('1', { source: 't' }, d);
  assert.equal(r.outcome, 'error');
  assert.ok(!f.calls.some((c) => c[0] === 'setProjectCustomer'));
});

test('deleted monday code env var does not fall back to stale process.env', async () => {
  const { readFrom } = await import('../src/config.js');
  const mgr = { getKeys: () => ['DRY_RUN'], get: (k) => (k === 'DRY_RUN' ? 'false' : undefined) };
  assert.equal(readFrom(mgr, 'TEST_NAME_FILTER', { TEST_NAME_FILTER: 'XANDER TEST' }), undefined);
  assert.equal(readFrom(mgr, 'DRY_RUN', {}), 'false');
  // Off monday code (no keys) process.env still works for local dev/tests.
  const empty = { getKeys: () => [], get: () => undefined };
  assert.equal(readFrom(empty, 'TEST_NAME_FILTER', { TEST_NAME_FILTER: 'x' }), 'x');
});
