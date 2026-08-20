# Vendor Reports App — Design & Implementation Spec

**Client:** Dragon Transport (monday account `dragontransportss-team`)
**Workspace:** Dragon Transport (`13706443`)
**Goal:** Send each vendor a weekly progress report on their homes, so they stop calling for status.

---

## 1. Recommendation in one paragraph

Build **Vendor Reports** as a **monday Vibe app, variant `object`**, in the Dragon Transport
workspace alongside the four apps already running there (Job Manager, Crew, Driver,
Estimates/Invoices). It reads Vendors + Jobs + Tasks live, computes a per-vendor weekly
digest, renders it as an HTML email, and sends it through Vibe's Gmail/Outlook integration
after a human clicks Send. It adds **no new boards** and **three columns** to one existing
board. The weekly report is a *computed view*, never stored data.

---

## 2. Why this shape

| Option | Verdict |
| --- | --- |
| **Vibe app, `object` variant** | **Chosen.** Appears in the workspace as its own object, exactly like their existing apps. Zero infra, zero hosting, zero OAuth, no app-review. The team already knows how to maintain these. |
| Board view on Vendors | Rejected. Cramped inside a board, and the team asked for a workspace-level object. |
| External Next.js app + monday apps framework | Rejected for v1. Buys true unattended scheduling, but costs hosting, OAuth, marketplace review and ongoing ops — for 17 recipients. Revisit only if unattended send becomes a hard requirement (see §8). |
| Pure monday automations | Rejected. An automation can template column values; it cannot compute "what changed this week." |

### Two Vibe platform limits that shaped the design

Verified against monday's Vibe FAQ:

1. **No scheduled or background jobs.** A Vibe app runs only while someone is looking at it.
   → The weekly send is **human-triggered**, not unattended. See §6.
2. **No external API integrations** (Gmail/Outlook email is a supported built-in; arbitrary
   third-party APIs are not).

And one delivery limit from monday's Gmail integration docs:

3. **Files in a File column send as a URL, not an attachment — and non-account-members
   cannot open them.** → **No PDF attachments.** The report must be **HTML in the email
   body**. This is better anyway: vendors read it on a phone without opening anything.
   (monday emails also cap at 256 KB, which HTML-in-body comfortably fits.)

---

## 3. The data that already exists

| Board | ID | Items | Role |
| --- | --- | --- | --- |
| Vendors | `18409503080` | 166 | The customers. `deal_contact` → Jobs. Billing email in `contact_email`. |
| Jobs | `18409503078` | 141 | One item per home. Named for the homeowner. `deal_contact` → Vendors ("Bill to"). |
| Tasks | `18409523534` | 576 | The unit of work. Status, Schedule, Finished Date, Crew, Pictures. Links back to a Job through one relation column per phase. |

### The phase model — the core idea

A Job carries 16 optional phases. Each has a `…?` status column saying whether it is
**in scope** for this home, and a board-relation column pointing at the Task that does it.
Scope × task status gives an honest **"7 of 11 steps complete"** — one number replacing
sixteen scattered columns. This is the single most valuable thing the app computes.

| Phase | Job scope column (`Yes`/`No`) | Job → Task relation | Task → Job relation |
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

⚠ The Jobs board has **two** `*Site Checks` relation columns (`board_relation_mm2q8sc1`
and `board_relation_mm33z95n`). Pick one and delete the other before building, or the
Site Check phase will double-count.

### Task columns the report reads

| Column | ID | Use |
| --- | --- | --- |
| Status | `color_mm2v7xnr` | `Not done` / `Working on it` / `Waiting` / `Done` / `Invoiced` |
| Schedule | `timerange_mm2wxekj` | Drives "coming next week" |
| Finished Date | `date_mm35m8t7` | Drives "completed this week" |
| Assigned Crew | `person` | Internal only — do **not** put crew names in a vendor email |
| Pictures | `file_mm3he3gf` | Include when present |

Treat both `Done` and `Invoiced` as complete. `Invoiced` is a billing state, not a work state —
83 tasks sit there and would otherwise read as unfinished to the vendor.

---

## 4. What changes in monday

**No new boards.** Three columns on **Vendors**:

| Column | Type | Purpose |
| --- | --- | --- |
| Report Recipients | text | Semicolon-separated addresses. monday's Gmail integration sends to each address in a `;`-separated text column — this handles "send to the sales manager *and* the office." |
| Weekly Report | status | `On` / `Paused`. Which vendors are in the weekly run. |
| Last Report Sent | date | Stamped by the app on send. |

**Sent history** goes in the **Update feed on the Vendor item** — the app posts the exact HTML
it sent. Free, native, searchable, and it answers "what did we tell them last week?" when a
vendor calls back. A dedicated Vendor Reports log board would add filterable send-status
reporting; it is not worth a new board at 17 recipients. Add it later if reporting-on-reporting
is ever wanted.

---

## 5. What the report says

Per vendor, one section per **active** job billed to them:

