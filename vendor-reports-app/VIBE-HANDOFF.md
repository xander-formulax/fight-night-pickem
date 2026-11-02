# Vendor Reports — Vibe rebuild handoff

This file is a complete, self-contained handoff for rebuilding the **Dragon
Transport Vendor Reports app** as a **monday Vibe app**. It contains the full
spec, every business rule, every verified monday board and column id, and the
entire source of the working monday-code version that this rebuild replaces.

Account: `dragontransportss-team.monday.com`

---

## 1. What the app is for

Dragon Transports sets up manufactured homes. Their customers are dealerships
— internally called **vendors** (Titan, Palm Harbor, Solitaire, …). Those
vendors keep phoning for status updates. The app replaces those calls with a
progress report that Dragon Transports emails them.

The app is a **reporting centre**, not an automation. A human opens it, looks
at what's happening with a vendor, and sends a report. There is a batch "send
all reports" flow for doing every active vendor in a few clicks.

## 2. Hard rules — do not change these in the rebuild

These were decided deliberately with the client. A rebuild that quietly drops
one of them is a regression.

1. **No AI-generated content anywhere in a report.** Every word a vendor reads
   is either a fixed template string or a value read straight out of a monday
   column. No summarising, no rephrasing, no "contextualising". The report is a
   template, filled in.
2. **Never read monday Updates or notes.** Those are internal. Columns only.
3. **Never show who did the work.** The Crew, Subcontractor and Driver columns
   are deliberately never requested. A vendor sees *what* happened, not *who*.
4. **Internal triage labels never reach the vendor.** The UI buckets homes as
   `active` / `scheduled` / `hold` / `unscoped` / `stalled` / `complete` to help
   the staff member scan. None of those words appear in the email.
5. **Homes with nothing scoped are excluded from the email.** They'd read as an
   empty report to the vendor. They still show in the internal UI so staff can
   see the data needs filling in.
6. **`Invoiced` counts as complete.** It's a billing state, but to a vendor it
   reads as finished work, so it counts alongside `Done`.
7. **The browser says *who* to send to, never *where*.** The frontend posts
   vendor ids; the server resolves the recipient address from the board itself.
   This is what stops a tampered client mailing a report to an arbitrary
   address.

## 3. The three boards

| Board   | id           | What it holds |
|---------|--------------|---------------|
| Vendors | `18409503080` | The dealerships. One item per vendor. |
| Jobs    | `18409503078` | One item per **home** being set up. |
| Tasks   | `18409523534` | One item per unit of work on a home. |

### Vendors board columns the app uses
| Purpose | Column id | Notes |
|---|---|---|
| Status Update Email | `email_mm6dv20g` | Where that vendor's report goes. |
| Last Report Sent | `date_mm6e3f1a` | **Written by the app** after a successful send. |

### Jobs board columns the app uses
| Purpose | Column id | Notes |
|---|---|---|
| Address | `text_mm4bqpy1` | |
| Bill to → Vendors | `deal_contact` | The vendor link. Note: `deal_contact`, not `contact_deal`. |
| Finish date | `date_mm45gy0s` | |
| Notes for the Vendor | *resolved by title* | A long-text column. Resolved by matching the column **title** `notes for the vendor` (case-insensitive), not a hardcoded id, so the client can recreate it without a code change. Shown in the email under the heading "A note from Dragon Transports". |

### Jobs board groups
| Group | id |
|---|---|
| Active Jobs | `topics` |
| Completed | `closed` |
| Bids | `group_mm31702c` |

### Tasks board columns the app uses
| Purpose | Column id |
|---|---|
| Status | `color_mm2v7xnr` |
| Schedule (timeline) | `timerange_mm2wxekj` |
| Finished (date) | `date_mm35m8t7` |

### The 16 build phases
Each home has, for each phase, a Yes/No **scope** column saying whether that
phase applies, and a **board-relation** column linking to the Task(s) that do
it. Order below is natural build order and is the tie-breaker when sorting
pending work with no scheduled date.

| Phase | Scope column | Relation column |
|---|---|---|
| Site Check | `color_mm2qm6zb` | `board_relation_mm2q8sc1` |
| Pad | `color_mm2k7s99` | `board_relation_mm2m2958` |
| Foundation | `color_mm2qs16d` | `board_relation_mm2qtwjy` |
| Break and Wrap | `color_mm2qtpcz` | `board_relation_mm2qgcwy` |
| Delivery | `color_mm2k79p8` | `board_relation_mm2m6y9s` |
| Tie Downs | `color_mm66xtqf` | `board_relation_mm665mqd` |
| Set Up | `color_mm2kyeav` | `board_relation_mm2ms4mb` |
| Steps | `color_mm2p7ksn` | `board_relation_mm2tkzqz` |
| Skirting | `color_mm2q5cjc` | `board_relation_mm2qg0cj` |
| Electric Service | `color_mm2q2npg` | `board_relation_mm2qgtf4` |
| Electric Hookup | `color_mm2mtqf1` | `board_relation_mm2vbqvw` |
| Water Well | `color_mm2nt68q` | `board_relation_mm2nfkr9` |
| Water Hookup | `color_mm2qy1ht` | `board_relation_mm2qdf8f` |
| Septic Install | `color_mm2q78hf` | `board_relation_mm2qm8xv` |
| Septic Hookup | `color_mm2qa62q` | `board_relation_mm2q32n9` |
| Trim Out | `color_mm2qqrab` | `board_relation_mm2qxtvf` |

> **Known data issue:** Jobs currently has **two** `*Site Checks` relation
> columns — `board_relation_mm2q8sc1` and `board_relation_mm33z95n`. One must be
> deleted in monday or Site Check double-counts in every report.

## 4. The report rules, stated precisely

For one vendor, over a date range (default: the current week):

**Progress per home**
- Denominator = phases whose scope column reads `Yes`.
- Numerator = phases where **every** linked task is `Done` or `Invoiced`.
  (A phase can link to several tasks — Foundation on one home links three. The
  phase is only complete when all of them are.)
- Percentage = numerator / denominator, rounded.

**Completed this week** — phases whose linked tasks finished, judged by the
Tasks board's **Finished** date column falling inside the range. Not by status,
not by modification time.

**Still pending** — each scoped, incomplete phase gets exactly one suffix. The
first matching rule wins, in this order:
1. `In progress` — a linked task has that status
2. `On hold` — a linked task has that status
3. `Scheduled {date}` — a linked task has a timeline start date
4. `Not yet scheduled`

**Sort order of pending phases** — by urgency bucket, then natural build order:
`active: 0, scheduled: 1, hold: 2, unscoped: 3`.

**Multi-task phases** list each task by its own name, with a trailing
`" for {job name}"` stripped off (the task names repeat the home name and it
reads badly in an email).

**Per-home state** (internal only):
- `unscoped` — nothing scoped yet
- `complete` — every scoped phase done
- `stalled` — no task finished in the last `21` days (`STALE_AFTER_DAYS`)
- `active` — anything else

## 5. The email

- Subject is **fixed**: `Progress Report from Dragon Transports!`
- Header reads `Progress Report from Dragon Transports!` with "Dragon
  Transports" in green.
- Table-based, inline-styled, email-client-safe HTML.
- **The progress bar must use a fixed-pixel fill inside a fixed 148px track.**
  Percentage widths collapse in the Gmail mobile app specifically. This was
  found the hard way; don't let a rebuild reintroduce it.
- Notes for the vendor are escaped with newlines preserved.

## 6. The UI (three screens, matching Job Manager's design language)

The client explicitly asked for this app to feel like their Job Manager Vibe
app — "one ecosystem, not several different apps taped together".

Design tokens actually used:
```
--ground:#F4F6F8   --surface:#FFFFFF  --ink:#1C2B36   --line:#E3E8ED
--brand:#1F5C8B    --brand-wash:#EAF1F7
--good:#1C8C5A     --crit:#D6443B     --r:12px
font: Figtree (monday's product font)
```

**Screen 1 — Vendors.** Card grid. Tabs: All Vendors / Ready to Send / Needs
Attention / Sent This Period. Search matches vendor name, recipient address,
home names and addresses. "Send all reports" lives in the **top bar**, not on a
vendor card.

**Screen 2 — Vendor detail.** Homes for that vendor. Tabs: All Homes / On Track
/ Stalled / Complete / Not Scoped. "Send report" here sends to this vendor only.

**Screen 3 — Report preview.** The rendered report, exportable.

**Dialogs.** Email settings (sending account), single send, batch send. Batch
send pre-ticks every vendor with active projects and lets the user untick.
During a send a **blocking loading curtain** covers the screen so the user
can't double-submit, then shows "Completed" and auto-closes.

CSS trap worth carrying over: a grid item defaults to `min-width:auto`, so a
card grows to fit its longest unbreakable line (an email address) and overflows
a phone. The cards set `min-width:0; overflow:hidden`.

## 7. What the monday-code version did that Vibe must replace

| Concern | How monday-code did it | Needs a Vibe answer |
|---|---|---|
| Sending mail | nodemailer → `smtp.gmail.com:465` with a Gmail **App Password** | Vibe's native Gmail integration |
| Holding the sending credentials | `SecureStorage`, key `email-settings-v1`; the password is never returned to the browser | Whatever Vibe offers; the password must never reach the client |
| Switchable sending account | Stored as **data**, editable in the app's own settings dialog — the client changes it without a code change. **Keep this.** | |
| Auth | monday session-token JWT verified with the app's **Client Secret** (not the Signing Secret) | Vibe handles this |
| Caching | 60s in-memory cache, busted after any send | Optional |

## 8. A caution worth carrying over

Two bugs in this code were subtle enough that they looked like bad data:

1. **`items(ids:)` silently caps at 25 results** when no `limit` is passed. The
   rest come back missing with no error. The code now passes an explicit limit
   **and throws if it gets back fewer items than it asked for**, rather than
   building a report from partial data. If the rebuild queries items by id,
   reproduce that guard.
2. Only the first linked task per phase was being read, so multi-task phases
   reported complete early. Read all of them.

## 9. Known data-quality issues on the live board

Not code problems, but they shape what the app shows. Flag these to the client
again:
- ~70 of 141 active jobs have **no "Bill to" vendor**, so they belong to nobody.
- Duplicate vendor records — Solitaire appears four ways, Palm Harbor three,
  Titan several.
- Only 112 of 576 tasks have a Schedule, so most pending work reads
  "Not yet scheduled".
- Every vendor's Status Update Email is currently Xander's own test address.
- The duplicate `*Site Checks` column (see §3).

---

# Source code

What follows is the complete source of the working monday-code app. The
business logic lives in `src/buildReport.js` (pure functions) and the email
template in `src/renderEmail.js` — those two are the heart of it and port most
directly. `src/index.js` is the HTTP server, `src/monday.js` the data layer,
`public/` the frontend. The tests in `test/` encode the rules from §4 as
executable examples and are the best way to check a rebuild behaves the same.


## `package.json`

```json
{
  "name": "dragon-vendor-reports",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "check": "node scripts/check.js",
    "demo": "node scripts/demo.js",
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "@mondaycom/apps-sdk": "^3.0.5",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "monday-sdk-js": "^0.5.6",
    "nodemailer": "^9.0.5"
  }
}
```


## `src/phases.js`

```javascript
// The 16 optional build phases on the Jobs board.
//
// `scope` is the Yes/No column saying whether this phase applies to a given home.
// `rel` is the Jobs -> Tasks board-relation column pointing at the task that does it.
//
// Order here is the natural build order, and is the tie-breaker when sorting
// pending work that has no scheduled date.
//
// NOTE: Jobs currently has TWO *Site Checks relation columns
// (board_relation_mm2q8sc1 and board_relation_mm33z95n). Delete one in monday
// before going live or Site Check double-counts in every report.
export const PHASES = [
  { name: 'Site Check',       scope: 'color_mm2qm6zb', rel: 'board_relation_mm2q8sc1' },
  { name: 'Pad',              scope: 'color_mm2k7s99', rel: 'board_relation_mm2m2958' },
  { name: 'Foundation',       scope: 'color_mm2qs16d', rel: 'board_relation_mm2qtwjy' },
  { name: 'Break and Wrap',   scope: 'color_mm2qtpcz', rel: 'board_relation_mm2qgcwy' },
  { name: 'Delivery',         scope: 'color_mm2k79p8', rel: 'board_relation_mm2m6y9s' },
  { name: 'Tie Downs',        scope: 'color_mm66xtqf', rel: 'board_relation_mm665mqd' },
  { name: 'Set Up',           scope: 'color_mm2kyeav', rel: 'board_relation_mm2ms4mb' },
  { name: 'Steps',            scope: 'color_mm2p7ksn', rel: 'board_relation_mm2tkzqz' },
  { name: 'Skirting',         scope: 'color_mm2q5cjc', rel: 'board_relation_mm2qg0cj' },
  { name: 'Electric Service', scope: 'color_mm2q2npg', rel: 'board_relation_mm2qgtf4' },
  { name: 'Electric Hookup',  scope: 'color_mm2mtqf1', rel: 'board_relation_mm2vbqvw' },
  { name: 'Water Well',       scope: 'color_mm2nt68q', rel: 'board_relation_mm2nfkr9' },
  { name: 'Water Hookup',     scope: 'color_mm2qy1ht', rel: 'board_relation_mm2qdf8f' },
  { name: 'Septic Install',   scope: 'color_mm2q78hf', rel: 'board_relation_mm2qm8xv' },
  { name: 'Septic Hookup',    scope: 'color_mm2qa62q', rel: 'board_relation_mm2q32n9' },
  { name: 'Trim Out',         scope: 'color_mm2qqrab', rel: 'board_relation_mm2qxtvf' },
];

export const BOARDS = {
  vendors: 18409503080,
  jobs:    18409503078,
  tasks:   18409523534,
};

export const TASK_COLUMNS = {
  status:   'color_mm2v7xnr',
  schedule: 'timerange_mm2wxekj',
  finished: 'date_mm35m8t7',
};

// Invoiced is a billing state, not a work state. To a vendor it reads as
// finished work, so it counts as complete alongside Done.
export const COMPLETE_STATUSES = new Set(['Done', 'Invoiced']);
```


