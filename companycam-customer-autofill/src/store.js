import { SecureStorage } from '@mondaycom/apps-sdk';

// Outcome log + dedupe markers in monday code secure storage (local mock store when run off monday code).
const LOG_KEY = 'autofill_log_v1';
const LOG_MAX = 300;

export function createStore(storage = new SecureStorage()) {
  let chain = Promise.resolve(); // serialize log writes within this instance

  return {
    async append(entry) {
      const line = { at: new Date().toISOString(), ...entry };
      console.log(`[autofill] ${JSON.stringify(line)}`);
      chain = chain.then(async () => {
        try {
          const log = (await storage.get(LOG_KEY)) || [];
          log.unshift(line);
          await storage.set(LOG_KEY, log.slice(0, LOG_MAX));
        } catch (e) {
          console.error(`[autofill] log write failed: ${e.message}`);
        }
      });
      return chain;
    },

    async readLog() {
      await chain;
      return (await storage.get(LOG_KEY)) || [];
    },

    async isDone(projectId) {
      try { return Boolean(await storage.get(`done_${projectId}`)); } catch { return false; }
    },

    async markDone(projectId, outcome) {
      try { await storage.set(`done_${projectId}`, { outcome, at: new Date().toISOString() }); } catch (e) {
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