- Homeowner name, job address
- **Progress: N of M steps**, plus the current stage
- ✅ **Completed this week** — tasks with Finished Date inside the week, or moved to Done/Invoiced
- 🔧 **Happening now** — tasks at Working on it
- 📅 **Coming next week** — tasks whose Schedule overlaps next week
- ⏳ **Waiting on** — tasks at Waiting, with the reason
- Photos when present

Plus a header line — *"6 active homes · 3 milestones completed this week"* — and one optional
free-text note the coordinator can type before sending.

**Voice rules.** No crew names, no subcontractor names, no prices, no internal task IDs. Dates
as "Tue Aug 18," not ISO. A phase with no movement says nothing rather than "no update" —
silence beats filler. If a job had zero activity all week, say so plainly with the next
scheduled date; that is the reassurance the vendor is calling for.

---

## 6. The weekly send flow

1. **Fri 8:00am** — a monday recurring automation notifies the office coordinator.
2. Coordinator opens **Vendor Reports**. It lists every `Weekly Report = On` vendor with a
   readiness dot (green = ready, amber = missing email or has unassigned jobs).
3. Click a vendor → the rendered report → optionally type a note → **Send**.
4. **Send all ready** handles the happy path in one click.
5. On send the app emails the HTML, posts it as an Update on the Vendor item, and stamps
   Last Report Sent.

Human-in-the-loop is a deliberate choice, not a workaround for the platform limit. A
proactive customer email should get a glance before it goes out — especially while the data
gaps in §7 are still being closed. Budget ~10 minutes a week for all 17 vendors.

---

## 7. Blockers — fix these or the reports will be wrong

Measured against live data on 2026-08-20. These are prerequisites, not nice-to-haves.

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| 1 | **80 of 141 jobs have no "Bill to" vendor** (only 61 linked) | Those homes appear in **no** report. A vendor gets a report missing half their homes — worse than no report. | Backfill `deal_contact`. Highest priority. |
| 2 | **Duplicate vendor records** — Solitaire appears as `Soltaire Homes`, `Solitaire Homes Hobbs`, `Solitaire  Homes Of Hobbs`, `Solitare Roswell`; Titan as `Titan Midland` and `Titan Factory Direct Midland`; Palm Harbor three ways | One dealership gets two partial reports, or the one with jobs has no email while the one with the email has no jobs. | Merge to one record per dealership location. |
| 3 | **6 of the 17 active vendors have no email** — including Titan Midland (14 jobs) and Palm Harbor Homes (7 jobs) | Cannot send at all. | Collect addresses. |
| 4 | **Only 112 of 576 tasks have a Schedule** | "Coming next week" will be mostly empty — the section vendors most want. | Crews need to set Schedule when work is booked. |
| 5 | **Only 24 of 576 tasks have Pictures** | Photos can't anchor v1. | Include opportunistically; push photo capture through the Crew App over time. |

The app should ship with a **Readiness** tab surfacing #1–#3 as a live worklist ("12 jobs
missing a vendor," "3 vendors missing an email") rather than treating cleanup as a one-time
project. That is cheap to build and it is what keeps the reports trustworthy after month one.

---

## 8. Explicitly out of scope for v1

No PDF generation. No vendor login or portal. No photo galleries or lightboxes. No per-vendor
branding. No editing schedules from inside the report. No vendor replies routed back into
monday. No unattended sending.

**Unattended sending** is the one item with a real upgrade path: it needs a scheduler, which
means leaving Vibe for a monday-code app or an external cron hitting the monday API. Revisit
after the team has run the human-approved loop for a month and trusts the output — not before.

---

## 9. Build path

1. Clean up blockers #2 and #3 (dedupe vendors, collect emails) — needed to test with real sends.
2. Delete the duplicate `*Site Checks` relation column on Jobs.
3. Add the three Vendors columns from §4.
4. `vibe_create` with variant `object`, connected to boards `18409503080`, `18409503078`,
   `18409523534`. Prompt covers: the phase table from §3, the report layout from §5, the
   voice rules, and the Readiness tab.
5. Iterate in the Vibe editor against one real vendor — Titan Midland, 14 jobs, the hardest case.
6. Dry run: generate all 17, send only to `xander@formulaxconsulting.com`.
7. Pilot two friendly vendors for two weeks. Then turn on the rest.
8. Backfill blocker #1 through the Readiness tab as an ongoing habit.

---

## 10. Open decisions

- **Send day.** Friday afternoon (week just finished, "here's next week") or Monday morning
  (fresh week ahead)? Friday is the better fit for the reassurance goal.
- **Which contact.** Billing email is often accounts-payable, not the person chasing status.
  Report Recipients exists so these can differ — but someone has to gather them.
- **Active-only, or include recently completed?** Recommend including jobs completed in the
  last 14 days, marked Complete, so the vendor sees the finish rather than the home silently
  vanishing from the report.
- **Terminology.** The board says "Vendor." If these emails go to dealerships, the word in the
  email body should probably be the dealership's own name and nothing else — sidestepping
  vendor-vs-customer entirely.