## `src/config.js`

```javascript
// Config resolution. On monday-code these come from the Secrets Manager;
// locally they fall back to plain env vars so the app runs without monday.
import { SecretsManager, EnvironmentVariablesManager } from '@mondaycom/apps-sdk';

let secrets;
let envs;
try { secrets = new SecretsManager(); } catch { secrets = null; }
try { envs = new EnvironmentVariablesManager(); } catch { envs = null; }

export function readConfig(key, fallback = undefined) {
  try { const v = secrets?.get(key); if (v) return v; } catch { /* not on monday-code */ }
  try { const v = envs?.get(key); if (v) return v; } catch { /* not on monday-code */ }
  return process.env[key] ?? fallback;
}

export const config = {
  get mondayToken() { return readConfig('MONDAY_API_TOKEN'); },
  // monday signs session tokens with the app's CLIENT SECRET (not the
  // "Signing Secret" — that one is for integration webhooks). The env key name
  // is historical; the value stored in it must be the Client Secret.
  get clientSecret() { return readConfig('MONDAY_SIGNING_SECRET'); },
  get completedGraceDays() { return Number(readConfig('COMPLETED_GRACE_DAYS', '14')); },
  get officePhone() { return readConfig('OFFICE_PHONE', ''); },
  get port() { return Number(readConfig('PORT', '8080')); },
};
```


## `src/week.js`

```javascript
// Date helpers. The report week is Monday 00:00 -> Sunday 23:59 in America/Chicago.
//
// monday returns dates as plain 'YYYY-MM-DD' strings with no timezone, so we do
// all arithmetic on plain dates anchored at UTC noon. That keeps a day from
// slipping either side of a DST boundary, and lets range checks be plain string
// comparisons.

const TZ = 'America/Chicago';

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Current date in Chicago as 'YYYY-MM-DD'. */
export function todayInChicago(now = new Date()) {
  return ymdFmt.format(now);
}

/** ISO weekday (Mon=1 .. Sun=7) for a 'YYYY-MM-DD' date. */
export function isoWeekday(ymd) {
  return DOW[dowFmt.format(anchor(ymd))];
}

function anchor(ymd) {
  return new Date(`${ymd}T12:00:00Z`);
}

/** Shift a 'YYYY-MM-DD' date by whole days. */
export function addDays(ymd, days) {
  const d = anchor(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The report week containing `now` — the week just ending.
 * Running on Friday, this is Monday of the current week through the coming Sunday.
 */
export function reportWeek(now = new Date()) {
  const today = todayInChicago(now);
  const start = addDays(today, -(isoWeekday(today) - 1));
  return { start, end: addDays(start, 6) };
}

/** True when a 'YYYY-MM-DD' date falls inside the week, inclusive. */
export function inWeek(ymd, week) {
  return Boolean(ymd) && ymd >= week.start && ymd <= week.end;
}

const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
});

/** 'YYYY-MM-DD' -> 'Tue, Aug 18' */
export function formatDay(ymd) {
  return dayFmt.format(anchor(ymd)).replace(',', ',');
}

const rangeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric',
});

/** A week -> 'August 17-23, 2026' */
export function formatWeekRange(week) {
  const a = rangeFmt.format(anchor(week.start));
  const b = rangeFmt.format(anchor(week.end));
  const year = week.end.slice(0, 4);
  const [am] = a.split(' ');
  const [bm, bd] = b.split(' ');
  return am === bm ? `${a}-${bd}, ${year}` : `${a} - ${b}, ${year}`;
}
```


## `src/monday.js`

```javascript
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
  lastReportSent: 'date_mm6e3f1a',     // "Last Report Sent" on Vendors, written by the app
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
// The office writes this long-text column on Jobs specifically for the vendor,
// so it goes into the report verbatim. Resolved by title rather than id, so a
// rename or absence degrades to "no note" instead of an error.
const VENDOR_NOTE_TITLE = 'notes for the vendor';

async function findVendorNoteColumn(token) {
  try {
    const data = await mondayFetch(
      `query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type } } }`,
      { ids: [String(BOARDS.jobs)] }, token);
    const col = (data.boards?.[0]?.columns || []).find(
      (c) => c.type === 'long_text' && c.title.trim().toLowerCase() === VENDOR_NOTE_TITLE);
    return col?.id || null;
  } catch (err) {
    console.error('could not resolve vendor note column:', err.message);
    return null;
  }
}

export async function loadReportData({ token, recentlyCompletedSince }) {
  const noteColumnId = await findVendorNoteColumn(token);
  const scopeCols = PHASES.map((p) => p.scope);
  const relCols = PHASES.map((p) => p.rel);

  const rawJobs = await fetchItems({
    boardId: BOARDS.jobs,
    columnIds: [JOB_COLUMNS.address, JOB_COLUMNS.vendor, JOB_COLUMNS.finishDate,
      ...(noteColumnId ? [noteColumnId] : []), ...scopeCols, ...relCols],
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
      note: (noteColumnId && cols[noteColumnId]?.text || '').trim(),
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
    columnIds: [VENDOR_COLUMNS.statusUpdateEmail, VENDOR_COLUMNS.lastReportSent],
    token,
  });

  const vendorsById = new Map(rawVendors.map((raw) => {
    const cols = byId(raw);
    const emailCol = cols[VENDOR_COLUMNS.statusUpdateEmail];
    return [raw.id, {
      id: raw.id,
      name: raw.name,
      recipients: splitRecipients(emailCol?.email || emailCol?.text || ''),
      lastSent: cols[VENDOR_COLUMNS.lastReportSent]?.date || null,
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

/** Record on the Vendors board that a report went out today. */
export async function markVendorSent({ vendorId, date, token }) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`;
  await mondayFetch(mutation, {
    boardId: String(BOARDS.vendors),
    itemId: String(vendorId),
    columnId: VENDOR_COLUMNS.lastReportSent,
    value: JSON.stringify({ date }),
  }, token);
}
```


## `src/buildReport.js`

```javascript
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
```


## `src/renderEmail.js`

```javascript
// Report object -> email HTML. Fixed template over column values; nothing
// generated. Email-client constraints: tables for layout, inline styles only.
//
// Two things differ from the in-app view on purpose:
// - unscoped homes are left out (nothing truthful to say about them)
// - the internal stalled/on-track labels are left out; a customer sees the
//   work itself, not our triage

const INK = '#191F21';
const SOFT = '#5A6863';
const FAINT = '#8B9791';
const RULE = '#D5DAD3';
const WELL = '#EFF1ED';
const GREEN = '#0B6E4F';
const AMBER = '#B26612';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TONE = { active: GREEN, hold: AMBER, unscheduled: FAINT, scheduled: SOFT };

function progressBar({ done, total, pct }) {
  const TRACK = 148;
  // a started home always shows at least a visible sliver
  const fill = pct <= 0 ? 0 : Math.max(8, Math.round((TRACK * Math.min(pct, 100)) / 100));
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">
      <tr>
        <td width="${TRACK}" style="width:${TRACK}px;padding:0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${TRACK}" style="width:${TRACK}px">
            <tr><td style="background:#DCE2DA;border-radius:4px;height:8px;line-height:8px;font-size:1px;padding:0;mso-line-height-rule:exactly">${
              fill > 0
                ? `<div style="width:${fill}px;max-width:${TRACK}px;height:8px;line-height:8px;font-size:1px;background:${GREEN};border-radius:4px">&#8202;</div>`
                : '&#8202;'
            }</td></tr>
          </table>
        </td>
        <td style="padding-left:12px;font:500 12.5px ${FONT};color:${SOFT};white-space:nowrap">${done} of ${total} steps</td>
      </tr>
    </table>`;
}

function line(left, right, colour) {
  return `
      <tr>
        <td style="font:400 14.5px ${FONT};color:${INK};padding:0 14px 5px 0;border-bottom:1px solid ${RULE}">${esc(left)}</td>
        <td align="right" style="font:500 12px ${FONT};color:${colour};padding:0 0 5px;border-bottom:1px solid ${RULE};white-space:nowrap">${esc(right)}</td>
      </tr>`;
}

function group(heading, colour, rows) {
  return `
    <p style="margin:0 0 6px;font:600 10.5px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:${colour}">${heading}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">${rows}</table>`;
}

function note(text) {
  return `<p style="margin:0 0 16px;padding:10px 14px;background:${WELL};border-radius:3px;font:400 14.5px ${FONT};color:${SOFT}">${esc(text)}</p>`;
}

// Long-text columns are multi-line; keep the office's line breaks.
const escMultiline = (t) => esc(t).replace(/\r?\n/g, '<br>');

function jobSection(job) {
  const note = job.note
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px"><tr>
        <td style="padding:11px 14px;background:#F3F7F1;border-left:3px solid ${GREEN};border-radius:3px">
          <p style="margin:0 0 3px;font:600 10.5px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:${GREEN}">A note from Dragon Transports</p>
          <p style="margin:0;font:400 14.5px ${FONT};color:${INK}">${escMultiline(job.note)}</p>
        </td></tr></table>`
    : '';
  const completed = job.completed.length
    ? group('Completed', GREEN, job.completed.map((c) => line(c.name, c.dateLabel, SOFT)).join(''))
    : note('No tasks were completed on this home this period.');
  const pending = job.pending.length
    ? group('Still to do', SOFT, job.pending.map((p) => line(p.name, p.status, TONE[p.tone] || SOFT)).join(''))
    : note('All scheduled work on this home is complete.');

  return `
  <tr><td style="padding:22px 0 0;border-top:1px solid ${RULE}">
    <p style="margin:0 0 2px;font:600 17px ${FONT};color:${INK}">${esc(job.name)}</p>
    ${job.address ? `<p style="margin:0 0 14px;font:400 13.5px ${FONT};color:${SOFT}">${esc(job.address)}</p>` : ''}
    ${progressBar(job.progress)}
    ${note}
    ${completed}
    ${pending}
  </td></tr>`;
}

/**
 * @param report  one vendor's report object (as in the centre payload)
 * @param rangeLabel  e.g. "August 17-23, 2026"
 */
export function renderEmail(report, rangeLabel, { officePhone = '' } = {}) {
  const shown = report.jobs.filter((j) => j.state !== 'unscoped');
  const homes = `${shown.length} home${shown.length === 1 ? '' : 's'}`;
  const done = shown.reduce((n, j) => n + j.completed.length, 0);
  const tasks = `${done} task${done === 1 ? '' : 's'} completed this period`;
  const contact = officePhone
    ? `Reply to this email or call the office at ${esc(officePhone)}.`
    : 'Reply to this email and we will get right back to you.';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.vendor.name)} — progress report</title></head>
<body style="margin:0;padding:0;background:#F1F3EF">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1F3EF">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#FFFFFF;border:1px solid ${RULE};border-radius:4px">
        <tr><td style="padding:30px 28px 34px">
          <h1 style="margin:0 0 4px;font:700 23px ${FONT};color:${INK};letter-spacing:-.3px">Progress Report from <span style="color:${GREEN}">Dragon Transports</span>!</h1>
          <p style="margin:0 0 18px;font:400 13.5px ${FONT};color:${SOFT}">${esc(report.vendor.name)} · ${esc(rangeLabel)}</p>
          <p style="margin:0 0 8px;padding:11px 15px;background:${WELL};border-radius:3px;font:400 14px ${FONT};color:${INK}"><strong>${homes}</strong> · ${tasks}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${shown.map(jobSection).join('')}
          </table>
          <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid ${RULE};font:400 13px ${FONT};color:${SOFT}">Questions on any home above? ${contact}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderSubject(_report, _rangeLabel) {
  return 'Progress Report from Dragon Transports!';
}
```


## `src/centre.js`

```javascript
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
      lastSent: vendor.lastSent || null,
      lastSentLabel: label(vendor.lastSent),
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
    ranges: periods.map((p) => ({ key: p.key, label: p.label, range: formatWeekRange(p), start: p.start, end: p.end })),
    vendors,
    readiness: accountReadiness(data),
  };
}
```


## `src/emailSettings.js`

```javascript
// The sending account is DATA, not code. It lives in monday-code Secure
// Storage so the office can switch Gmail accounts from the app's Settings
// screen without a deploy. Locally (npm run demo) it falls back to memory.
import { SecureStorage } from '@mondaycom/apps-sdk';

const KEY = 'email-settings-v1';

let store = null;
let memory = null; // local fallback

function storage() {
  if (store === null) {
    try { store = new SecureStorage(); } catch { store = false; }
  }
  return store;
}

export async function getEmailSettings() {
  const s = storage();
  if (!s) return memory;
  try {
    const raw = await s.get(KEY);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function setEmailSettings({ address, appPassword }) {
  const value = { address: String(address).trim(), appPassword: String(appPassword).replace(/\s+/g, '') };
  const s = storage();
  if (!s) { memory = value; return; }
  await s.set(KEY, JSON.stringify(value));
}

export async function clearEmailSettings() {
  const s = storage();
  if (!s) { memory = null; return; }
  try { await s.delete(KEY); } catch { /* already gone */ }
}

/** What the frontend may see. Never the password. */
export function publicView(settings) {
  return settings?.address ? { connected: true, address: settings.address } : { connected: false, address: null };
}
```


## `src/gmail.js`

```javascript
// Sends through Gmail's own servers (smtp.gmail.com) authenticated as the
// configured account — to Google and to every receiving mailbox this is the
// same as that person pressing Send by hand. Requires a Gmail App Password
// (Google Account -> Security -> 2-Step Verification -> App passwords).
import nodemailer from 'nodemailer';

function transport({ address, appPassword }) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: address, pass: appPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

/** Check the credentials actually log in. Throws with a readable message. */
export async function verifyCredentials(settings) {
  try {
    await transport(settings).verify();
  } catch (err) {
    if (err?.code === 'EAUTH') {
      throw new Error('Gmail rejected the sign-in. Check the address, and make sure this is an App Password (not the normal account password).');
    }
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET' || err?.code === 'ECONNECTION') {
      throw new Error(`Could not reach Gmail's mail server from this host (${err.code}). Outbound SMTP may be blocked.`);
    }
    throw new Error(`Gmail connection failed: ${err.message}`);
  }
}

