import { collapseWhitespace, last10, normalizeEmail, normalizePhone } from './normalize.js';

const inFlight = new Set();

/**
 * Steps 2–9 of the spec for one CompanyCam project.
 * deps: { cc, monday, store, cfg } where cfg = { dryRun, creatorId, boardId, phoneColumn, emailColumn, testNameFilter }
 * Returns the logged outcome entry.
 */
export async function processProject(projectId, { source, project: prefetched }, deps) {
  const { store } = deps;
  const id = String(projectId);
  if (inFlight.has(id)) return { outcome: 'skipped', reason: 'already-in-progress' };
  inFlight.add(id);
  const base = { source, projectId: id, dryRun: deps.cfg.dryRun };
  try {
    const result = await run(id, prefetched, deps);
    const entry = { ...base, ...result };
    await store.append(entry);
    if (!deps.cfg.dryRun && (entry.outcome === 'linked-existing' || entry.outcome === 'created-and-linked')) {
      await store.markDone(id, entry.outcome);
    }
    return entry;
  } catch (e) {
    const entry = { ...base, outcome: 'error', reason: e.message };
    await store.append(entry);
    return entry;
  } finally {
    inFlight.delete(id);
  }
}

async function run(id, prefetched, { cc, monday, store, cfg }) {
  if (await store.isDone(id)) return { outcome: 'skipped', reason: 'already-processed' };

  // 2. Project + creator check
  const project = prefetched?.creator_id ? prefetched : await cc.getProject(id);
  const projectName = collapseWhitespace(project?.name);
  const ctx = { projectName };
  if (String(project?.creator_id) !== String(cfg.creatorId)) {
    return { ...ctx, outcome: 'skipped', reason: `creator ${project?.creator_id} is not the integration user` };
  }
  if (project.archived) return { ...ctx, outcome: 'skipped', reason: 'project archived' };
  if (cfg.testNameFilter && !projectName.toLowerCase().includes(cfg.testNameFilter.toLowerCase())) {
    return { ...ctx, outcome: 'skipped', reason: `TEST_NAME_FILTER "${cfg.testNameFilter}" not in name` };
  }

  // 3. Customer already set?
  const existing = await cc.getProjectCustomer(id);
  if (existing) return { ...ctx, outcome: 'skipped', reason: 'customer already set', customerId: existing.id };

  // 4. Matching monday item (exactly one)
  const items = await monday.findItemsByName(cfg.boardId, projectName, {
    phoneColumn: cfg.phoneColumn, emailColumn: cfg.emailColumn,
  });
  if (items.length !== 1) {
    return {
      ...ctx, outcome: 'skipped',
      reason: items.length ? `${items.length} monday items match the name` : 'no monday item matches the name',
      mondayItemIds: items.map((i) => i.id),
    };
  }
  const item = items[0];
  ctx.mondayItemId = item.id;

  // 5. Normalize contact info
  const phone = normalizePhone(item.phone);
  const email = normalizeEmail(item.email);
  ctx.phone = phone;
  ctx.email = email;
  if (!phone && !email) {
    return { ...ctx, outcome: 'skipped', reason: `no valid phone or email on monday item (raw phone "${item.phone ?? ''}")` };
  }

  // 6. Find an existing customer: phone, then email. Multiple = stop.
  let match = null;
  if (phone) {
    const p10 = last10(phone);
    const found = dedupe((await cc.searchCustomers(p10)).filter((c) =>
      last10(c.phone_number) === p10 || (c.contacts || []).some((k) => last10(k.phone_number) === p10)));
    if (found.length > 1) {
      return { ...ctx, outcome: 'skipped', reason: 'multiple customers match phone — needs a human', customerIds: found.map((c) => c.id) };
    }
    match = found[0] || null;
  }
  if (!match && email) {
    const found = dedupe((await cc.searchCustomers(email)).filter((c) =>
      normalizeEmail(c.email) === email || (c.contacts || []).some((k) => normalizeEmail(k.email) === email)));
    if (found.length > 1) {
      return { ...ctx, outcome: 'skipped', reason: 'multiple customers match email — needs a human', customerIds: found.map((c) => c.id) };
    }
    match = found[0] || null;
  }

  // 7. Build the create payload if no match
  const name = item.name;
  const newCustomer = match ? null : {
    name,
    ...(phone ? { phone_number: phone } : {}),
    ...(email ? { email } : {}),
    contacts: [{ name, ...(phone ? { phone_number: phone } : {}), ...(email ? { email } : {}) }],
  };

  if (cfg.dryRun) {
    return match
      ? { ...ctx, outcome: 'would-link-existing', customerId: match.id, customerName: match.name }
      : { ...ctx, outcome: 'would-create-and-link', newCustomer };
  }

  // 8. Re-check right before writing
  const again = await cc.getProjectCustomer(id);
  if (again) return { ...ctx, outcome: 'skipped', reason: 'customer set meanwhile', customerId: again.id };

  let customer = match;
  if (!customer) customer = await cc.createCustomer(newCustomer);
  await cc.setProjectCustomer(id, customer.id);
  return {
    ...ctx,
    outcome: match ? 'linked-existing' : 'created-and-linked',
    customerId: customer.id,
    customerName: customer.name,
  };
}

function dedupe(customers) {
  const seen = new Map();
  for (const c of customers) if (c?.id && !seen.has(String(c.id))) seen.set(String(c.id), c);
  return [...seen.values()];
}

/** Nightly sweep: projects created in the last N days by the integration user. Sequential (rate limits). */
export async function sweep(deps, { days }) {
  const cutoff = Date.now() - days * 86400_000;
  const summary = { scanned: 0, candidates: 0, outcomes: {} };
  let after;
  for (let page = 0; page < 50; page++) {
    const { items, next } = await deps.cc.listProjects({ after });
    let reachedCutoff = false;
    for (const p of items) {
      summary.scanned++;
      if (toMs(p.created_at) < cutoff) { reachedCutoff = true; continue; }
      if (p.creator_id && String(p.creator_id) !== String(deps.cfg.creatorId)) continue;
      summary.candidates++;
      const r = await processProject(p.id, { source: 'sweep', project: p }, deps);
      summary.outcomes[r.outcome] = (summary.outcomes[r.outcome] || 0) + 1;
    }
    if (reachedCutoff || !next) break;
    after = next;
  }
  return summary;
}

function toMs(t) {
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  const n = Number(t);
  if (Number.isFinite(n) && String(t).trim() !== '') return n < 1e12 ? n * 1000 : n;
  return Date.parse(t);
}
