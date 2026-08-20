# Vendor Reports App — Design & Implementation Spec

**Client:** Dragon Transport (monday account `dragontransportss-team`)
**Workspace:** Dragon Transport (`13706443`)
**Goal:** Automatically send each vendor a weekly progress report on their homes, so they stop calling for status.

---

## 1. Recommendation in one paragraph

A **monday-code hosted app** — Node backend + React frontend — surfaced in the workspace as a
**Custom Object** (full-page, left-pane, not tied to any board), same deployment shape as the
QBO job sync project. A **monday-code scheduled cron job** fires every Friday, builds each
vendor's report from **structured column values only**, renders it through a **fixed HTML
template**, and emails it via a transactional email provider. No AI, no free-text, no Updates,
no notes. The report is a pure function of board data.

---

## 2. Architecture

```
                    monday-code (Node, 512 MiB, 1 vCPU)
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   │  POST /mndy-cronjob/weekly-reports   ← monday scheduler   │
   │         │                              (cron, UTC)        │
   │         ▼                                                 │
   │   buildWeek(vendor)  ── monday GraphQL ──▶ Vendors/Jobs/  │
   │         │                                   Tasks boards  │
   │         ▼                                                 │
   │   renderTemplate()   ── fixed HTML, zero AI               │
   │         │                                                 │
   │         ▼                                                 │
   │   sendEmail()        ── outbound (static IP) ──▶ Postmark │
   │         │                                                 │
   │         ▼                                                 │
   │   Storage.set()      ── send history + idempotency        │
   │                                                          │
   │  GET  /api/vendors            ┐                          │
   │  GET  /api/report/:id         ├─ Custom Object UI (React) │
   │  POST /api/report/:id/send    ┘   session-token auth      │
   └──────────────────────────────────────────────────────────┘
```

### Why this shape

| Decision | Rationale |
| --- | --- |
| **monday-code** | Same stack and deploy path as QBO job sync. `mapps code:push`, secrets, storage, logging and monitoring all already familiar. |
| **Custom Object** app feature | Renders full-screen from the left pane, independent of any board — the "its own thing in the workspace" feel. (Board view would trap it inside Vendors; dashboard widget is too small.) |
| **monday-code scheduler** | Native cron. Up to 5 jobs per region. This is what makes the send genuinely unattended — the app does not need to be open. |
| **External email provider** | Postmark/SendGrid/Resend. Real HTML email with real deliverability. Avoids monday's 256 KB email cap and its File-column-links-that-external-recipients-cannot-open problem. |
| **Storage for history** | Send history lives in monday-code Storage and is shown in the app UI. No new boards, and nothing written to Updates. |

### monday-code limits that matter here

- 1 vCPU / 512 MiB RAM, 300 s request timeout, max 10 instances per region.
- Scheduler: **5 jobs per region**; cron expressions are **UTC**.
- Storage: 256-char keys, 6 MB per key, 12 req/s per token.
- Secrets are **write-only** — you cannot read them back after creation.
- Outbound traffic leaves from a **static IP range**, so the email provider can allowlist it.

At 17 vendors and ~140 jobs, a full weekly run is a handful of GraphQL calls and well inside
one request timeout. No queue needed.

---

## 3. No AI. No Updates. No notes.

Explicit constraints on this build:

- **Nothing is generated.** Every sentence in the email comes from a fixed template with
  column values interpolated into it. The same board state always produces byte-identical HTML.
- **Updates and notes are never read.** They are internal-only. The app touches Vendors, Jobs
  and Tasks **columns** and nothing else.
- **Updates and notes are never written.** Send history goes to monday-code Storage.
- No LLM API calls, no AI credits, no summarisation, no rephrasing.

The only free text that can ever reach a vendor is a job name, an address, and a task name —
all typed by the office, all already visible on the board.

---

## 4. The data

| Board | ID | Items | Role |
| --- | --- | --- | --- |
| Vendors | `18409503080` | 166 | The customers. `contact_deal` → Jobs. |
| Jobs | `18409503078` | 141 | One item per home, named for the homeowner. `deal_contact` → Vendors ("Bill to"). |
| Tasks | `18409523534` | 576 | The work. Status, Schedule, Finished Date. Links to a Job via one relation per phase. |

### The phase model

A Job carries up to 16 optional phases. Each has a `…?` column saying whether it is **in scope**
for this home, and a relation column pointing at the Task that performs it. Scope drives the
denominator of the progress bar; task status drives the numerator.

