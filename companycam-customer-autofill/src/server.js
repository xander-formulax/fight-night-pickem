import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { secret, settings } from './config.js';
import { createCompanyCam } from './companycam.js';
import { createMonday } from './monday.js';
import { createStore } from './store.js';
import { processProject, sweep } from './autofill.js';

/** X-CompanyCam-Signature = Base64(HMAC-SHA1(webhook token, raw body)). */
export function verifySignature(rawBody, header, token) {
  if (!header || !token) return false;
  const expected = crypto.createHmac('sha1', token).update(rawBody).digest();
  let given;
  try { given = Buffer.from(String(header).trim(), 'base64'); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Pull the project id out of a project.created delivery. Tolerates a few envelope shapes. */
export function parseEvent(json) {
  const type = json?.event_type || json?.event || json?.type || null;
  const p = json?.payload?.project || json?.project || json?.data?.project || null;
  return { type, projectId: p?.id ? String(p.id) : null, project: p };
}

let store;
const getStore = () => (store ??= createStore());

function deps() {
  return {
    cc: createCompanyCam({ token: secret('COMPANYCAM_API_TOKEN'), baseUrl: settings.companycamBaseUrl() }),
    monday: createMonday({ token: secret('MONDAY_API_TOKEN') }),
    store: getStore(),
    cfg: {
      dryRun: settings.dryRun(),
      creatorId: settings.integrationCreatorId(),
      boardId: settings.mondayBoardId(),
      phoneColumn: settings.mondayPhoneColumn(),
      emailColumn: settings.mondayEmailColumn(),
      testNameFilter: settings.testNameFilter(),
    },
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

let sweepRunning = false;
let lastSweepAt = 0;

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return send(res, 200, { ok: true, dryRun: settings.dryRun() });
  }

  // CompanyCam webhook (scope: project.created)
  if (req.method === 'POST' && url.pathname === '/webhooks/companycam') {
    const raw = await readBody(req);
    if (!verifySignature(raw, req.headers['x-companycam-signature'], secret('COMPANYCAM_WEBHOOK_TOKEN'))) {
      console.warn('[autofill] rejected webhook: bad or missing signature');
      return send(res, 401, { error: 'invalid signature' });
    }
    let json;
    try { json = JSON.parse(raw.toString('utf8')); } catch { return send(res, 200, { ignored: 'unparseable body' }); }
    const { type, projectId } = parseEvent(json);
    send(res, 200, { received: true }); // ack first; work continues below
    if (type !== 'project.created' || !projectId) {
      console.log(`[autofill] ignored event type=${type} project=${projectId}`);
      return;
    }
    // Always re-fetch the project rather than trusting payload fields (creator_id may be absent/trimmed).
    Promise.resolve()
      .then(() => processProject(projectId, { source: 'webhook' }, deps()))
      .catch((e) => getStore().append({ source: 'webhook', projectId, outcome: 'error', reason: e.message }));
    return;
  }

  // monday code scheduler (mapps scheduler:create -e nightly-sweep)
  if (req.method === 'POST' && url.pathname === '/mndy-cronjob/nightly-sweep') {
    await readBody(req).catch(() => null);
    if (sweepRunning) return send(res, 200, { skipped: 'sweep already running' });
    if (Date.now() - lastSweepAt < 10 * 60_000) return send(res, 200, { skipped: 'swept <10 min ago' });
    sweepRunning = true;
    lastSweepAt = Date.now();
    try {
      const summary = await sweep(deps(), { days: settings.sweepDays() });
      console.log(`[autofill] sweep done ${JSON.stringify(summary)}`);
      return send(res, 200, summary);
    } catch (e) {
      console.error(`[autofill] sweep failed: ${e.stack || e}`);
      return send(res, 500, { error: e.message });
    } finally {
      sweepRunning = false;
    }
  }

  // Read-only outcome log. Disabled unless LOG_VIEW_TOKEN secret is set (log contains customer phone/email).
  if (req.method === 'GET' && url.pathname === '/log') {
    const viewToken = secret('LOG_VIEW_TOKEN');
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    if (!viewToken || !safeEqual(given, viewToken)) return send(res, 404, { error: 'not found' });
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 300);
    return send(res, 200, { dryRun: settings.dryRun(), entries: (await getStore().readLog()).slice(0, limit) });
  }

  return send(res, 404, { error: 'not found' });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(`[autofill] request failed: ${e.stack || e}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => console.log(`[autofill] listening on ${port}, DRY_RUN=${settings.dryRun()}`));
}
