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
| `src/index.js` | Express server + the `/mndy-cronjob` endpoint |

## Running locally

```bash
npm install
npm test                 # the rules, as tests
node test/preview.js     # renders sample-email.html from a fixture, sends nothing
npm start
```

Nothing can be sent by accident: `EMAIL_DRIVER` defaults to `console`, and the
run refuses to start without `MONDAY_API_TOKEN`.

## Configuration

Set on monday-code with `mapps code:secret`, or as env vars locally.

| Key | Purpose |
| --- | --- |
| `MONDAY_API_TOKEN` | API token for reading boards and writing Last Report Sent |
| `MONDAY_SIGNING_SECRET` | App signing secret, for verifying session tokens |
| `EMAIL_API_KEY` | Provider API key |
| `OFFICE_PHONE` | Shown in the email footer |
| `COMPLETED_GRACE_DAYS` | How long a finished home keeps appearing (default 14) |
| `VENDOR_ENABLED_COLUMN` | Vendors column id — see below |

### No monday changes required

The earlier auto-sending design needed three columns on Vendors. Manual export needs none.

## Deploying

```bash
mapps code:push
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
