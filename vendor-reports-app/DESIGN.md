# Vendor Reports App — Design & Implementation Spec

**Client:** Dragon Transport (monday account `dragontransportss-team`)
**Workspace:** Dragon Transport (`13706443`)
**Goal:** A reporting centre where the office can see any vendor's activity at a glance and
export a progress report to send them manually — so vendors stop calling for status.

---

## 1. Recommendation in one paragraph

A **monday-code hosted app** — Node backend + React frontend — surfaced in the workspace as a
**Custom Object**, the same deployment shape as the QBO job sync project. It is a **reporting
centre**: pick a vendor, see every home they have with us at a glance, and press **Create
report** to produce a progress report for a chosen date range. The office **exports it as a PDF
or copies it into an email and sends it themselves**. No automatic sending, no email provider,
no scheduler, no sending domain. The report is a fixed template over **column values only** —
no AI, no Updates, no notes.

## 2. Architecture

```
              monday-code (Node, 512 MiB, 1 vCPU)
   ┌──────────────────────────────────────────────────┐
   │  GET  /api/centre        ┐                       │
   │  POST /api/refresh       ├─ Object feature UI    │
   │  GET  /  (static)        ┘   (plain HTML/JS)     │
   │        │                                         │
   │        ▼                                         │
   │   loadReportData()  ── monday GraphQL ──▶ Jobs   │
   │        │                                  Tasks  │
   │        ▼                                 Vendors │
   │   buildReport()     ── pure function, zero AI    │
   └──────────────────────────────────────────────────┘
                          │
                          ▼
              Browser renders · user presses
              Export as PDF (print) or Copy for email
```

### Why this shape

| Decision | Rationale |
| --- | --- |
| **monday-code** | Same stack and deploy path as QBO job sync. `mapps code:push`, secrets, logging already familiar. |
| **Custom Object** app feature | Renders full-screen from the left pane, independent of any board — a reporting centre, not a board tab. |
| **Export in the browser, not on the server** | `window.print()` → "Save as PDF" needs no library. Server-side PDF (headless Chrome) would not fit comfortably in 512 MiB, and would add a dependency for something the browser already does well. |
| **Copy for email** | Puts the formatted report on the clipboard as rich text, ready to paste into Gmail or Outlook. This is the fastest manual-send path and needs no email infrastructure at all. |
| **No stored state** | Nothing is scheduled, nothing is sent, so there is nothing to record. No Storage, no idempotency keys, no send log. |
| **No build step** | The UI is plain HTML and JS served from `public/`. No React, no bundler, no toolchain to keep working — which matters when the person maintaining this is not a full-time developer. |
| **One load, cached 60s** | A single pass over the boards builds every vendor and every period, so clicking between vendors is instant and monday is not hammered. |

### What the rescope removed

Dropping automatic sending removed the entire delivery half of the system: the cron scheduler,
the transactional email provider, the sending domain with SPF/DKIM (which was the longest-lead
item in the whole project), idempotency keying, the send log, the paused/enabled flag, and the
readiness gate that existed to stop a robot mailing something misleading. A human now looks at
every report before it goes out, which is a stronger guarantee than any of it.

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

### Phases that link several tasks

A phase normally maps to one task. Some map to several — Liliana Camarillo González's
Foundation links *Foundation Prep+Forms*, *Pour concrete* and *Remove Forms+Backfill*. Rules:

- The phase counts as **one** step in the progress bar, complete only when **every** linked
  task is complete.
- A single-task phase is labelled with the **phase name**. A multi-task phase lists **each task
  under its own name**, with the trailing `" for {home}"` stripped, since those are real steps
  the customer can follow.

### Home states

The centre needs to tell four situations apart. Resolved in this order:

| State | Meaning |
| --- | --- |
| `unscoped` | No phase is marked Yes. Nothing truthful to report — excluded from the report, shown in the centre. |
| `complete` | Every in-scope phase is done. |
| `stalled` | Nothing running, nothing booked, and nothing finished in 21 days. **This is the home the vendor phones about.** |
| `active` | Everything else. |

`stalled` is shown in the centre only. It is an internal prompt to go do something, not a
sentence to put in front of a customer.

