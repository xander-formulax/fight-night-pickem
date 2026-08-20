// monday API layer. Reads columns only — never Updates, never notes.
//
// Column ids below were verified against the live Dragon Transport account.
// Crew, Subcontractor and Driver columns are deliberately not requested: a
// vendor never sees who did the work.

import { PHASES, BOARDS, TASK_COLUMNS } from './phases.js';

const API = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';

export const JOB_COLUMNS = {
  address: 'text_mm4bqpy1',
  vendor: 'deal_contact',   // "Bill to" -> Vendors
  finishDate: 'date_mm45gy0s',
};

export const JOB_GROUPS = {
  active: 'topics',     // "Active Jobs"
  completed: 'closed',  // "Completed"
  bids: 'group_mm31702c',
};

// Config columns on Vendors. These do not exist yet — create them, then set
// the ids here (or via env). Readiness reports any that are still missing.
export const VENDOR_COLUMNS = {
  recipients: process.env.VENDOR_RECIPIENTS_COLUMN || '',
  enabled: process.env.VENDOR_ENABLED_COLUMN || '',
  lastSent: process.env.VENDOR_LAST_SENT_COLUMN || '',
  billingEmail: 'contact_email',
};

export async function mondayFetch(query, variables, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`monday API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`monday API: ${body.errors.map((e) => e.message).join('; ')}`);
  return body.data;
}

const COLUMN_FRAGMENT = `
  id
  text
  ... on BoardRelationValue { linked_item_ids }
  ... on TimelineValue { from to }
  ... on DateValue { date }
  ... on StatusValue { label }`;

/** Page through a board, returning items with the requested columns. */
export async function fetchItems({ boardId, columnIds, groupIds, token, limit = 200 }) {
  const query = `
    query ($boardId: [ID!], $columnIds: [String!], $limit: Int!, $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            group { id }
            column_values(ids: $columnIds) { ${COLUMN_FRAGMENT} }
          }
        }
      }
    }`;

  const out = [];
  let cursor = null;
  do {
    const data = await mondayFetch(query, { boardId: [String(boardId)], columnIds, limit, cursor }, token);
    const page = data.boards?.[0]?.items_page;
    if (!page) break;
    for (const item of page.items) {
      if (groupIds && !groupIds.includes(item.group?.id)) continue;
      out.push(item);
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

/** Fetch specific items by id, in chunks. */
export async function fetchItemsByIds({ ids, columnIds, token, chunk = 100 }) {
  const query = `
    query ($ids: [ID!]!, $columnIds: [String!]) {
      items(ids: $ids) {
        id
        name
        column_values(ids: $columnIds) { ${COLUMN_FRAGMENT} }
      }
    }`;
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const data = await mondayFetch(query, { ids: ids.slice(i, i + chunk), columnIds }, token);
    out.push(...(data.items || []));
  }
  return out;
}

const byId = (item) => Object.fromEntries((item.column_values || []).map((c) => [c.id, c]));

/**
 * Load everything one weekly run needs, shaped for buildReport().
 * Jobs in Active Jobs, plus recently completed ones so a finished home
 * visibly lands rather than silently disappearing.
 */
export async function loadReportData({ token, recentlyCompletedSince }) {
  const scopeCols = PHASES.map((p) => p.scope);
  const relCols = PHASES.map((p) => p.rel);

  const rawJobs = await fetchItems({
    boardId: BOARDS.jobs,
    columnIds: [JOB_COLUMNS.address, JOB_COLUMNS.vendor, JOB_COLUMNS.finishDate, ...scopeCols, ...relCols],
    groupIds: [JOB_GROUPS.active, JOB_GROUPS.completed],
    token,
  });

  const jobs = [];
  const taskIds = new Set();
  const vendorIds = new Set();

  for (const raw of rawJobs) {
    const cols = byId(raw);
    const finish = cols[JOB_COLUMNS.finishDate]?.date || null;

    // Completed homes drop off after the grace window.
    if (raw.group?.id === JOB_GROUPS.completed) {
      if (!finish || finish < recentlyCompletedSince) continue;
    }

    const vendorId = cols[JOB_COLUMNS.vendor]?.linked_item_ids?.[0] || null;
    if (vendorId) vendorIds.add(String(vendorId));

    const taskIdByPhase = {};
    for (const phase of PHASES) {
      const linked = cols[phase.rel]?.linked_item_ids?.[0];
      if (linked) {
        taskIdByPhase[phase.name] = String(linked);
        taskIds.add(String(linked));
      }
    }

    jobs.push({
      id: raw.id,
      name: raw.name,
      address: cols[JOB_COLUMNS.address]?.text || '',
      vendorId: vendorId ? String(vendorId) : null,
      finishDate: finish,
      group: raw.group?.id,
      scope: Object.fromEntries(PHASES.map((p) => [p.scope, cols[p.scope]?.label || cols[p.scope]?.text || null])),
      taskIdByPhase,
    });
  }

  const rawTasks = await fetchItemsByIds({
    ids: [...taskIds],
    columnIds: Object.values(TASK_COLUMNS),
    token,
  });

  const tasksById = new Map(rawTasks.map((raw) => {
    const cols = byId(raw);
    return [raw.id, {
      id: raw.id,
      name: raw.name,
      status: cols[TASK_COLUMNS.status]?.label || cols[TASK_COLUMNS.status]?.text || null,
      scheduleStart: cols[TASK_COLUMNS.schedule]?.from?.slice(0, 10) || null,
      finishedDate: cols[TASK_COLUMNS.finished]?.date || null,
    }];
  }));

  const vendorCols = [VENDOR_COLUMNS.billingEmail, VENDOR_COLUMNS.recipients,
    VENDOR_COLUMNS.enabled, VENDOR_COLUMNS.lastSent].filter(Boolean);

  const rawVendors = await fetchItemsByIds({ ids: [...vendorIds], columnIds: vendorCols, token });

  const vendorsById = new Map(rawVendors.map((raw) => {
    const cols = byId(raw);
    const recipientsRaw = VENDOR_COLUMNS.recipients ? cols[VENDOR_COLUMNS.recipients]?.text : '';
    return [raw.id, {
      id: raw.id,
      name: raw.name,
      recipients: splitRecipients(recipientsRaw),
      billingEmail: cols[VENDOR_COLUMNS.billingEmail]?.text || '',
      enabled: VENDOR_COLUMNS.enabled
        ? (cols[VENDOR_COLUMNS.enabled]?.label || cols[VENDOR_COLUMNS.enabled]?.text) === 'On'
        : false,
      lastSent: VENDOR_COLUMNS.lastSent ? cols[VENDOR_COLUMNS.lastSent]?.date || null : null,
    }];
  }));

  const jobsByVendorId = new Map();
  const orphanJobs = [];
  for (const job of jobs) {
    if (!job.vendorId) { orphanJobs.push(job); continue; }
    if (!jobsByVendorId.has(job.vendorId)) jobsByVendorId.set(job.vendorId, []);
    jobsByVendorId.get(job.vendorId).push(job);
  }

  return { vendorsById, jobsByVendorId, tasksById, orphanJobs, totalJobs: jobs.length };
}

export function splitRecipients(text) {
  return String(text || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

/** Write the send date back so the office sees it without opening the app. */
export async function markSent({ vendorId, date, token }) {
  if (!VENDOR_COLUMNS.lastSent) return;
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`;
  await mondayFetch(mutation, {
    boardId: String(BOARDS.vendors),
    itemId: String(vendorId),
    columnId: VENDOR_COLUMNS.lastSent,
    value: JSON.stringify({ date }),
  }, token);
}
