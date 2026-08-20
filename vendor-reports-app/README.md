# Dragon Vendor Reports

A monday-code app that emails each dealership a weekly progress report on their
homes, so they stop calling for status updates.

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
| `EMAIL_DRIVER` | `console` (default), `postmark`, or `resend` |
| `EMAIL_API_KEY` | Provider API key |
| `EMAIL_FROM` | Sending address — needs SPF/DKIM on a real domain |
| `REDIRECT_ALL_EMAIL_TO` | Redirects every send to one address. Use for dry runs. |
| `OFFICE_PHONE` | Shown in the email footer |
| `COMPLETED_GRACE_DAYS` | How long a finished home keeps appearing (default 14) |
| `VENDOR_RECIPIENTS_COLUMN` | Vendors column id — see below |
| `VENDOR_ENABLED_COLUMN` | Vendors column id — see below |
| `VENDOR_LAST_SENT_COLUMN` | Vendors column id — see below |

### Three columns to add on Vendors

These do not exist yet. Create them, then set the ids above. Until they exist,
no vendor is enabled and nothing sends.

| Column | Type | Purpose |
| --- | --- | --- |
| Report Recipients | text | Semicolon-separated. Separate from Billing Email, which is usually accounts-payable. |
| Weekly Report | status | `On` / `Paused` |
| Last Report Sent | date | Written back after each send |

## Deploying

```bash
mapps code:push
mapps scheduler:create -a APP_ID -s "0 20 * * 5" -u "weekly-reports" \
  -n "weekly-vendor-reports" -z us -r 3 -t 300
```

Cron is **UTC** and does not follow US daylight saving: `0 20 * * 5` is Friday
3:00 PM Central in summer and 2:00 PM in winter.

Test with `mapps scheduler:run` before putting a real schedule on it. Set the
schedule far in the future first so it cannot fire on its own while you check.

## Before going live

1. **80 of 141 jobs have no "Bill to" vendor** — those homes appear in no report.
2. **6 of 17 active vendors have no email**, including Titan Midland (14 jobs).
3. **Duplicate vendor records** — Solitaire exists four ways, Palm Harbor three.
4. **Delete the duplicate `*Site Checks` relation column on Jobs**
   (`board_relation_mm2q8sc1` and `board_relation_mm33z95n` share a title) or
   Site Check double-counts in every report.

`GET /api/week` returns these as a live worklist.