| Phase | Scope column (`Yes`/`No`) | Job → Task | Task → Job |
| --- | --- | --- | --- |
| Site Check | `color_mm2qm6zb` | `board_relation_mm2q8sc1` ⚠ | `board_relation_mm2qkn1` |
| Pad | `color_mm2k7s99` | `board_relation_mm2m2958` | `board_relation_mm2mgk2m` |
| Foundation | `color_mm2qs16d` | `board_relation_mm2qtwjy` | `board_relation_mm2qqhy6` |
| Break and Wrap | `color_mm2qtpcz` | `board_relation_mm2qgcwy` | `board_relation_mm2q2p9w` |
| Delivery | `color_mm2k79p8` | `board_relation_mm2m6y9s` | `board_relation_mm2mhvf` |
| Tie Downs | `color_mm66xtqf` | `board_relation_mm665mqd` | `board_relation_mm66q0eb` |
| Set Up | `color_mm2kyeav` | `board_relation_mm2ms4mb` | `board_relation_mm2mfp9r` |
| Steps | `color_mm2p7ksn` | `board_relation_mm2tkzqz` | `board_relation_mm2tr88` |
| Skirting | `color_mm2q5cjc` | `board_relation_mm2qg0cj` | `board_relation_mm2q7gx5` |
| Electric Service | `color_mm2q2npg` | `board_relation_mm2qgtf4` | `board_relation_mm2qmy5r` |
| Electric Hookup | `color_mm2mtqf1` | `board_relation_mm2vbqvw` | `board_relation_mm2v7hxr` |
| Water Well | `color_mm2nt68q` | `board_relation_mm2nfkr9` | `board_relation_mm2nf5tr` |
| Water Hookup | `color_mm2qy1ht` | `board_relation_mm2qdf8f` | `board_relation_mm2qpy4j` |
| Septic Install | `color_mm2q78hf` | `board_relation_mm2qm8xv` | `board_relation_mm2qkw17` |
| Septic Hookup | `color_mm2qa62q` | `board_relation_mm2q32n9` | `board_relation_mm2qpg4s` |
| Trim Out | `color_mm2qqrab` | `board_relation_mm2qxtvf` | `board_relation_mm2qhre0` |

⚠ Jobs has **two** `*Site Checks` relation columns (`board_relation_mm2q8sc1`,
`board_relation_mm33z95n`). Delete one before building or Site Check double-counts.

### Task columns read

### Job columns read

| Column | ID |
| --- | --- |
| Job Address | `text_mm4bqpy1` |
| Bill to (→ Vendors) | `deal_contact` |
| Job Finish Date | `date_mm45gy0s` |

Groups: `topics` = Active Jobs, `closed` = Completed, `group_mm31702c` = Bids.

### Task columns read

| Column | ID | Use |
| --- | --- | --- |
| Status | `color_mm2v7xnr` | `Not done` / `Working on it` / `Waiting` / `Done` / `Invoiced` |
| Schedule | `timerange_mm2wxekj` | The scheduled date shown next to a pending task |
| Finished Date | `date_mm35m8t7` | Decides what counts as "completed this week" |
| Pictures | `file_mm3he3gf` | Ignored in v1 (only 24 of 576 populated) |

**Assigned Crew and Subcontractors are never read.** Vendors do not see who did the work.

---

## 5. The report — deterministic rules

Report week = **Monday 00:00 → Sunday 23:59** in America/Chicago, the week just ending.

### Which jobs appear
Jobs where `deal_contact` = this vendor **and** the job is in the `Active Jobs` group, plus
jobs moved to `Completed` whose Job Finish Date falls in the last 14 days (so a finished home
visibly lands rather than silently disappearing).

### Progress bar
- **Denominator** = count of phases where the scope column is `Yes`.
- **Numerator** = count of those phases whose linked Task status is `Done` **or** `Invoiced`.
- Rendered as `N of M steps` plus a bar at `N/M`.

> `Invoiced` counts as complete. It is a billing state, not a work state — 83 tasks sit there
> today and would otherwise read to the vendor as unfinished work.

### Section A — Completed this week
Every in-scope task whose **Finished Date falls inside the report week**.
Line format, fixed: `{Phase name} — {Day, Mon D}`

> The **phase name**, not the task name, is the customer-facing label. It is always
> present (even where no task exists yet) and avoids leaking whatever internal
> naming convention the office uses on Tasks.

If the list is empty the section is replaced by exactly one templated line:
`No tasks were completed on this home this week.`

### Section B — Still to do
Every in-scope phase whose task is not `Done`/`Invoiced`, **including phases with no linked
task at all** (which render from the phase name). Each line gets exactly one status suffix,
resolved in this order:

| Condition | Suffix |
| --- | --- |
| Task status = `Working on it` | `In progress` |
| Task status = `Waiting` | `On hold` |
| Schedule start date is set | `Scheduled {Day, Mon D}` |
| otherwise | `Not yet scheduled` |

Sorted by how immediate the work is — **in progress, then booked (soonest first), then on
hold, then not yet booked** — with build order breaking ties. Work happening right now is
what the vendor most wants to see, so it leads; unscheduled work sinks to the bottom.

If the list is empty the section is replaced by exactly one templated line:
`All scheduled work on this home is complete.`