### Header counts
`{N} active homes · {N} tasks completed this week` — both computed, both plain integers.

### Everything else is static template text
Greeting, footer, and the contact line are constants in the template. There is no per-vendor
or per-job prose anywhere.

---

## 6. What changes in monday

**Nothing.** No new boards and no new columns.

The three Vendors columns the earlier design needed — Report Recipients, Weekly Report,
Last Report Sent — only existed to serve automatic sending. With a person exporting and
sending from their own mail client, none of them are required.

## 7. The reporting centre

One screen, three states.

**Vendor rail.** Every vendor with active jobs, with a dot against any that has a home needing
attention. Sorted by name.

**Vendor overview.** The summary before the detail:

- Four counts — homes, tasks finished this period, stalled, not scoped yet.
- A row per home, sorted **stalled → not scoped → on track → complete**, so the ones that
  generate phone calls sit at the top. Each row carries a state stripe, a progress meter,
  when work last finished, and what is booked next.
- Clicking a row expands it to the same two lists the report uses.

**Report.** Pick a period, press Create report, get the exact document the vendor will see.
Two ways out: **Export as PDF** (the browser's print dialogue) and **Copy for email** (rich
text on the clipboard). Homes in the `unscoped` state are **left out of the report** — a home
with no phases marked Yet has nothing truthful to say — while still showing in the centre so
the office can fix it.

## 8. Data quality — what limits the output

Measured against live account data on 2026-08-20. None of this blocks building or using the
centre; it limits how good the reports are. Since a person reviews every report before sending,
none of it can any longer cause a customer to receive something wrong.

| # | Finding | Effect |
| --- | --- | --- |
| 1 | **~70 of the active jobs have no "Bill to" vendor** | Those homes appear under no vendor in the centre. The single biggest limit on usefulness. |
| 2 | **Duplicate vendor records** — Solitaire four ways, Palm Harbor three, Titan several | One dealership's homes split across several entries in the vendor rail. |
| 3 | **Some jobs have no phase columns set at all** — Michael Casares, Shannon R Cummins, Jesus Munoz Ribota | They render as `unscoped`: visible in the centre, excluded from reports. |
| 4 | **Only 112 of 576 tasks have a Schedule** | Most "Still to do" lines read `Not yet scheduled`, which is the weakest version of the report. |
| 5 | **Two `*Site Checks` relation columns on Jobs** (`board_relation_mm2q8sc1`, `board_relation_mm33z95n`) | Site Check double-counts. Delete one. |
| 6 | **Only 24 of 576 tasks have Pictures** | Not enough to build on. Out of scope. |

The centre surfaces #1–#3 as it goes: a vendor with an unscoped home shows an amber count, and
jobs with no vendor simply never appear — so the office can work the list down over time
rather than treating it as a project.

## 9. Export

`window.print()` with a print stylesheet that hides the app chrome and prints only the report.
The user picks "Save as PDF" in their own print dialogue.

"Copy for email" writes both `text/html` and `text/plain` to the clipboard via the async
Clipboard API, falling back to selecting the report node so Ctrl/Cmd+C works if the browser
refuses programmatic clipboard writes.

## 10. Build path

1. Delete the duplicate `*Site Checks` relation column on Jobs.
2. Scaffold the monday-code app; register the Custom Object feature; `mapps code:push`.
3. Build the React centre against the existing endpoints. `buildReport()` and the template are
   already written and tested.
4. Point it at live data, click through every vendor, and fix what reads wrong.
5. Use it. Data cleanup (§8) improves the output continuously and blocks nothing.

## 11. Open decisions

- **Report periods offered.** Currently this week / last week / last 30 days. A custom range
  picker is easy to add if the office wants one.
- **Which homes appear.** Active Jobs, plus homes completed in the last 14 days so a finished
  home visibly lands rather than silently disappearing.
- **Stalled threshold.** 21 days with nothing finished, nothing running and nothing booked.
  Worth tuning once the office sees which homes it flags.
- **Terminology.** The board says "Vendor". In the report itself, use the dealership's own
  name and no category noun at all.
