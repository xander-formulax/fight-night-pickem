import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadCentre } from './centre.js';
import { verifySessionToken } from './auth.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

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

const api = express.Router();
api.use(verifySessionToken);

api.get('/centre', async (_req, res, next) => {
  try { res.json(await centre()); } catch (err) { next(err); }
});

api.post('/refresh', async (_req, res, next) => {
  try { cache = null; res.json(await centre()); } catch (err) { next(err); }
});

app.use('/api', api);

// The monday client SDK, served from our own origin rather than a CDN.
app.get('/vendor/monday-sdk.js', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../node_modules/monday-sdk-js/dist/main.js', import.meta.url))));

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => console.log(`vendor reporting centre on ${config.port}`));
