// Minimal CompanyCam Public API v1 client (https://api.companycam.com/public_api/v1).
// Paths confirmed from the OpenAPI spec at developers.companycam.com/openapi/public_api_v1.yaml (2026-11-10).

const MIN_INTERVAL_MS = 220; // ~270 req/min, under the ~300/min limit
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export class CompanyCamError extends Error {
  constructor(status, body, path) {
    super(`CompanyCam ${status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 600));
    this.status = status;
    this.body = body;
  }
}

export function createCompanyCam({ token, baseUrl, fetchImpl = fetch }) {
  if (!token) throw new Error('COMPANYCAM_API_TOKEN is not set');

  async function request(method, path, { query, body } = {}) {
    const url = new URL(baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      await throttle();
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }

      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < 3) {
        const ra = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, (Number.isFinite(ra) && ra > 0 ? ra : 5 * (attempt + 1)) * 1000));
        continue;
      }
      if (!res.ok) throw new CompanyCamError(res.status, json, `${method} ${url.pathname}`);
      return json;
    }
  }

  const data = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r);

  return {
    async getProject(id) {
      return data(await request('GET', `/projects/${encodeURIComponent(id)}`));
    },

    /** Returns the linked customer, or null when none (API returns 404 or data:null). */
    async getProjectCustomer(projectId) {
      try {
        return data(await request('GET', `/projects/${encodeURIComponent(projectId)}/customer`)) || null;
      } catch (e) {
        if (e instanceof CompanyCamError && e.status === 404) return null;
        throw e;
      }
    },

    async setProjectCustomer(projectId, customerId) {
      return data(await request('PUT', `/projects/${encodeURIComponent(projectId)}/customer`, {
        body: { customer_id: String(customerId) },
      }));
    },

    /** Search customers (q = substring of name/email/phone/address). Follows cursors up to maxPages. */
    async searchCustomers(q, { maxPages = 5 } = {}) {
      const out = [];
      let after;
      for (let i = 0; i < maxPages; i++) {
        const r = await request('GET', '/customers', { query: { q, limit: 100, after } });
        out.push(...(data(r) || []));
        after = r?.meta?.next_cursor;
        if (!after || r?.meta?.has_next === false) break;
      }
      return out;
    },

    async createCustomer(customer) {
      return data(await request('POST', '/customers', { body: { customer } }));
    },

    /** Newest-first page of projects. */
    async listProjects({ after, limit = 100 } = {}) {
      const r = await request('GET', '/projects', { query: { limit, after } });
      return { items: data(r) || [], next: r?.meta?.next_cursor || null };
    },
  };
}
