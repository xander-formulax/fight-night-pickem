// monday API layer. Reads columns only — never Updates, never notes.
//
// Column ids below were verified against the live Dragon Transport account.
// Crew, Subcontractor and Driver columns are deliberately not requested: a
// vendor never sees who did the work.

import { PHASES, BOARDS, TASK_COLUMNS } from './phases.js';

const API = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';

export const VENDOR_COLUMNS = {
  statusUpdateEmail: 'email_mm6dv20g', // "Status Update Email" on Vendors
};

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
  ... on StatusValue { label }
  ... on EmailValue { email }`;

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
  // NOTE: items(ids:) defaults to returning only 25 items. Without an explicit
  // limit the rest come back silently missing — which reads downstream as "task
  // not found" and renders finished work as "Not yet scheduled".
  const query = `
    query ($ids: [ID!]!, $columnIds: [String!], $limit: Int!) {
      items(ids: $ids, limit: $limit) {
        id
        name
        column_values(ids: $columnIds) { ${COLUMN_FRAGMENT} }
      }
    }`;
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const data = await mondayFetch(query, { ids: slice, columnIds, limit: chunk }, token);
    const got = data.items?.length ?? 0;
    if (got < slice.length) {
      throw new Error(`monday returned ${got} of ${slice.length} requested items — refusing to build a report from partial data`);
    }
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

    const taskIdsByPhase = {};
    for (const phase of PHASES) {
      const linked = (cols[phase.rel]?.linked_item_ids || []).map(String);
      if (linked.length) {
        taskIdsByPhase[phase.name] = linked;
        for (const id of linked) taskIds.add(id);
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
      taskIdsByPhase,
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

  const rawVendors = await fetchItemsByIds({
    ids: [...vendorIds],
    columnIds: [VENDOR_COLUMNS.statusUpdateEmail],
    token,
  });

  const vendorsById = new Map(rawVendors.map((raw) => {
    const cols = byId(raw);
    const emailCol = cols[VENDOR_COLUMNS.statusUpdateEmail];
    return [raw.id, {
      id: raw.id,
      name: raw.name,
      recipients: splitRecipients(emailCol?.email || emailCol?.text || ''),
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
  return [...new Set(String(text || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@')))];
}
