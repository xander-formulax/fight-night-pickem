import { SecureStorage } from '@mondaycom/apps-sdk';

// Outcome log + dedupe markers in monday code secure storage (local mock store when run off monday code).
// Secure storage allows ~7 req/s per app, so every call goes through one throttled queue and log
// entries are buffered and written in batches.
const LOG_KEY = 'autofill_log_v1';
const LOG_MAX = 300;
const MIN_GAP_MS = 400; // <= 2.5 storage calls/s, leaves headroom under the 7 rps limit
const FLUSH_DELAY_MS = 2000;

export function createStore(storage = new SecureStorage(), { minGapMs = MIN_GAP_MS, flushDelayMs = FLUSH_DELAY_MS } = {}) {
  let queue = Promise.resolve();
  let lastCall = 0;

  // Serialize and space out every storage call; retry once on rate-limit errors.
  function call(fn) {
    const run = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = Math.max(0, lastCall + minGapMs - Date.now());
        if (wait) await new Promise((r) => setTimeout(r, wait));
        lastCall = Date.now();
        try {
          return await fn();
        } catch (e) {
          if (attempt < 2 && /limit/i.test(e?.message || '')) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  let pending = [];
  let flushTimer = null;
  let flushing = Promise.resolve();

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!pending.length) return flushing;
    const batch = pending;
    pending = [];
    flushing = flushing.then(async () => {
      try {
        const log = (await call(() => storage.get(LOG_KEY))) || [];
        await call(() => storage.set(LOG_KEY, [...batch.reverse(), ...log].slice(0, LOG_MAX)));
      } catch (e) {
        console.error(`[autofill] log write failed (${batch.length} entries, still in console): ${e.message}`);
      }
    });
    return flushing;
  }

  return {
    /** Console immediately; storage in batches. `persist:false` = console only (noise like test-filter skips). */
    append(entry, { persist = true } = {}) {
      const line = { at: new Date().toISOString(), ...entry };
      console.log(`[autofill] ${JSON.stringify(line)}`);
      if (!persist) return Promise.resolve();
      pending.push(line);
      if (!flushTimer) flushTimer = setTimeout(flush, flushDelayMs);
      return Promise.resolve();
    },

    flush,

    async readLog() {
      await flush();
      return (await call(() => storage.get(LOG_KEY))) || [];
    },

    async isDone(projectId) {
      try { return Boolean(await call(() => storage.get(`done_${projectId}`))); } catch { return false; }
    },

    async markDone(projectId, outcome) {
      try {
        await call(() => storage.set(`done_${projectId}`, { outcome, at: new Date().toISOString() }));
      } catch (e) {
        console.error(`[autofill] markDone failed: ${e.message}`);
      }
    },
  };
}

/** In-memory store for tests. */
export function memoryStorage() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    set: async (k, v) => { m.set(k, structuredClone(v)); return true; },
    delete: async (k) => m.delete(k),
  };
}