### Header counts
`{N} active homes · {N} tasks completed this week` — both computed, both plain integers.

### Everything else is static template text
Greeting, footer, and the contact line are constants in the template. There is no per-vendor
or per-job prose anywhere.

---

## 6. What changes in monday

**No new boards.** Three columns on **Vendors**:

| Column | Type | Purpose |
| --- | --- | --- |
| Report Recipients | text | Semicolon-separated addresses. Distinct from billing email, which is usually accounts-payable. |
| Weekly Report | status | `On` / `Paused` — which vendors are in the run. |
| Last Report Sent | date | Written back by the cron job so the office can see it without opening the app. |

---

## 7. The app UI (Custom Object)

The scheduled job does the sending; the UI exists for oversight, not for operating the send.

1. **This week** — every vendor in the run, its computed report, and send state (queued / sent / failed / paused).
2. **Preview** — the exact HTML for any vendor and week, before or after it goes out.
3. **Readiness** — the live worklist from §8: jobs with no vendor, vendors with no email, duplicate vendors.
4. **History** — what was sent, when, to whom, read from Storage.
5. **Send now** / **Skip this week** — manual overrides on a single vendor.

---

## 8. Blockers — fix these or the reports will be wrong

Measured against live data on 2026-08-20.

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| 1 | **80 of 141 jobs have no "Bill to" vendor** (61 linked) | Those homes appear in **no** report. A vendor gets a report missing half their homes — worse than no report. | Backfill `deal_contact`. Highest priority. |
| 2 | **Duplicate vendor records** — Solitaire as `Soltaire Homes` / `Solitaire Homes Hobbs` / `Solitaire  Homes Of Hobbs` / `Solitare Roswell`; Titan as `Titan Midland` and `Titan Factory Direct Midland`; Palm Harbor three ways | One dealership gets two partial reports, or the record holding the jobs has no email while the one with the email has no jobs. | Merge to one record per dealership location. |
| 3 | **6 of the 17 active vendors have no email** — including Titan Midland (14 jobs) and Palm Harbor Homes (7 jobs) | Cannot send at all. | Collect addresses into Report Recipients. |
| 4 | **Only 112 of 576 tasks have a Schedule** | Most "Still to do" lines will read `Not yet scheduled`, which is the weakest version of the report. | Crews set Schedule when work is booked. |
| 5 | **Only 24 of 576 tasks have Pictures** | Not enough to build on. | Out of scope for v1. |

The **Readiness tab** surfaces #1–#3 as a live worklist so cleanup is a weekly habit rather
than a one-time project that decays by month two. The cron job **refuses to send** to any
vendor failing readiness, and lists it as skipped rather than sending something misleading.

---

## 9. Scheduling detail

Register with the CLI:

```bash
mapps scheduler:create -a APP_ID \
  -s "0 20 * * 5" \
  -u "weekly-reports" \
  -n "weekly-vendor-reports" \
  -z us -r 3 -t 300
```

Cron is **UTC**. `0 20 * * 5` is Friday 3:00 PM Central during CDT and 2:00 PM during CST —
the schedule does not follow US daylight saving. Either accept the one-hour winter shift or
have the handler no-op unless local time is within the intended window.

The handler must be **idempotent**: key each send `{vendorId}:{weekStart}` in Storage and
skip anything already sent, so a scheduler retry cannot double-send to a customer.

Test with `mapps scheduler:run` before putting a real cron on it.

---

## 10. Build path

1. Clean blockers #2 and #3 — dedupe vendors, collect emails.
2. Delete the duplicate `*Site Checks` relation column on Jobs.
3. Add the three Vendors columns from §6.
4. Scaffold the monday-code app; register the Custom Object feature; `mapps code:push`.
5. Build `buildWeek()` + the HTML template. Golden-file test it: fixed board fixture in,
   byte-identical HTML out.
6. Wire the email provider; store the API key with `mapps code:secret`.
7. Dry run: generate all 17, send only to `xander@formulaxconsulting.com`.
8. Register the cron far in the future, verify with `mapps scheduler:run`, then set the real schedule.
9. Pilot two vendors for two weeks, then turn on the rest.
10. Backfill blocker #1 through the Readiness tab as an ongoing habit.

---

## 11. Open decisions

- **Send time.** Friday afternoon (week just closed, next week visible) vs Monday morning.
  Friday fits the reassurance goal better.
- **Email provider.** Postmark has the best transactional deliverability; Resend is the
  simplest API. Either works — needs a decision so the domain's SPF/DKIM can be set up early.
- **Sending domain.** Sending as `dragon.transports@gmail.com` will hurt deliverability and
  land in spam at volume. Recommend a real domain with SPF/DKIM before the pilot.
- **Recently completed homes.** Recommend including for 14 days after the Job Finish Date.
- **Terminology.** The board says "Vendor." In the email body, use the dealership's own name
  and no category noun at all.