export async function sendEmail({ settings, to, subject, html }) {
  const info = await transport(settings).sendMail({
    from: settings.address,
    to: to.join(', '),
    subject,
    html,
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
```


## `src/auth.js`

```javascript
// monday sends the frontend a short-lived session token; the backend verifies
// it with the app's CLIENT SECRET before serving anything. (Not the Signing
// Secret — session tokens are signed with the client secret.)
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function verifySessionToken(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /i, '') || req.query.sessionToken;
  if (!token) return res.status(401).json({ error: 'missing session token' });
  try {
    req.session = jwt.verify(token, config.clientSecret);
    next();
  } catch {
    res.status(401).json({ error: 'invalid session token' });
  }
}
```


## `src/readiness.js`

```javascript
// What the centre can usefully tell the office about its own data.
//
// There is no send gate any more — a person reviews every report before it
// leaves — so nothing here blocks anything. It is a worklist, not a guard.

/** Account-level gaps worth surfacing in the centre. */
export function accountReadiness({ orphanJobs, totalJobs }) {
  return {
    totalJobs,
    jobsMissingVendor: orphanJobs.length,
    jobsMissingVendorSample: orphanJobs.slice(0, 25).map((j) => ({ id: j.id, name: j.name })),
  };
}
```


## `src/probe.js`

```javascript
// Answers one question: can this host open an SMTP connection to Gmail?
// No auth and no parameters on purpose — it can only ever talk to
// smtp.gmail.com, reads the greeting banner, and hangs up.
import net from 'node:net';
import tls from 'node:tls';

const HOST = 'smtp.gmail.com';
const TIMEOUT = 8000;

function attempt(port, useTls) {
  return new Promise((resolve) => {
    const done = (result) => { try { socket.destroy(); } catch { /* closed */ } resolve({ port, ...result }); };
    const socket = useTls
      ? tls.connect({ host: HOST, port, timeout: TIMEOUT, servername: HOST })
      : net.connect({ host: HOST, port, timeout: TIMEOUT });

    let banner = '';
    socket.on('data', (chunk) => {
      banner += chunk.toString('utf8');
      if (banner.includes('\n')) done({ ok: banner.startsWith('220'), banner: banner.trim().slice(0, 80) });
    });
    socket.on('timeout', () => done({ ok: false, error: 'timeout — port likely blocked' }));
    socket.on('error', (err) => done({ ok: false, error: `${err.code || ''} ${err.message}`.trim() }));
  });
}

export async function probeGmailSmtp() {
  const [p465, p587] = await Promise.all([attempt(465, true), attempt(587, false)]);
  return {
    host: HOST,
    results: [p465, p587],
    verdict: p465.ok || p587.ok
      ? 'SMTP reachable — the app password route will work.'
      : 'SMTP blocked from this host — we fall back to the OAuth route.',
  };
}
```


## `src/index.js`

```javascript
import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadCentre, periodsFor } from './centre.js';
import { markVendorSent } from './monday.js';
import { todayInChicago } from './week.js';
import { verifySessionToken } from './auth.js';
import { probeGmailSmtp } from './probe.js';
import { getEmailSettings, setEmailSettings, clearEmailSettings, publicView } from './emailSettings.js';
import { verifyCredentials, sendEmail } from './gmail.js';
import { renderEmail, renderSubject } from './renderEmail.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Fixed-destination connectivity check for the Gmail route. Harmless and
// parameterless, so it sits outside auth: it can only ever dial smtp.gmail.com.
app.get('/probe/email', async (_req, res) => res.json(await probeGmailSmtp()));

// One monday read serves every vendor and every period, so the UI stays snappy
// when someone clicks between vendors. Short TTL — the boards change all day.
const TTL_MS = 60_000;
let cache = null;

async function centre() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await loadCentre();
  cache = { at: Date.now(), value };
  return value;
}

// Best-effort write-back of Last Report Sent; a board hiccup must never
// turn a successfully sent email into a reported failure.
async function recordSent(vendorId) {
  try {
    await markVendorSent({ vendorId, date: todayInChicago(), token: config.mondayToken });
  } catch (err) {
    console.error(`could not write Last Report Sent for ${vendorId}:`, err.message);
  }
}

const api = express.Router();
api.use(verifySessionToken);

api.get('/centre', async (_req, res, next) => {
  try { res.json(await centre()); } catch (err) { next(err); }
});

api.post('/refresh', async (_req, res, next) => {
  try { cache = null; res.json(await centre()); } catch (err) { next(err); }
});

// ---- email settings (the sending account is data, not code) ---------------

api.get('/settings', async (_req, res, next) => {
  try { res.json(publicView(await getEmailSettings())); } catch (err) { next(err); }
});

