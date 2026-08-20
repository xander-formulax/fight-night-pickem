// Config resolution. On monday-code these come from the Secrets Manager;
// locally they fall back to plain env vars so the app runs without monday.
import { SecretsManager, EnvironmentVariablesManager } from '@mondaycom/apps-sdk';

let secrets;
let envs;
try { secrets = new SecretsManager(); } catch { secrets = null; }
try { envs = new EnvironmentVariablesManager(); } catch { envs = null; }

export function readConfig(key, fallback = undefined) {
  try { const v = secrets?.get(key); if (v) return v; } catch { /* not on monday-code */ }
  try { const v = envs?.get(key); if (v) return v; } catch { /* not on monday-code */ }
  return process.env[key] ?? fallback;
}

export const config = {
  get mondayToken() { return readConfig('MONDAY_API_TOKEN'); },
  // monday signs session tokens with the app's CLIENT SECRET (not the
  // "Signing Secret" — that one is for integration webhooks). The env key name
  // is historical; the value stored in it must be the Client Secret.
  get clientSecret() { return readConfig('MONDAY_SIGNING_SECRET'); },
  get completedGraceDays() { return Number(readConfig('COMPLETED_GRACE_DAYS', '14')); },
  get officePhone() { return readConfig('OFFICE_PHONE', ''); },
  get port() { return Number(readConfig('PORT', '8080')); },
};
