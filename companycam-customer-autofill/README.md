# CompanyCam Customer Autofill (Dragon Transports)

A monday code service. When the native monday → CompanyCam integration creates a project, this service fills in the project's **Customer** using the matching monday Jobs item. It reuses an existing customer when the phone or email matches, and creates one only when nothing matches.

**It ships in dry run (`DRY_RUN` unset or anything other than `false`).** In dry run it logs what it would do and writes nothing to CompanyCam.

## How it works

`POST /webhooks/companycam` receives the CompanyCam `project.created` webhook.

1. It verifies `X-CompanyCam-Signature` = Base64(HMAC-SHA1(webhook token, raw body)) and returns 401 if the signature is bad. Otherwise it returns 200 right away and does the work after replying.
2. It re-fetches the project and stops unless `creator_id == 4362847` (projects the integration created). It also skips archived projects.
3. It stops if the project already has a customer.
4. It looks on Jobs board `18409503078` for items whose name equals the project name (trimmed, whitespace collapsed, case-insensitive). It needs exactly one match; otherwise it skips and logs.
5. It reads phone (`phone_mm2kg9m6`) and email (`email_mm5swnng`) from the item and normalizes the phone: 10 digits → `+1…`, 11 digits starting with 1 → `+…`. Any other phone is treated as invalid.
6. It looks for an existing customer: first by the phone's last 10 digits (so it matches both E.164 numbers and legacy bare 10-digit numbers, on the customer or any of its contacts), then by exact email. If more than one customer matches, it skips and logs that a person needs to look.
7. If nothing matches, it creates a customer with the item's name, phone and email, plus one contact with the same three fields. If the item has neither a valid phone nor an email, it skips.
8. Just before writing, it checks the project's customer again, then links the customer (`PUT /projects/{id}/customer`).
9. It records every outcome in monday code secure storage (newest 300 entries) and on the console.

`POST /mndy-cronjob/nightly-sweep` is the nightly sweep. It pages projects newest first, back 14 days, and runs steps 2–9 on each one created by the integration user, one at a time. CompanyCam calls are throttled to about 270 per minute and retried on 429/5xx.

Duplicate deliveries are handled three ways: an in-process lock per project, a `done_<projectId>` marker after a successful link, and the customer-already-set check. If a create succeeds but the link fails, the retry finds the new customer by phone and links it.

| Outcome | Meaning |
|---|---|
| `would-link-existing` / `would-create-and-link` | Dry run: what it would have done |
| `linked-existing` / `created-and-linked` | It wrote to CompanyCam |
| `skipped` | Includes a `reason` |
| `error` | Includes the error message; the nightly sweep retries it |

## Config

Secrets are set with `mapps code:secret`. Type them into your own terminal; never put them in chat or git.

| Key | |
|---|---|
| `COMPANYCAM_API_TOKEN` | CompanyCam access token with customers read/write and projects read |
| `MONDAY_API_TOKEN` | monday API token that can read the Jobs board |
| `COMPANYCAM_WEBHOOK_TOKEN` | A random string you make up. It is the HMAC signing token for the webhook |
| `LOG_VIEW_TOKEN` | Optional. Turns on `GET /log?token=…`. Without it, `/log` returns 404 and you read logs in Developer Center |

Env vars are set with `mapps code:env`:

| Key | Default | |
|---|---|---|
| `DRY_RUN` | `true` | Set to `false` to allow writes. It is read on each run |
| `TEST_NAME_FILTER` | unset | Optional safety gate: only projects whose name contains this text are processed (e.g. `XANDER TEST`) |
| `SWEEP_DAYS` | `14` | |
| `COMPANYCAM_BASE_URL` | `https://api.companycam.com/public_api/v1` | |

## Deploy

```bash
npm install -g @mondaycom/apps-cli
mapps init                       # paste your monday developer token when prompted
cd companycam-customer-autofill
npm test
mapps code:push                  # pick the app + draft version
mapps code:env -m set -k DRY_RUN -v true
mapps code:secret -m set -k COMPANYCAM_API_TOKEN -v '<paste>'
mapps code:secret -m set -k MONDAY_API_TOKEN -v '<paste>'
mapps code:secret -m set -k COMPANYCAM_WEBHOOK_TOKEN -v "$(openssl rand -hex 32 | tee /dev/tty)"   # keep the value for the webhook step
```

Promote the version to live (scheduled jobs only run on live). Then add the nightly job. Cron is in UTC: `0 8 * * *` is 2 am CST, or 3 am during CDT.

```bash
mapps scheduler:create -a <APP_ID> -z us -n nightly-sweep -e nightly-sweep -s "0 8 * * *" -t 300 -r 1 -d "CompanyCam customer autofill sweep"
```

## Register the webhook (needs Xander's OK; this is a CompanyCam write)

`<BASE>` is the monday code URL from Developer Center. The `token` must equal `COMPANYCAM_WEBHOOK_TOKEN`.

```bash
curl -sS -X POST https://api.companycam.com/public_api/v1/webhooks \
  -H "Authorization: Bearer $COMPANYCAM_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"webhook":{"url":"<BASE>/webhooks/companycam","scopes":["project.created"],"token":"<COMPANYCAM_WEBHOOK_TOKEN>"}}'
```

To check deliveries: `GET /public_api/v1/webhooks/{id}/deliveries`, or the `list_webhook_deliveries` tool in the CompanyCam MCP.

## Test notes

- Test project `117093871` already has customer `350012` (Xander Harms, +14322096579), so the service will skip it.
- A new test item that uses `+14322096579` or `xander@formulaxconsulting.com` will link to an existing customer instead of creating one. To test the create path, give the first test item a phone and email that are not in CompanyCam. Then a second item with the same phone should reuse that customer.
- The sweep looks at every integration-created project from the last 14 days. Projects fixed by hand already have a customer and are skipped. Any that still have no customer will be filled in once `DRY_RUN=false`. Set `TEST_NAME_FILTER` during testing to prevent that.

## API references (checked 2026-11-10)

- CompanyCam OpenAPI: `developers.companycam.com/openapi/public_api_v1.yaml`. Customers: `GET/POST /customers`. Project customer: `GET/PUT /projects/{project_id}/customer`. Webhooks: `POST/PATCH /webhooks`.
- The CompanyCam changelog shows webhook payloads as `{event_type, created_at, payload: {project: {...}}}`, with epoch-second timestamps and string ids. The service only uses `payload.project.id` and re-fetches the project.
- monday code scheduler: POST to `/mndy-cronjob/<endpoint>`.
