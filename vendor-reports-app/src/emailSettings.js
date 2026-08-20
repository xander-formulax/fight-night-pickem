// The sending account is DATA, not code. It lives in monday-code Secure
// Storage so the office can switch Gmail accounts from the app's Settings
// screen without a deploy. Locally (npm run demo) it falls back to memory.
import { SecureStorage } from '@mondaycom/apps-sdk';

const KEY = 'email-settings-v1';

let store = null;
let memory = null; // local fallback

function storage() {
  if (store === null) {
    try { store = new SecureStorage(); } catch { store = false; }
  }
  return store;
}

export async function getEmailSettings() {
  const s = storage();
  if (!s) return memory;
  try {
    const raw = await s.get(KEY);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function setEmailSettings({ address, appPassword }) {
  const value = { address: String(address).trim(), appPassword: String(appPassword).replace(/\s+/g, '') };
  const s = storage();
  if (!s) { memory = value; return; }
  await s.set(KEY, JSON.stringify(value));
}

export async function clearEmailSettings() {
  const s = storage();
  if (!s) { memory = null; return; }
  try { await s.delete(KEY); } catch { /* already gone */ }
}

/** What the frontend may see. Never the password. */
export function publicView(settings) {
  return settings?.address ? { connected: true, address: settings.address } : { connected: false, address: null };
}