api.post('/settings', async (req, res, next) => {
  try {
    const { address, appPassword } = req.body || {};
    if (!address?.includes('@') || !appPassword) {
      return res.status(400).json({ error: 'An email address and an App Password are both required.' });
    }
    const candidate = { address: address.trim(), appPassword };
    await verifyCredentials(candidate); // only store credentials that actually log in
    await setEmailSettings(candidate);
    res.json(publicView(candidate));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.delete('/settings', async (_req, res, next) => {
  try { await clearEmailSettings(); res.json({ connected: false, address: null }); } catch (err) { next(err); }
});

api.post('/settings/test', async (_req, res, next) => {
  try {
    const settings = await getEmailSettings();
    if (!settings) return res.status(400).json({ error: 'No sending account connected yet.' });
    const result = await sendEmail({
      settings,
      to: [settings.address],
      subject: 'Vendor Reports — test email',
      html: '<p>This is a test from the Dragon Transport Vendor Reporting Centre. Sending works.</p>',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- send many vendors in one pass -----------------------------------------
// Recipients come from the board's Status Update Email column, resolved on the
// server — the browser only says WHO, never WHERE. Vendors are processed one
// at a time and each outcome is reported, so one bad address cannot stop the
// batch and nothing fails silently.

api.post('/send-all', async (req, res, next) => {
  try {
    const { periodKey, vendorIds } = req.body || {};
    if (!Array.isArray(vendorIds) || !vendorIds.length) {
      return res.status(400).json({ error: 'No vendors selected.' });
    }

    const settings = await getEmailSettings();
    if (!settings) return res.status(400).json({ error: 'Connect a sending account in Settings first.' });

    const data = await centre();
    const period = data.ranges.find((r) => r.key === periodKey);
    if (!period) return res.status(400).json({ error: 'Unknown report period.' });

    const results = [];
    for (const id of vendorIds.map(String)) {
      const vendor = data.vendors.find((v) => String(v.id) === id);
      if (!vendor) { results.push({ vendorId: id, name: id, status: 'failed', error: 'vendor not found' }); continue; }
      const report = vendor.reports?.[periodKey];
      const sendable = report && report.jobs.some((j) => j.state !== 'unscoped');
      if (!sendable) { results.push({ vendorId: id, name: vendor.name, status: 'skipped', error: 'nothing to report' }); continue; }
      if (!vendor.recipients?.length) { results.push({ vendorId: id, name: vendor.name, status: 'skipped', error: 'no Status Update Email on the Vendors board' }); continue; }
      try {
        await sendEmail({
          settings,
          to: vendor.recipients,
          subject: renderSubject(report, period.range),
          html: renderEmail(report, period.range, { officePhone: config.officePhone }),
        });
        results.push({ vendorId: id, name: vendor.name, status: 'sent', to: vendor.recipients });
        await recordSent(id);
      } catch (err) {
        results.push({ vendorId: id, name: vendor.name, status: 'failed', error: err.message });
      }
    }

    const tally = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
    console.log('send-all:', JSON.stringify(tally));
    cache = null; // next load shows the new Last Report Sent dates
    res.json({ ok: true, from: settings.address, period: period.range, tally, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- send one vendor's report ---------------------------------------------
// Human-triggered from the report screen. The server re-renders from its own
// data (never trusts HTML from the browser) and sends via the stored account.

api.post('/send', async (req, res, next) => {
  try {
    const { vendorId, periodKey, to } = req.body || {};
    const recipients = [...new Set(String(to || '').split(/[;,]/).map((s) => s.trim()).filter((s) => s.includes('@')))];
    if (!recipients.length) return res.status(400).json({ error: 'Enter at least one recipient email address.' });

    const settings = await getEmailSettings();
    if (!settings) return res.status(400).json({ error: 'Connect a sending account in Settings first.' });

    const data = await centre();
    const vendor = data.vendors.find((v) => String(v.id) === String(vendorId));
    const report = vendor?.reports?.[periodKey];
    const period = data.ranges.find((r) => r.key === periodKey);
    if (!report || !period) return res.status(400).json({ error: 'Unknown vendor or report period.' });

    const result = await sendEmail({
      settings,
      to: recipients,
      subject: renderSubject(report, period.range),
      html: renderEmail(report, period.range, { officePhone: config.officePhone }),
    });
    console.log(`report sent: ${vendor.name} (${periodKey}) -> ${recipients.join(', ')}`);
    await recordSent(vendor.id);
    cache = null; // next load shows the new Last Report Sent
    res.json({ ok: true, to: recipients, from: settings.address, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/api', api);

// The monday client SDK, served from our own origin rather than a CDN.
app.get('/vendor/monday-sdk.js', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../node_modules/monday-sdk-js/dist/main.js', import.meta.url))));

// no-cache: the browser must revalidate index.html and app.js on every load,
// otherwise an iframe can keep serving last deploy's script under this
// deploy's page — buttons render but their handlers are missing.
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => console.log(`vendor reporting centre on ${config.port}`));
```


## `public/index.html`

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vendor Reports</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap">
<style>
  /* Design language mirrors the Job Manager app so the two read as one
     product: Figtree, navy primary, white cards on a cool grey ground,
     pill tabs with counts, and a card anatomy of
     name -> status -> meta -> progress -> next -> footer. */
  :root {
    --ground:#F4F6F8; --surface:#FFFFFF; --sunken:#EEF1F4;
    --ink:#1C2B36; --ink-2:#64757F; --ink-3:#95A3AE;
    --line:#E3E8ED; --line-2:#D4DBE2;
    --brand:#1F5C8B; --brand-2:#184A70; --brand-wash:#EAF1F7; --brand-line:#9DC2DE;
    --good:#1C8C5A; --good-wash:#E7F4ED;
    --warn:#B9731A; --warn-wash:#FBF0E2;
    --crit:#D6443B; --crit-wash:#FCEBEA;
    --on-brand:#FFFFFF;
    --shadow:0 1px 2px rgba(28,43,54,.05);
    --shadow-lg:0 12px 32px -12px rgba(28,43,54,.28);
    --r:12px; --r-sm:8px;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#13181C; --surface:#1B2228; --sunken:#222A31;
      --ink:#E8EDF1; --ink-2:#9DABB6; --ink-3:#73828D;
      --line:#2A333B; --line-2:#3A454E;
      --brand:#4D9AD1; --brand-2:#6FB0DD; --brand-wash:#1A2A37; --brand-line:#35566F;
      --good:#4FBF8B; --good-wash:#162A22;
      --warn:#D99B4A; --warn-wash:#2C2419;
      --crit:#E2776D; --crit-wash:#2E1E1D;
      --on-brand:#0C171F;
      --shadow:0 1px 2px rgba(0,0,0,.4);
      --shadow-lg:0 12px 32px -12px rgba(0,0,0,.65);
    }
  }
  :root[data-theme="dark"] {
    --ground:#13181C; --surface:#1B2228; --sunken:#222A31;
    --ink:#E8EDF1; --ink-2:#9DABB6; --ink-3:#73828D;
    --line:#2A333B; --line-2:#3A454E;
    --brand:#4D9AD1; --brand-2:#6FB0DD; --brand-wash:#1A2A37; --brand-line:#35566F;
    --good:#4FBF8B; --good-wash:#162A22;
    --warn:#D99B4A; --warn-wash:#2C2419;
    --crit:#E2776D; --crit-wash:#2E1E1D;
    --on-brand:#0C171F;
    --shadow:0 1px 2px rgba(0,0,0,.4);
    --shadow-lg:0 12px 32px -12px rgba(0,0,0,.65);
  }

  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--ink);
    font-family:Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
  }
  .i { width:15px; height:15px; flex:none; stroke:currentColor; fill:none;
       stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .page { max-width:1320px; margin:0 auto; padding:26px 28px 90px; }

  /* ---------- header ---------- */
  .head { display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap; margin:0 0 20px; }
  .head h1 { font-size:27px; font-weight:700; letter-spacing:-.02em; margin:0; line-height:1.15; }
  .head p { margin:2px 0 0; font-size:13.5px; color:var(--ink-2); }
  .head-actions { margin-left:auto; display:flex; align-items:center; gap:9px; }
  .icon-btn {
    width:38px; height:38px; border-radius:50%; border:1px solid var(--line);
    background:var(--surface); color:var(--ink-2); cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center; padding:0;
  }
  .icon-btn:hover { border-color:var(--brand); color:var(--brand); }
  .icon-btn .i { width:17px; height:17px; }
  .btn {
    font:inherit; font-size:14px; font-weight:600; padding:9px 16px; border-radius:var(--r-sm);
    border:1px solid var(--line-2); background:var(--surface); color:var(--ink);
    cursor:pointer; display:inline-flex; align-items:center; gap:7px; white-space:nowrap;
  }
  .btn:hover { border-color:var(--brand); color:var(--brand); }
  .btn.primary { background:var(--brand); border-color:var(--brand); color:var(--on-brand); }
  .btn.primary:hover { background:var(--brand-2); border-color:var(--brand-2); color:var(--on-brand); }
  .btn[disabled] { opacity:.5; cursor:default; }
  .btn.sm { padding:7px 12px; font-size:13px; }

  /* ---------- search + filters ---------- */
  .search { position:relative; margin:0 0 14px; }
  .search .i { position:absolute; left:15px; top:50%; transform:translateY(-50%); color:var(--ink-3); width:17px; height:17px; }
  .search input {
    width:100%; font:inherit; font-size:14.5px; padding:12px 15px 12px 43px;
    border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--ink);
  }
  .search input::placeholder { color:var(--ink-3); }
  .search input:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px var(--brand-wash); }

  .filterbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 16px; }
  .fpill {
    display:inline-flex; align-items:center; gap:8px; padding:8px 14px;
    border:1px solid var(--line-2); border-radius:20px; background:var(--surface);
    font-size:13.5px; font-weight:500; color:var(--ink); cursor:pointer;
  }
  .fpill:hover { border-color:var(--brand); }
  .fpill select {
    font:inherit; font-size:13.5px; font-weight:500; border:0; background:none;
    color:var(--ink); cursor:pointer; padding:0; outline:none;
  }
  .fnote { font-size:12.5px; color:var(--ink-3); margin-left:auto; }

  /* ---------- tabs ---------- */
  .tabs { display:flex; gap:11px; flex-wrap:wrap; margin:0 0 16px; }
  .tab {
    flex:1 1 150px; min-width:140px; padding:12px 16px; border-radius:11px;
    border:1px solid var(--line); background:var(--surface); color:var(--ink);
    font:inherit; font-size:14px; font-weight:600; cursor:pointer;
    display:flex; align-items:center; justify-content:center; gap:9px;
  }
  .tab:hover { border-color:var(--brand-line); }
  .tab .n { font-size:12.5px; font-weight:600; color:var(--ink-3); }
  .tab[aria-pressed="true"] { background:var(--brand); border-color:var(--brand); color:var(--on-brand); }
  .tab[aria-pressed="true"] .n { color:var(--on-brand); opacity:.75; }
  .tab .n.badge {
    background:var(--brand); color:var(--on-brand); border-radius:11px;
    min-width:22px; padding:1px 7px; text-align:center;
  }
  .tab[aria-pressed="true"] .n.badge { background:rgba(255,255,255,.25); opacity:1; }

  .subtabs {
    display:flex; gap:8px; flex-wrap:wrap; padding:7px;
    border:1.5px solid var(--brand-line); border-radius:13px; margin:0 0 18px;
  }
  .subtab {
    flex:1 1 130px; padding:9px 14px; border-radius:9px; border:0; background:none;
    font:inherit; font-size:13.5px; font-weight:600; color:var(--ink); cursor:pointer;
    display:flex; align-items:center; justify-content:center; gap:8px;
  }
  .subtab:hover { background:var(--brand-wash); }
  .subtab .n { font-size:12px; color:var(--ink-3); }
  .subtab[aria-pressed="true"] { background:var(--brand); color:var(--on-brand); }
  .subtab[aria-pressed="true"] .n { color:var(--on-brand); opacity:.75; }

  /* ---------- cards ---------- */
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(336px,100%),1fr)); gap:18px; }
  .card {
    background:var(--surface); border:1px solid var(--line); border-radius:var(--r);
    padding:19px 20px; box-shadow:var(--shadow); text-align:left; width:100%;
    font:inherit; color:inherit; display:block;
    /* a grid item defaults to min-width:auto, so without this the card grows to
       fit its longest unbreakable line (an email) and overflows the phone */
    min-width:0; overflow:hidden;
  }
  button.card { cursor:pointer; }
  button.card:hover { border-color:var(--brand-line); box-shadow:var(--shadow-lg); }
  .card-top { display:flex; align-items:center; gap:10px; margin:0 0 9px; }
  .card-name { flex:1; min-width:0; font-size:16.5px; font-weight:700; letter-spacing:-.01em;
    line-height:1.3; overflow-wrap:anywhere; }
  .chev { width:27px; height:27px; border-radius:50%; border:1px solid var(--line); flex:none;
    display:flex; align-items:center; justify-content:center; color:var(--ink-3); }
  .chev .i { width:14px; height:14px; }
  .card.open .chev { background:var(--brand); border-color:var(--brand); color:var(--on-brand); }
  .card.open .chev .i { transform:rotate(180deg); }
  .card-pills { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 11px; }
  .pill {
    font-size:12px; font-weight:600; padding:4px 11px; border-radius:20px; white-space:nowrap;
    background:var(--brand); color:var(--on-brand);
  }
  .pill.grey { background:var(--sunken); color:var(--ink-2); }
  .pill.good { background:var(--good-wash); color:var(--good); }
  .pill.warn { background:var(--warn-wash); color:var(--warn); }
  .pill.crit { background:var(--crit-wash); color:var(--crit); }
  /* min-width:0 throughout: flex items default to min-width:auto, which stops
     long emails and addresses shrinking and pushes the whole card wider than
     the phone viewport. */
  .meta { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-2);
    margin:0 0 5px; min-width:0; }
  .meta .i { width:14px; height:14px; color:var(--ink-3); }
  .meta.bad { color:var(--crit); } .meta.bad .i { color:var(--crit); }
  .meta > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .prog-head { display:flex; justify-content:space-between; gap:10px; font-size:12.5px;
    color:var(--ink-2); margin:14px 0 6px; min-width:0; }
  .prog-head span:last-child { white-space:nowrap; }
  .bar { height:6px; border-radius:4px; background:var(--sunken); overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--brand); border-radius:4px; }
  .bar.full i { background:var(--good); }
  .card-div { border-top:1px solid var(--line); margin:14px 0 0; padding-top:11px; }
  .card-foot { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-3); min-width:0; }
  .card-foot > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card-foot .i { width:14px; height:14px; }
  .next-l { font-size:13px; color:var(--ink); font-weight:600; }
  .next-s { font-size:12.5px; color:var(--ink-2); }

  /* ---------- stat tiles ---------- */
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin:0 0 18px; }
  .stat { background:var(--surface); border:1px solid var(--line); border-radius:var(--r); padding:15px 17px; box-shadow:var(--shadow); }
  .stat b { display:block; font-size:26px; font-weight:700; line-height:1.1; letter-spacing:-.02em; }
  .stat span { font-size:12.5px; color:var(--ink-2); }
  .stat.good b { color:var(--good); } .stat.crit b { color:var(--crit); } .stat.warn b { color:var(--warn); }

  /* ---------- detail ---------- */
  .back { display:inline-flex; align-items:center; gap:6px; background:none; border:0; padding:0;
    font:inherit; font-size:13.5px; font-weight:600; color:var(--brand); cursor:pointer; margin:0 0 12px; }
  .home-body { display:none; border-top:1px solid var(--line); margin-top:14px; padding-top:13px; }
  .card.open .home-body { display:block; }
  .grp { margin:0 0 13px; }
  .grp:last-child { margin-bottom:0; }
  .grp h4 { font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
    margin:0 0 7px; color:var(--ink-2); }
  .grp h4.done { color:var(--good); }
  .grp ul { margin:0; padding:0; list-style:none; }
  .grp li { display:flex; justify-content:space-between; gap:14px; font-size:13.5px;
    padding:5px 0; border-bottom:1px solid var(--line); }
  .grp li:last-child { border-bottom:0; }
  .grp li em { font-style:normal; font-size:12.5px; color:var(--ink-2); white-space:nowrap; }
  .grp li em.active-t { color:var(--brand); font-weight:600; }
  .grp li em.hold-t { color:var(--warn); }
  .grp li em.unscheduled-t { color:var(--ink-3); }
  .empty { font-size:13px; color:var(--ink-2); background:var(--sunken); padding:9px 13px; border-radius:var(--r-sm); margin:0 0 13px; }
  .vnote { margin:0 0 13px; padding:11px 14px; background:var(--brand-wash);
    border-left:3px solid var(--brand); border-radius:var(--r-sm); font-size:13.5px; }
  .vnote-h { display:block; font-size:11px; font-weight:700; letter-spacing:.07em;
    text-transform:uppercase; color:var(--brand); margin-bottom:3px; }
  .none { text-align:center; padding:48px 20px; color:var(--ink-2); font-size:14px; }

  /* ---------- report ---------- */
  .rbar { display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin:0 0 18px; }
  .rbar .spacer { margin-left:auto; }
  .paper { max-width:720px; margin:0 auto; background:var(--surface); border:1px solid var(--line);
    border-radius:var(--r); padding:34px 34px 38px; box-shadow:var(--shadow); }
  .p-title { font-size:22px; font-weight:700; margin:0 0 3px; letter-spacing:-.02em; }
  .p-title span { color:var(--brand); }
  .p-dates { font-size:13.5px; color:var(--ink-2); margin:0 0 16px; }
  .p-count { font-size:14px; padding:11px 15px; background:var(--sunken); border-radius:var(--r-sm); margin:0 0 6px; }
  .p-job { border-top:1px solid var(--line); padding:19px 0 2px; }
  .p-job h3 { font-size:16px; font-weight:700; margin:0 0 2px; }
  .p-addr { font-size:13px; color:var(--ink-2); margin:0 0 12px; }
  .p-prog { display:flex; align-items:center; gap:12px; margin:0 0 14px; }
  .p-prog .bar { flex:0 0 150px; }
  .p-prog .frac { font-size:12.5px; color:var(--ink-2); }
  .p-foot { border-top:1px solid var(--line); margin-top:18px; padding-top:14px; font-size:13px; color:var(--ink-2); }
  .rnote { max-width:720px; margin:14px auto 0; font-size:12.5px; color:var(--ink-3); text-align:center; }

  /* ---------- screens ---------- */
  [data-screen="vendors"] #screenDetail, [data-screen="vendors"] #screenReport,
  [data-screen="detail"]  #screenVendors, [data-screen="detail"]  #screenReport,
  [data-screen="report"]  #screenVendors, [data-screen="report"]  #screenDetail { display:none; }
  body.loading .page, body.errored .page { display:none; }
  body:not(.loading) #loading, body:not(.errored) #error { display:none; }
  .curtain { min-height:70vh; display:flex; align-items:center; justify-content:center; text-align:center; padding:28px; }
  .curtain h2 { font-size:19px; font-weight:700; margin:0 0 7px; }
  .curtain p { margin:0 0 15px; color:var(--ink-2); font-size:14px; max-width:46ch; }
  .spinner { width:30px; height:30px; border-radius:50%; border:3px solid var(--line);
    border-top-color:var(--brand); animation:spin .8s linear infinite; margin:0 auto 15px; }
  @keyframes spin { to { transform:rotate(360deg); } }

  /* ---------- dialogs ---------- */
  .overlay { display:none; position:fixed; inset:0; background:rgba(28,43,54,.45);
    z-index:50; align-items:center; justify-content:center; padding:18px; }
  .overlay.open { display:flex; }
  .dialog { background:var(--surface); border-radius:var(--r); box-shadow:var(--shadow-lg);
    padding:24px 26px; width:100%; max-width:480px; }
  .dialog h2 { font-size:19px; font-weight:700; margin:0 0 8px; letter-spacing:-.015em; }
  .dlg-sub { font-size:13.5px; color:var(--ink-2); margin:0 0 14px; }
  .dlg-status { font-size:13px; margin:0 0 14px; color:var(--ink-2); }
  .dlg-status b { color:var(--brand); font-weight:600; }
  .dlg-label { display:block; font-size:12.5px; font-weight:600; color:var(--ink-2); margin:0 0 5px; }
  .dlg-input { width:100%; font:inherit; font-size:14px; padding:10px 13px; border:1px solid var(--line-2);
    border-radius:var(--r-sm); background:var(--surface); color:var(--ink); margin:0 0 13px; }
  .dlg-input:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px var(--brand-wash); }
  .dlg-msg { font-size:13px; margin:0 0 12px; min-height:1.2em; }
  .dlg-msg.err { color:var(--crit); } .dlg-msg.ok { color:var(--good); }
  .dlg-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .dlg-row .spacer { margin-left:auto; }

  .sa-row { display:grid; grid-template-columns:auto 1fr auto; gap:3px 11px; align-items:center;
    padding:11px 14px; border-bottom:1px solid var(--line); font-size:14px; }
  .sa-row:last-child { border-bottom:0; }
  .sa-row.off { opacity:.55; }
  .sa-row input { width:16px; height:16px; accent-color:var(--brand); }
  .sa-name { font-weight:600; }
  .sa-mail { grid-column:2 / -1; font-size:12px; color:var(--ink-3); }
  .sa-mail.missing { color:var(--crit); }
  .sa-homes { font-size:12px; color:var(--ink-2); white-space:nowrap; }
  .sa-result { grid-column:2 / -1; font-size:12px; }
  .sa-result.sent { color:var(--good); }
  .sa-result.failed, .sa-result.skipped { color:var(--crit); }
  .busy { display:none; position:absolute; inset:0 0 13px 0; border-radius:var(--r-sm); z-index:5;
    background:color-mix(in srgb, var(--surface) 90%, transparent);
    flex-direction:column; align-items:center; justify-content:center; gap:8px; text-align:center; }
  .busy.on { display:flex; }
  .busy p { margin:0; font-weight:600; }
  .busy .busy-note { font-weight:400; font-size:12.5px; color:var(--ink-2); }
  .busy.done .spinner-sm { display:none; }
  .busy.done p:first-of-type { color:var(--good); font-size:18px; }
  .spinner-sm { width:26px; height:26px; border-radius:50%; border:3px solid var(--line);
    border-top-color:var(--brand); animation:spin .8s linear infinite; }

  @media print {
    .page > *:not(#screenReport), .rbar, .rnote, .overlay { display:none !important; }
    body { background:#fff; }
    .page { padding:0; max-width:none; }
    .paper { box-shadow:none; border:0; padding:0; max-width:none; }
  }
  @media (max-width:720px) {
    .page { padding:18px 15px 70px; }
    .head-actions { margin-left:0; width:100%; }
    .head h1 { font-size:23px; }
    .tab { flex:1 1 calc(50% - 6px); min-width:0; font-size:13.5px; padding:11px 10px; }
    .subtab { flex:1 1 calc(50% - 4px); }
    .grid { grid-template-columns:1fr; }
  }
  :focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
  @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
</style>
</head>
<body data-screen="vendors">

<svg style="display:none" aria-hidden="true">
  <symbol id="ic-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>
  <symbol id="ic-refresh" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></symbol>
  <symbol id="ic-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.7 8a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></symbol>
  <symbol id="ic-mail" viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6 9 6 9-6"/></symbol>
  <symbol id="ic-home" viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/></symbol>
  <symbol id="ic-pin" viewBox="0 0 24 24"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></symbol>
  <symbol id="ic-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></symbol>
  <symbol id="ic-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></symbol>
  <symbol id="ic-back" viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></symbol>
  <symbol id="ic-sort" viewBox="0 0 24 24"><path d="M7 4v16m0 0-3.5-3.5M7 20l3.5-3.5M17 20V4m0 0-3.5 3.5M17 4l3.5 3.5"/></symbol>
  <symbol id="ic-send" viewBox="0 0 24 24"><path d="M21.5 2.5 11 13"/><path d="M21.5 2.5 15 21l-4-8-8-4Z"/></symbol>
  <symbol id="ic-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
  <symbol id="ic-chev-r" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
  <symbol id="ic-doc" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></symbol>
</svg>

<div class="curtain" id="loading">
  <div><div class="spinner"></div><h2>Reading your boards</h2>
  <p>Loading every vendor, home and task from monday. This takes a few seconds the first time.</p></div>
</div>

<div class="curtain" id="error">
  <div><h2>Could not load the boards</h2>
  <p id="errMsg"></p>
  <button class="btn primary" onclick="location.reload()">Try again</button></div>
</div>

<div class="page">

  <!-- ============ VENDORS ============ -->
  <section id="screenVendors">
    <header class="head">
      <div>
        <h1>Vendor Reports</h1>
        <p>Dragon Transport &mdash; Customer Progress Reports</p>
      </div>
      <div class="head-actions">
        <button class="icon-btn" id="refreshBtn" title="Refresh board data" aria-label="Refresh board data"><svg class="i"><use href="#ic-refresh"/></svg></button>
        <button class="icon-btn" id="settingsBtn" title="Sending account" aria-label="Sending account"><svg class="i"><use href="#ic-gear"/></svg></button>
        <button class="btn primary" id="sendAllBtn"><svg class="i"><use href="#ic-send"/></svg>Send All Reports</button>
      </div>
    </header>

    <div class="search">
      <svg class="i"><use href="#ic-search"/></svg>
      <input id="q" type="search" placeholder="Search all vendors &mdash; name, home, address&hellip;" autocomplete="off">
    </div>

    <div class="filterbar">
      <label class="fpill"><svg class="i"><use href="#ic-cal"/></svg><select id="range"></select></label>
      <label class="fpill"><svg class="i"><use href="#ic-sort"/></svg><select id="sort">
        <option value="attention">Needs attention first</option>
        <option value="name">Name A&ndash;Z</option>
        <option value="homes">Most homes</option>
        <option value="sent">Longest since sent</option>
      </select></label>
      <span class="fnote" id="stamp"></span>
    </div>

    <nav class="tabs" id="tabs"></nav>
    <div class="grid" id="vendorGrid"></div>
    <p class="none" id="vendorNone" style="display:none"></p>
  </section>

  <!-- ============ VENDOR DETAIL ============ -->
  <section id="screenDetail">
    <button class="back" id="backToVendors"><svg class="i"><use href="#ic-back"/></svg>All vendors</button>
    <header class="head">
      <div>
        <h1 id="vName"></h1>
        <p id="vSub"></p>
      </div>
      <div class="head-actions">
        <button class="btn" id="createBtn"><svg class="i"><use href="#ic-doc"/></svg>Create report</button>
        <button class="btn primary" id="sendReportBtn"><svg class="i"><use href="#ic-send"/></svg>Send report</button>
      </div>
    </header>
    <div class="stats" id="stats"></div>
    <nav class="subtabs" id="homeTabs"></nav>
    <div class="grid" id="homeGrid"></div>
    <p class="none" id="homeNone" style="display:none"></p>
  </section>

  <!-- ============ REPORT ============ -->
  <section id="screenReport">
    <div class="rbar">
      <button class="btn" id="backBtn"><svg class="i"><use href="#ic-back"/></svg>Back</button>
      <span class="fnote" id="rLabel" style="margin-left:0"></span>
      <span class="spacer"></span>
      <button class="btn" id="copyBtn">Copy for email</button>
      <button class="btn" id="printBtn">Export as PDF</button>
      <button class="btn primary" id="sendBtn"><svg class="i"><use href="#ic-send"/></svg>Send report</button>
    </div>
    <div class="paper" id="paper"></div>
    <p class="rnote">Export as PDF opens your browser&rsquo;s print dialogue &mdash; choose &ldquo;Save as PDF&rdquo;. Copy for email puts the formatted report on your clipboard.</p>
  </section>

</div>

<!-- ============ DIALOGS ============ -->
<div class="overlay" id="settingsOverlay">
  <div class="dialog">
    <h2>Sending account</h2>
    <p class="dlg-sub">Reports are emailed through this Gmail account &mdash; exactly as if that person pressed Send. Use a Gmail <strong>App&nbsp;Password</strong> (Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App passwords), never the real account password.</p>
    <p class="dlg-status" id="settingsStatus"></p>
    <label class="dlg-label" for="setAddress">Gmail address</label>
    <input class="dlg-input" id="setAddress" type="email" placeholder="office@gmail.com" autocomplete="off">
    <label class="dlg-label" for="setPassword">App Password</label>
    <input class="dlg-input" id="setPassword" type="password" placeholder="16-character app password" autocomplete="off">
    <p class="dlg-msg" id="settingsMsg"></p>
    <div class="dlg-row">
      <button class="btn" id="settingsClose">Close</button>
      <span class="spacer"></span>
      <button class="btn" id="settingsDisconnect">Disconnect</button>
      <button class="btn" id="settingsTest">Send test</button>
      <button class="btn primary" id="settingsSave">Save &amp; verify</button>
    </div>
  </div>
</div>

<div class="overlay" id="sendAllOverlay">
  <div class="dialog" style="max-width:580px">
    <h2>Send all reports</h2>
    <p class="dlg-sub" id="sendAllSub"></p>
    <div style="position:relative">
      <div id="sendAllList" style="max-height:330px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;margin:0 0 13px"></div>
      <div class="busy" id="sendAllBusy">
        <div class="spinner-sm"></div>
        <p id="sendAllBusyText">Sending&hellip;</p>
        <p class="busy-note">Leave this window open &mdash; each vendor is sent one at a time.</p>
      </div>
    </div>
    <p class="dlg-msg" id="sendAllMsg"></p>
    <div class="dlg-row">
      <button class="btn" id="sendAllClose">Cancel</button>
      <span class="spacer"></span>
      <button class="btn primary" id="sendAllGo">Send selected</button>
    </div>
  </div>
</div>

<div class="overlay" id="sendOverlay">
  <div class="dialog">
    <h2 id="sendTitle">Send report</h2>
    <p class="dlg-sub" id="sendSub"></p>
    <label class="dlg-label" for="sendTo">To (separate several with ;)</label>
    <input class="dlg-input" id="sendTo" type="text" placeholder="name@dealership.com" autocomplete="off">
    <p class="dlg-msg" id="sendMsg"></p>
    <div class="dlg-row">
      <button class="btn" id="sendClose">Cancel</button>
      <span class="spacer"></span>
      <button class="btn primary" id="sendGo">Send</button>
    </div>
  </div>
</div>

<script src="/vendor/monday-sdk.js"></script>
<script src="/app.js?b=8"></script>
</body>
</html>
```


## `public/app.js`

```javascript
// Vendor Reporting Centre — frontend.
//
// Laid out to match the Job Manager app so the two read as one product:
// a searchable card grid with pill tabs, drilling into a vendor's homes as
// cards, then into the exportable report. Nothing is generated here; every
// value comes from the board data the backend computed.

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const icon = (n, cls = 'i') => `<svg class="${cls}"><use href="#ic-${n}"/></svg>`;

  const STATE = {
    complete: { label: 'Complete', pill: 'good' },
    active:   { label: 'On track', pill: '' },
    stalled:  { label: 'Stalled',  pill: 'crit' },
    unscoped: { label: 'Not scoped', pill: 'warn' },
  };

  let DATA = null;
  let current = null;          // selected vendor on the detail screen
  let range = 'this-week';
  let tab = 'all';             // vendor grid filter
  let homeTab = 'all';         // home filter inside a vendor
  let sort = 'attention';
  let query = '';

  // ---- talking to our backend --------------------------------------------
  async function sessionToken() {
    if (!window.mondaySdk) return null;
    try {
      const monday = window.mondaySdk();
      const res = await monday.get('sessionToken');
      return res?.data || null;
    } catch { return null; }
  }

  async function api(path, options = {}) {
    const token = await sessionToken();
    const res = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401) {
      throw new Error('This app has to be opened from inside monday.com — that is where it gets permission to read your boards.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ---- derived facts (all from board data, nothing invented) --------------
  const period = () => DATA.ranges.find((r) => r.key === range) || DATA.ranges[0];

  const dayNum = (ymd) => (ymd ? Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5 : null);

  function agoLabel(ymd) {
    const a = dayNum(ymd); const b = dayNum(DATA.today);
    if (a == null || b == null) return null;
    const n = b - a;
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    return `${n}d ago`;
  }

  /** Everything the vendor grid needs, computed once per render. */
  function vendorFacts(v) {
    const rep = v.reports[range];
    const jobs = rep.jobs;
    const live = jobs.filter((j) => j.state !== 'unscoped');
    const hasEmail = (v.recipients || []).length > 0;
    const sendable = live.length > 0;

    const done = live.reduce((n, j) => n + j.progress.done, 0);
    const total = live.reduce((n, j) => n + j.progress.total, 0);

    // soonest booked work across this vendor's homes, with the phase name
    let next = null;
    for (const j of jobs) {
      for (const p of j.pending) {
        if (p.date && (!next || p.date < next.date)) next = { date: p.date, name: p.name, home: j.name };
      }
    }

    const stalled = rep.counts.stalled || 0;
    const unscoped = rep.counts.unscoped || 0;
    const sentInPeriod = Boolean(v.lastSent && period().start && v.lastSent >= period().start);

    return {
      rep, jobs, hasEmail, sendable, stalled, unscoped, next, sentInPeriod,
      completed: rep.completedCount,
      progress: { done, total, pct: total ? Math.round((done / total) * 100) : 0 },
      attention: !hasEmail || stalled > 0 || unscoped > 0,
      ready: hasEmail && sendable,
    };
  }

  const TABS = [
    { key: 'all',       label: 'All Vendors',    test: () => true },
    { key: 'ready',     label: 'Ready to Send',  test: (f) => f.ready && !f.sentInPeriod },
    { key: 'attention', label: 'Needs Attention', test: (f) => f.attention },
    { key: 'sent',      label: 'Sent This Period', test: (f) => f.sentInPeriod },
  ];

  function matchesQuery(v) {
    if (!query) return true;
    const hay = [v.name, ...(v.recipients || []),
      ...v.reports[range].jobs.flatMap((j) => [j.name, j.address])].join(' ').toLowerCase();
    return hay.includes(query);
  }

  // ---- vendor grid --------------------------------------------------------
  function vendorCard(v, f) {
    const pill = !f.hasEmail ? '<span class="pill crit">No email</span>'
      : !f.sendable ? '<span class="pill grey">Nothing to report</span>'
      : f.sentInPeriod ? '<span class="pill good">Sent</span>'
      : '<span class="pill">Ready to send</span>';
    const extra = f.stalled ? `<span class="pill crit">${f.stalled} stalled</span>` : '';

    const mail = f.hasEmail
      ? `<p class="meta">${icon('mail')}<span>${esc(v.recipients.join('; '))}</span></p>`
      : `<p class="meta bad">${icon('mail')}<span>No Status Update Email on the board</span></p>`;

    const next = f.next
      ? `<div class="card-div"><p class="meta" style="margin:0">${icon('cal')}<span>
           <span class="next-l">Next: ${esc(f.next.name)}</span>
           <span class="next-s"> &middot; ${esc(f.next.home)} &middot; ${esc(dateLabel(f.next.date))}</span></span></p></div>`
      : '';

    const sent = v.lastSent
      ? `Report sent ${esc(agoLabel(v.lastSent))}${v.lastSentLabel ? ` &middot; ${esc(v.lastSentLabel)}` : ''}`
      : 'No report sent yet';

    return `<button class="card" data-vendor="${esc(v.id)}">
      <div class="card-top">
        <span class="card-name">${esc(v.name)}</span>
        <span class="chev" aria-hidden="true">${icon('chev-r')}</span>
      </div>
      <div class="card-pills">${pill}${extra}</div>
      ${mail}
      <p class="meta">${icon('home')}<span>${plural(v.homes, 'home')} &middot; ${plural(f.completed, 'task')} finished this period</span></p>
      ${f.sendable ? `
      <div class="prog-head"><span>Progress</span><span>${f.progress.done}/${f.progress.total} phases</span></div>
      <div class="bar${f.progress.pct >= 100 ? ' full' : ''}"><i style="width:${f.progress.pct}%"></i></div>` : ''}
      ${next}
      <div class="card-div card-foot">${icon('clock')}<span>${sent}</span></div>
    </button>`;
  }

  function dateLabel(ymd) {
    // the backend already formats the dates it exposes; this is for pending
    // entries, whose label lives in the status string
    const d = new Date(`${ymd}T12:00:00Z`);
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderTabs(facts) {
    $('tabs').innerHTML = TABS.map((t) => {
      const n = DATA.vendors.filter((v) => t.test(facts.get(v.id))).length;
      const badge = t.key === 'attention' && n ? ' badge' : '';
      return `<button class="tab" data-tab="${t.key}" aria-pressed="${t.key === tab}">
        ${t.label}<span class="n${badge}">${n}</span></button>`;
    }).join('');
    $('tabs').querySelectorAll('.tab').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; renderVendors(); };
    });
  }

  function renderVendors() {
    const facts = new Map(DATA.vendors.map((v) => [v.id, vendorFacts(v)]));
    renderTabs(facts);

    const t = TABS.find((x) => x.key === tab) || TABS[0];
    let list = DATA.vendors.filter((v) => t.test(facts.get(v.id)) && matchesQuery(v));

    const f = (v) => facts.get(v.id);
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'homes') return b.homes - a.homes || a.name.localeCompare(b.name);
      if (sort === 'sent') {
        const av = a.lastSent || '0000-00-00'; const bv = b.lastSent || '0000-00-00';
        return av.localeCompare(bv) || a.name.localeCompare(b.name);
      }
      // needs attention first, then most unsent, then name
      const score = (v) => (f(v).attention ? 0 : 1) * 10 + (f(v).sentInPeriod ? 1 : 0);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });

    $('vendorGrid').innerHTML = list.map((v) => vendorCard(v, f(v))).join('');
    $('vendorGrid').querySelectorAll('[data-vendor]').forEach((el) => {
      el.onclick = () => openVendor(el.dataset.vendor);
    });

    const none = $('vendorNone');
    none.style.display = list.length ? 'none' : '';
    none.textContent = query
      ? `No vendors match “${query}”.`
      : 'No vendors in this view.';
  }

  // ---- vendor detail ------------------------------------------------------
  const escNote = (t) => esc(t).replace(/\r?\n/g, '<br>');
  const noteBlock = (j) => j.note
    ? `<div class="vnote"><span class="vnote-h">A note from Dragon Transports</span>${escNote(j.note)}</div>`
    : '';

  function lists(j, emptyDoneText) {
    const done = j.completed.length
      ? `<div class="grp"><h4 class="done">${emptyDoneText ? 'Completed' : 'Finished this period'}</h4><ul>${
          j.completed.map((c) => `<li><span>${esc(c.name)}</span><em>${esc(c.dateLabel)}</em></li>`).join('')}</ul></div>`
      : `<div class="empty">${emptyDoneText || 'Nothing finished on this home in the selected period.'}</div>`;
    const todo = j.pending.length
      ? `<div class="grp"><h4>Still to do</h4><ul>${
          j.pending.map((p) => `<li><span>${esc(p.name)}</span><em class="${esc(p.tone)}-t">${esc(p.status)}</em></li>`).join('')}</ul></div>`
      : `<div class="empty">All scheduled work on this home is complete.</div>`;
    return done + todo;
  }

  const HOME_TABS = [
    { key: 'all',      label: 'All Homes', test: () => true },
    { key: 'active',   label: 'On Track',  test: (j) => j.state === 'active' },
    { key: 'stalled',  label: 'Stalled',   test: (j) => j.state === 'stalled' },
    { key: 'complete', label: 'Complete',  test: (j) => j.state === 'complete' },
    { key: 'unscoped', label: 'Not Scoped', test: (j) => j.state === 'unscoped' },
  ];

  function homeCard(j) {
    const s = STATE[j.state];
    const body = j.state === 'unscoped'
      ? `<div class="empty">No build phases are marked Yes on this job yet, so there is nothing to report. Set the phase columns in monday and it will fill in.</div>`
      : noteBlock(j) + lists(j);

    const next = j.nextScheduledLabel
      ? `<div class="card-div"><p class="meta" style="margin:0">${icon('cal')}<span class="next-l">Next up ${esc(j.nextScheduledLabel)}</span></p></div>`
      : '';

    return `<article class="card" data-home>
      <div class="card-top">
        <span class="card-name">${esc(j.name)}</span>
        <span class="chev" aria-hidden="true">${icon('chev')}</span>
      </div>
      <div class="card-pills"><span class="pill ${s.pill}">${s.label}</span></div>
      ${j.address ? `<p class="meta">${icon('pin')}<span>${esc(j.address)}</span></p>` : ''}
      ${j.state !== 'unscoped' ? `
      <div class="prog-head"><span>Progress</span><span>${j.progress.done}/${j.progress.total} phases</span></div>
      <div class="bar${j.progress.pct >= 100 ? ' full' : ''}"><i style="width:${Number(j.progress.pct) || 0}%"></i></div>` : ''}
      ${next}
      <div class="card-div card-foot">${icon('clock')}<span>${
        j.lastActivityLabel ? `Last finished ${esc(j.lastActivityLabel)}` : 'Nothing finished yet'}</span></div>
      <div class="home-body">${body}</div>
    </article>`;
  }

  function renderDetail() {
    const f = vendorFacts(current);
    const p = period();

    $('vName').textContent = current.name;
    $('vSub').textContent = [
      f.hasEmail ? current.recipients.join('; ') : 'No Status Update Email on the board',
      plural(current.homes, 'home'),
      current.lastSent ? `report sent ${agoLabel(current.lastSent)}` : 'no report sent yet',
      p.range,
    ].join('  ·  ');

    $('stats').innerHTML = [
      { n: current.homes, l: 'homes', c: '' },
      { n: f.completed, l: 'finished this period', c: f.completed ? 'good' : '' },
      { n: f.stalled, l: 'stalled', c: f.stalled ? 'crit' : '' },
      { n: f.unscoped, l: 'not scoped yet', c: f.unscoped ? 'warn' : '' },
    ].map((s) => `<div class="stat ${s.c}"><b>${s.n}</b><span>${s.l}</span></div>`).join('');

    const jobs = f.jobs;
    $('homeTabs').innerHTML = HOME_TABS.map((t) => {
      const n = jobs.filter(t.test).length;
      return `<button class="subtab" data-htab="${t.key}" aria-pressed="${t.key === homeTab}">
        ${t.label}<span class="n">${n}</span></button>`;
    }).join('');
    $('homeTabs').querySelectorAll('.subtab').forEach((b) => {
      b.onclick = () => { homeTab = b.dataset.htab; renderDetail(); };
    });

    const ht = HOME_TABS.find((x) => x.key === homeTab) || HOME_TABS[0];
    const order = { stalled: 0, unscoped: 1, active: 2, complete: 3 };
    const shown = jobs.filter(ht.test)
      .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

    $('homeGrid').innerHTML = shown.map(homeCard).join('');
    $('homeGrid').querySelectorAll('[data-home]').forEach((el) => {
      el.onclick = (e) => { if (!e.target.closest('a')) el.classList.toggle('open'); };
    });
    $('homeNone').style.display = shown.length ? 'none' : '';
    $('homeNone').textContent = 'No homes in this view.';

    $('rLabel').textContent = `${current.name} — ${p.range}`;
  }

  function openVendor(id) {
    current = DATA.vendors.find((v) => String(v.id) === String(id));
    if (!current) return;
    homeTab = 'all';
    renderDetail();
    document.body.dataset.screen = 'detail';
    window.scrollTo(0, 0);
  }

  // ---- the exportable report ---------------------------------------------
  function buildPaper() {
    const rep = current.reports[range];
    const p = period();
    // A home with no phases marked has nothing truthful to say to a customer.
    const shown = rep.jobs.filter((j) => j.state !== 'unscoped');
    const rows = shown.map((j) => `<div class="p-job"><h3>${esc(j.name)}</h3>
        ${j.address ? `<p class="p-addr">${esc(j.address)}</p>` : ''}
        <div class="p-prog"><span class="bar${j.progress.pct >= 100 ? ' full' : ''}"><i style="width:${Number(j.progress.pct) || 0}%"></i></span>
          <span class="frac">${j.progress.done} of ${j.progress.total} steps</span></div>
        ${noteBlock(j)}${lists(j, 'No tasks were completed on this home this period.')}</div>`).join('');

    const c = shown.reduce((a, j) => a + j.completed.length, 0);
    $('paper').innerHTML = `<h2 class="p-title">Progress Report from <span>Dragon Transports</span>!</h2>
      <p class="p-dates">${esc(current.name)} · ${esc(p.range)}</p>
      <p class="p-count"><strong>${plural(shown.length, 'home')}</strong> · ${plural(c, 'task')} completed this period</p>
      ${rows}
      <p class="p-foot">Questions on any home above? Reply to this email and we will get right back to you.</p>`;
  }

  // ---- wiring -------------------------------------------------------------
  function boot(data) {
    DATA = data;
    if (!DATA.vendors.length) {
      $('errMsg').textContent = 'No vendors have jobs linked to them yet. Fill in "Bill to" on the Jobs board and refresh.';
      document.body.className = 'errored';
      return;
    }
    $('range').innerHTML = DATA.ranges.map((r) =>
      `<option value="${esc(r.key)}"${r.key === range ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
    $('stamp').textContent = `Board data as of ${new Date().toLocaleTimeString()}`;
    document.body.className = '';
    if (current) current = DATA.vendors.find((v) => v.id === current.id) || null;
    renderVendors();
    if (current) renderDetail(); else document.body.dataset.screen = 'vendors';
  }

  async function load(refresh = false) {
    document.body.className = 'loading';
    try {
      boot(refresh ? await api('/api/refresh', { method: 'POST' }) : await api('/api/centre'));
    } catch (err) {
      $('errMsg').textContent = err.message;
      document.body.className = 'errored';
    }
  }

  // ---- email: settings dialog --------------------------------------------
  const msg = (id, text, cls) => { const el = $(id); el.textContent = text || ''; el.className = `dlg-msg ${cls || ''}`; };

  async function openSettings() {
    msg('settingsMsg', '');
    $('settingsOverlay').classList.add('open');
    $('settingsStatus').textContent = 'Checking…';
    try {
      const st = await api('/api/settings');
      $('settingsStatus').innerHTML = st.connected
        ? `Currently sending as <b>${esc(st.address)}</b>`
        : 'No sending account connected yet.';
      $('setAddress').value = st.address || '';
    } catch (err) {
      $('settingsStatus').textContent = err.message;
    }
    $('setPassword').value = '';
  }

  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = () => $('settingsOverlay').classList.remove('open');

  $('settingsSave').onclick = async () => {
    msg('settingsMsg', 'Verifying with Gmail…');
    try {
      const st = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: $('setAddress').value, appPassword: $('setPassword').value }),
      });
      msg('settingsMsg', 'Connected. Gmail accepted the sign-in.', 'ok');
      $('settingsStatus').innerHTML = `Currently sending as <b>${esc(st.address)}</b>`;
      $('setPassword').value = '';
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  $('settingsTest').onclick = async () => {
    msg('settingsMsg', 'Sending test email…');
    try {
      await api('/api/settings/test', { method: 'POST' });
      msg('settingsMsg', 'Test sent — check the inbox of the sending account.', 'ok');
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  $('settingsDisconnect').onclick = async () => {
    try {
      await api('/api/settings', { method: 'DELETE' });
      $('settingsStatus').textContent = 'No sending account connected yet.';
      $('setAddress').value = ''; $('setPassword').value = '';
      msg('settingsMsg', 'Disconnected.', 'ok');
    } catch (err) { msg('settingsMsg', err.message, 'err'); }
  };

  // ---- email: send one vendor --------------------------------------------
  const lastRecipients = {};

  function openSendDialog() {
    if (!current) return;
    $('sendTitle').textContent = `Send — ${current.name}`;
    $('sendSub').textContent = `${period().range}. The email is rebuilt from the boards on send; unscoped homes are left out.`;
    $('sendTo').value = lastRecipients[current.id] || (current.recipients || []).join('; ');
    msg('sendMsg', '');
    $('sendOverlay').classList.add('open');
    $('sendTo').focus();
  }
  $('sendBtn').onclick = openSendDialog;
  $('sendReportBtn').onclick = openSendDialog;
  $('sendClose').onclick = () => $('sendOverlay').classList.remove('open');

  $('sendGo').onclick = async () => {
    const btn = $('sendGo');
    btn.disabled = true;
    msg('sendMsg', 'Sending…');
    try {
      const out = await api('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: current.id, periodKey: range, to: $('sendTo').value }),
      });
      lastRecipients[current.id] = $('sendTo').value;
      msg('sendMsg', `Sent to ${out.to.join(', ')} from ${out.from}.`, 'ok');
      setTimeout(() => { $('sendOverlay').classList.remove('open'); load(); }, 1600);
    } catch (err) { msg('sendMsg', err.message, 'err'); }
    btn.disabled = false;
  };

  // ---- email: send all ----------------------------------------------------
  function sendAllRows() {
    return DATA.vendors.map((v) => {
      const f = vendorFacts(v);
      return { v, f, on: f.ready && !f.sentInPeriod };
    });
  }

  function renderSendAll(rows) {
    $('sendAllList').innerHTML = rows.map(({ v, f, on }) => `
      <label class="sa-row ${f.ready ? '' : 'off'}">
        <input type="checkbox" data-id="${esc(v.id)}" ${on ? 'checked' : ''} ${f.ready ? '' : 'disabled'}>
        <span class="sa-name">${esc(v.name)}</span>
        <span class="sa-homes">${plural(v.homes, 'home')}${v.lastSent ? ` · sent ${esc(agoLabel(v.lastSent))}` : ' · never sent'}</span>
        <span class="sa-mail ${f.hasEmail ? '' : 'missing'}">${
          f.hasEmail ? esc(v.recipients.join('; '))
          : !f.sendable ? 'nothing to report this period'
          : 'no Status Update Email on the Vendors board'}</span>
        <span class="sa-result" data-result="${esc(v.id)}"></span>
      </label>`).join('');
  }

  $('sendAllBtn').onclick = () => {
    $('sendAllSub').textContent = `${period().range}. Everyone below gets their own report, sent to the address on the Vendors board. Untick anyone who should sit this one out.`;
    renderSendAll(sendAllRows());
    msg('sendAllMsg', '');
    setBusy(false);
    $('sendAllOverlay').classList.add('open');
  };
  $('sendAllClose').onclick = () => $('sendAllOverlay').classList.remove('open');

  let sending = false;

  function setBusy(on, text) {
    const busy = $('sendAllBusy');
    busy.classList.toggle('on', on);
    busy.classList.remove('done');
    if (text) $('sendAllBusyText').innerHTML = text;
    $('sendAllGo').disabled = on;
    $('sendAllClose').disabled = on;
    if (on) $('sendAllList').querySelectorAll('input').forEach((el) => { el.disabled = true; });
  }

  $('sendAllGo').onclick = async () => {
    if (sending) return;
    const ids = [...$('sendAllList').querySelectorAll('input:checked')].map((el) => el.dataset.id);
    if (!ids.length) { msg('sendAllMsg', 'Nobody is selected.', 'err'); return; }
    sending = true;
    msg('sendAllMsg', '');
    setBusy(true, `Sending ${ids.length} report${ids.length === 1 ? '' : 's'}&hellip;`);
    try {
      const out = await api('/api/send-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodKey: range, vendorIds: ids }),
      });
      for (const r of out.results) {
        const el = $('sendAllList').querySelector(`[data-result="${r.vendorId}"]`);
        if (!el) continue;
        el.className = `sa-result ${r.status}`;
        el.textContent = r.status === 'sent' ? `sent to ${r.to.join('; ')}` : `${r.status}: ${r.error}`;
      }
      const t = out.tally;
      const busy = $('sendAllBusy');
      busy.classList.add('done');
      $('sendAllBusyText').textContent = t.failed
        ? `${t.sent || 0} sent, ${t.failed} failed`
        : `Completed — ${t.sent || 0} sent`;
      busy.querySelector('.busy-note').textContent = t.failed
        ? 'Some sends failed — details below.'
        : `All reports delivered from ${out.from}.`;
      if (t.failed) {
        setTimeout(() => { busy.classList.remove('on'); $('sendAllClose').disabled = false; }, 1600);
        msg('sendAllMsg', `${t.sent || 0} sent, ${t.skipped || 0} skipped, ${t.failed} FAILED — see each row above.`, 'err');
      } else {
        setTimeout(() => {
          $('sendAllOverlay').classList.remove('open');
          setBusy(false);
          load();
        }, 2000);
      }
    } catch (err) {
      setBusy(false);
      msg('sendAllMsg', err.message, 'err');
    }
    sending = false;
  };

  // ---- navigation + filters ----------------------------------------------
  $('backToVendors').onclick = () => { current = null; document.body.dataset.screen = 'vendors'; renderVendors(); window.scrollTo(0, 0); };
  $('backBtn').onclick = () => { document.body.dataset.screen = 'detail'; window.scrollTo(0, 0); };
  $('createBtn').onclick = () => { buildPaper(); document.body.dataset.screen = 'report'; window.scrollTo(0, 0); };
  $('refreshBtn').onclick = () => load(true);
  $('printBtn').onclick = () => window.print();

  $('range').onchange = (e) => {
    range = e.target.value;
    renderVendors();
    if (current) renderDetail();
  };
  $('sort').onchange = (e) => { sort = e.target.value; renderVendors(); };

  let qTimer = null;
  $('q').oninput = (e) => {
    clearTimeout(qTimer);
    const val = e.target.value.trim().toLowerCase();
    qTimer = setTimeout(() => { query = val; renderVendors(); }, 120);
  };

  $('copyBtn').onclick = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([$('paper').innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([$('paper').innerText], { type: 'text/plain' }),
      })]);
      $('copyBtn').textContent = 'Copied';
    } catch {
      const r = document.createRange(); r.selectNode($('paper'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      $('copyBtn').textContent = 'Selected — press Ctrl/Cmd+C';
    }
    setTimeout(() => { $('copyBtn').textContent = 'Copy for email'; }, 2600);
  };

  load();
})();
```


## `test/buildReport.test.js`

```javascript
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
```


## `test/renderEmail.test.js`

```javascript
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


test('the vendor note renders escaped with line breaks', () => {
  const withNote = { ...report, jobs: [{ ...report.jobs[0], note: 'Crew arrives <early>.\nCall first.' }] };
  const html = renderEmail(withNote, 'August 17-23, 2026');
  assert.ok(html.includes('A note from Dragon Transports'));
  assert.ok(html.includes('Crew arrives &lt;early&gt;.<br>Call first.'));
});

test('no note, no note block', () => {
  const html = renderEmail(report, 'August 17-23, 2026');
  assert.ok(!html.includes('A note from Dragon Transports'));
});
```


## `test/real-data.js`

```javascript
// A snapshot of real Dragon Transport board data (3 vendors, 14 homes), taken
// 2026-08-20. Used to drive the reporting-centre prototype without a token.
import { PHASES } from '../src/phases.js';

const K = { siteCheck:'Site Check', pad:'Pad', foundation:'Foundation', bw:'Break and Wrap',
  delivery:'Delivery', tie:'Tie Downs', setup:'Set Up', steps:'Steps', skirt:'Skirting',
  eserv:'Electric Service', ehook:'Electric Hookup', well:'Water Well', whook:'Water Hookup',
  sinst:'Septic Install', shook:'Septic Hookup', trim:'Trim Out' };
const byName = Object.fromEntries(PHASES.map((p) => [p.name, p]));
const scope = (keys) => Object.fromEntries(keys.map((k) => [byName[K[k]].scope, 'Yes']));
const rel = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [K[k], [].concat(v)]));

const j = (id, name, address, keys, tasks) =>
  ({ id, name, address, scope: scope(keys), taskIdsByPhase: rel(tasks) });

export const vendors = [
  { id:'11884347330', name:'Titan Midland' },
  { id:'12246117985', name:'Palm Harbor Homes Hobbs / Seminole' },
  { id:'12246182018', name:'Solitaire Homes Hobbs' },
];

export const jobsByVendor = {
  '11884347330': [
    j('11903188051','William Pierce','221 S Robertson Rd Loving, NM',
      ['pad','foundation','siteCheck','setup','skirt'],
      { foundation:'11905040706', skirt:'11904953566', pad:'11903322673',
        siteCheck:'11906715355', setup:'12237993627' }),
    j('11903188053','Robert Gonzales','2811 CR 349 Denver City, TX 79323',
      ['pad','siteCheck','delivery','bw','setup','skirt','steps'],
      { bw:'11906834935', steps:'11903338475', skirt:'11906943139', pad:'11903318125',
        siteCheck:'11904965362', delivery:'11906837297', setup:'11906837005' }),
    j('12425610879','Keyla Duran','2435 PR 200-G Seminole TX 79360',
      ['ehook','well','whook','sinst','shook'],
      { ehook:'12455845406', shook:'12455770907', sinst:'12455828454',
        whook:'12455843740', well:'12455770910' }),
    j('12592634253','Andrea Rojas','6417 S CR 1035 Stanton Tx',
      ['pad','setup','steps'],
      { steps:'12592642092', pad:'12592663417', setup:'12592635439' }),
    j('12825716587','Jacinto Menchava Segovia','183 CR 109 Seminole, TX 79360',
      ['pad','siteCheck','delivery','bw','setup','steps'],
      { bw:'12825742786', steps:'12825793917', pad:'12825756683',
        siteCheck:'12825767058', delivery:'12825754704', setup:'12825753977' }),
  ],
  '12246117985': [
    j('12676321308','Ulises Jaquez Frias','358 Fm 3306, Seminole Tx, 79360',
      ['pad','siteCheck','setup','well','sinst','steps'],
      { steps:'12679232508', sinst:'12679199776', pad:'12679190904',
        siteCheck:'12679200019', setup:'12679232757', well:'12679237839' }),
    j('12685498607','Hugo Ortiz','317 S East First Street Loving NM',
      ['pad','siteCheck','setup'],
      { pad:'12799454157', siteCheck:'12685584876', setup:'12685593847' }),
    j('12799397075','Liliana Camarillo González','1779 Pecos Hwy, Loving Nm., 88256',
      ['foundation','setup','eserv','whook','shook','skirt'],
      { foundation:['12799475211','12799475544','12799445373'], eserv:'12807454012',
        skirt:'12807509868', shook:'12807444581', whook:'12807500666', setup:'12799476949' }),
    j('12825819379','Jubencio Castillo','3235 W Trevino Rd. Hobbs Nm., 88240',
      ['siteCheck','setup','well','whook','sinst','shook'],
      { shook:'12825965815', sinst:'12825967674', whook:'12825967218',
        siteCheck:'12825921071', setup:'12825927518', well:'12825958578' }),
    j('12833734318','Jesus Munoz Ribota','1310 E Water Ave Lovington NM, 88240', [], {}),
  ],
  '12246182018': [
    j('12750669968','Michael Casares','1207 Pecan Ave Artesia NM, 88240', [], {}),
    j('12832309162','Shannon R Cummins','316 W Apache Dr', [], {}),
    j('12838116618','Cesar García Zubiate','30 Windy Ridge Rd, Artesia, NM 88210',
      ['siteCheck','setup','whook','sinst','shook','steps'],
      { steps:'12846775059', shook:'12846773911', sinst:'12846718417',
        whook:'12846741880', siteCheck:'12846695625', setup:'12846742188' }),
    j('12848192242','Lisa J Brininstool','TBD Hinson Rd, Lovington, NM 88260',
      ['siteCheck','setup','well','whook','sinst','shook'],
      { shook:'12848397934', sinst:'12848389365', whook:'12848395362',
        siteCheck:'12848388545', setup:'12848388546', well:'12848364749' }),
  ],
};

// [id, name, status, scheduleStart, finishedDate]
const T = [
  ['11903318125','Pad for Robert Gonzales','Not done',null,null],
  ['11903322673','Pad for William Pierce','Not done',null,null],
  ['11903338475','Steps for Robert Gonzales','Not done',null,null],
  ['11904953566','Skirting for William Pierce','Not done',null,null],
  ['11904965362','Site Check for Robert Gonzales','Not done',null,null],
  ['11905040706','Foundation for William Pierce','Done','2026-05-08','2026-06-11'],
  ['11906715355','Site Check for William Pierce','Done',null,'2026-06-11'],
  ['11906834935','Break & Wrap for Robert Gonzales','Not done',null,null],
  ['11906837005','Set Up for Robert Gonzales','Done',null,'2026-05-12'],
  ['11906837297','Delivery for Robert Gonzales','Not done',null,null],
  ['11906943139','Skirting for Robert Gonzales','Not done',null,null],
  ['12237993627','Set Up for William Pierce','Working on it','2026-06-09',null],
  ['12455770907','Septic Hookup for Keyla Duran','Done','2026-07-24','2026-08-03'],
  ['12455770910','Water Well for Keyla Duran','Working on it','2026-08-07',null],
  ['12455828454','Septic Install for Keyla Duran','Done',null,'2026-07-29'],
  ['12455843740','Water Hookup for Keyla Duran','Not done',null,null],
  ['12455845406','Electrical Service for Keyla Duran','Done','2026-07-29','2026-08-03'],
  ['12592635439','Set Up for Andrea Rojas','Done',null,'2026-07-29'],
  ['12592642092','Steps for Andrea Rojas','Done',null,'2026-07-29'],
  ['12592663417','Pad for Andrea Rojas','Done',null,'2026-07-29'],
  ['12825742786','Break & Wrap for Jacinto Menchava Segovia','Done','2026-08-08','2026-08-17'],
  ['12825753977','Set Up for Jacinto Menchava Segovia','Not done','2026-08-25',null],
  ['12825754704','Delivery for Jacinto Menchava Segovia','Done','2026-08-17','2026-08-17'],
  ['12825756683','Pad for Jacinto Menchava Segovia','Done','2026-08-17','2026-08-17'],
  ['12825767058','Site Check for Jacinto Menchava Segovia','Done','2026-07-17','2026-08-17'],
  ['12825793917','Steps for Jacinto Menchava Segovia','Not done','2026-08-25',null],
  ['12679190904','Pad for Ulises Jaquez Frias','Done','2026-07-31','2026-08-01'],
  ['12679199776','Septic Install for Ulises Jaquez Frias','Not done',null,null],
  ['12679200019','Site Check for Ulises Jaquez Frias','Done','2026-07-27','2026-08-01'],
  ['12679232508','Steps for Ulises Jaquez Frias','Not done',null,null],
  ['12679232757','Set Up for Ulises Jaquez Frias','Done','2026-07-31','2026-08-01'],
  ['12679237839','Water Well for Ulises Jaquez Frias','Not done',null,null],
  ['12685584876','Site Check for Hugo Ortiz','Done',null,'2026-07-31'],
  ['12685593847','Set Up for Hugo Ortiz','Working on it','2026-08-13',null],
  ['12799454157','Pad for Hugo Ortiz','Not done',null,null],
  ['12799445373','Foundation Prep+Forms for Liliana Camarillo González','Done',null,'2026-08-15'],
  ['12799475211','Remove Forms+Backfill for Liliana Camarillo González','Done',null,'2026-08-15'],
  ['12799475544','Pour concrete for Liliana Camarillo González','Done',null,'2026-08-15'],
  ['12799476949','Set Up for Liliana Camarillo González','Done',null,'2026-08-15'],
  ['12807444581','Septic Hookup for Liliana Camarillo González','Not done',null,null],
  ['12807454012','Electric Service for Liliana Camarillo González','Working on it',null,null],
  ['12807500666','Water Hookup for Liliana Camarillo González','Working on it','2026-08-19','2026-08-15'],
  ['12807509868','Skirting for Liliana Camarillo González','Not done',null,null],
  ['12825921071','Site Check for Jubencio Castillo','Done',null,'2026-08-18'],
  ['12825927518','Set Up for Jubencio Castillo','Done',null,'2026-08-18'],
  ['12825958578','Water Well for Jubencio Castillo','Not done',null,null],
  ['12825965815','Septic Hookup for Jubencio Castillo','Not done',null,null],
  ['12825967218','Water Hookup for Jubencio Castillo','Not done',null,null],
  ['12825967674','Septic Install for Jubencio Castillo','Done',null,'2026-08-18'],
  ['12846695625','Site Check for Cesar García Zubiate','Not done',null,null],
  ['12846718417','Septic Install for Cesar García Zubiate','Not done',null,null],
  ['12846741880','Water Hookup for Cesar García Zubiate','Not done',null,null],
  ['12846742188','Set Up for Cesar García Zubiate','Not done',null,null],
  ['12846773911','Septic Hookup for Cesar García Zubiate','Not done',null,null],
  ['12846775059','Steps for Cesar García Zubiate','Not done',null,null],
  ['12848364749','Water Well for Lisa J Brininstool','Not done',null,null],
  ['12848388545','Site Check for Lisa J Brininstool','Not done',null,null],
  ['12848388546','Set Up for Lisa J Brininstool','Not done',null,null],
  ['12848389365','Septic Install for Lisa J Brininstool','Not done',null,null],
  ['12848395362','Water Hookup for Lisa J Brininstool','Not done',null,null],
  ['12848397934','Septic Hookup for Lisa J Brininstool','Not done',null,null],
];

export const tasksById = new Map(T.map(([id, name, status, scheduleStart, finishedDate]) =>
  [id, { id, name, status, scheduleStart, finishedDate }]));
```


## `scripts/demo.js`

```javascript
// Local UI development server. Serves the real frontend against the recorded
// board snapshot in test/real-data.js, so the centre can be worked on without
// a monday token and without touching the account.
//
//   npm run demo   ->  http://localhost:8080
//
// This is a dev tool. It is not imported by src/ and never runs on monday-code.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { buildReport } from '../src/buildReport.js';
import { periodsFor } from '../src/centre.js';
import { formatDay, formatWeekRange } from '../src/week.js';
import { vendors, jobsByVendor, tasksById } from '../test/real-data.js';

const TODAY = process.env.DEMO_TODAY || '2026-08-20';

// Stand-ins for the Vendors board columns the snapshot does not carry, so the
// demo exercises the real states: connected, missing an address, already sent.
const DEMO_EMAIL = {
  '11884347330': ['mkeelin@titanfactorydirect.com'],
  '12246117985': ['orders@palmharbor-hobbs.com', 'service@palmharbor-hobbs.com'],
  '12246182018': [],
};
const DEMO_SENT = { '11884347330': '2026-08-14', '12246182018': '2026-08-18' };
const label = (d) => (d ? formatDay(d) : null);

function centre() {
  const periods = periodsFor(TODAY);
  return {
    today: TODAY,
    ranges: periods.map((p) => ({ key: p.key, label: p.label, range: formatWeekRange(p), start: p.start, end: p.end })),
    vendors: vendors.map((v) => {
      const reports = {};
      for (const p of periods) {
        const rep = buildReport({
          vendor: v, jobs: jobsByVendor[v.id], tasksById,
          week: { start: p.start, end: p.end }, today: TODAY,
        });
        for (const j of rep.jobs) {
          j.lastActivityLabel = label(j.lastActivity);
          j.nextScheduledLabel = label(j.nextScheduled);
        }
        reports[p.key] = rep;
      }
      const live = reports['this-week'];
      return {
        id: v.id, name: v.name, homes: live.activeHomes, counts: live.counts,
        recipients: DEMO_EMAIL[v.id] || [],
        lastSent: DEMO_SENT[v.id] || null,
        lastSentLabel: label(DEMO_SENT[v.id] || null),
        lastActivity: live.lastActivity, lastActivityLabel: label(live.lastActivity),
        nextScheduled: live.nextScheduled, nextScheduledLabel: label(live.nextScheduled),
        reports,
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    readiness: { note: 'demo snapshot' },
  };
}

const app = express();
app.get('/api/centre', (_req, res) => res.json(centre()));
app.post('/api/refresh', (_req, res) => res.json(centre()));
app.get('/vendor/monday-sdk.js', (_req, res) => res.type('js').send('window.mondaySdk=null;'));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`demo centre on http://localhost:${port}  (snapshot, today=${TODAY})`));
```


## `scripts/check.js`

```javascript
// Verifies that MONDAY_API_TOKEN works and prints what the centre will show.
// Read-only. Useful before deploying, and for diagnosing an empty vendor list.
//
//   MONDAY_API_TOKEN=xxx npm run check

import { config } from '../src/config.js';
import { loadCentre } from '../src/centre.js';

if (!config.mondayToken) {
  console.error('\n  Missing MONDAY_API_TOKEN.\n');
  console.error('  Get one at: monday.com -> your avatar -> Developers -> My Access Tokens');
  console.error('  Then run:   MONDAY_API_TOKEN=your_token_here npm run check\n');
  process.exit(1);
}

console.log('\nReading monday...');
const centre = await loadCentre();

console.log(`Report periods: ${centre.ranges.map((r) => r.label).join(', ')}\n`);
console.table(centre.vendors.map((v) => ({
  Vendor: v.name.slice(0, 34),
  Homes: v.homes,
  'Done this week': v.reports['this-week'].completedCount,
  Stalled: v.counts.stalled || 0,
  'Not scoped': v.counts.unscoped || 0,
})));

const r = centre.readiness;
console.log('\nData quality:');
console.log(`  ${r.jobsMissingVendor} of ${r.totalJobs} jobs have no "Bill to" vendor — they appear under no vendor.`);
console.log('');
```


---

_End of handoff. Generated 2026-11-02 from branch `claude/vendor-reports-app-design-xs0s9w`, commit `01d6236`._
