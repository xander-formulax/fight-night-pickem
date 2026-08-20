# Dragon Vendor Reports

A monday-code app: a reporting centre where the office can see any dealership's
activity at a glance and export a progress report to send them manually.

**The report is a fixed template over column values.** Nothing is generated, no
AI is involved, and Updates and notes are never read or written — those are
internal. The same board state always produces byte-identical HTML, which is why
`test/buildReport.test.js` can pin the rules down.

See [DESIGN.md](./DESIGN.md) for the full spec and [brief.html](./brief.html)
for the shareable version.

## Layout

| Path | What it is |
| --- | --- |
| `src/phases.js` | The 16 build phases and their monday column ids |
| `src/week.js` | Report-week boundaries in America/Chicago |
| `src/buildReport.js` | **The core.** Pure function: board state → report object |
| `src/renderEmail.js` | Report object → email-safe HTML |
| `src/monday.js` | GraphQL reads (columns only, never Updates) |
| `src/readiness.js` | The gate that refuses to send a misleading report |
| `src/run.js` | One weekly run: build, gate, send, record |
| `src/centre.js` | One load: every vendor, every period |
| `src/index.js` | Express server, API, and static frontend |
| `public/` | The reporting centre UI. No build step — plain HTML and JS. |
| `scripts/demo.js` | Runs the UI against a recorded snapshot, no token needed |

## Running locally

```bash
npm install
npm test                 # the rules, as tests
npm run demo             # the UI on a recorded snapshot — no token needed
npm start                # the real thing — needs MONDAY_API_TOKEN
```

Nothing can be sent by accident — the app has no send path at all. It reads
boards, renders reports, and the user exports them.

## Configuration

Set on monday-code with `mapps code:secret`, or as env vars locally.

| Key | Purpose |
| --- | --- |
| `MONDAY_API_TOKEN` | Reads the boards. Required. |
| `MONDAY_SIGNING_SECRET` | Verifies that requests came from monday. Required. |
| `COMPLETED_GRACE_DAYS` | How long a finished home keeps appearing (default 14) |
| `PORT` | Set by monday-code automatically |

### No monday changes required

The earlier auto-sending design needed three columns on Vendors. Manual export needs none.

## Deploying

See [DEPLOY.md](./DEPLOY.md) for the full walkthrough. Once set up:

```bash
mapps code:push -i <APP_VERSION_ID>
```

## Data quality notes

None of these block using the centre; they limit how good the reports are.

1. **~70 active jobs have no "Bill to" vendor** — those homes appear under no vendor.
2. **Duplicate vendor records** — Solitaire exists four ways, Palm Harbor three.
3. **Some jobs have no phase columns set** — they show as "not scoped" and are excluded
   from reports until someone marks the phases.
4. **Delete the duplicate `*Site Checks` relation column on Jobs**
   (`board_relation_mm2q8sc1` and `board_relation_mm33z95n` share a title) or Site Check
   double-counts.
