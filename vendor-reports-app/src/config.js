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
  get clientSecret() { return readConfig('MONDAY_SIGNING_SECRET'); },
  get emailDriver() { return readConfig('EMAIL_DRIVER', 'console'); },
  get emailApiKey() { return readConfig('EMAIL_API_KEY'); },
  get emailFrom() { return readConfig('EMAIL_FROM', 'reports@dragontransport.com'); },
  get officePhone() { return readConfig('OFFICE_PHONE', '(432) 555-0148'); },
  // Every send is redirected here when set. Use it for dry runs.
  get redirectTo() { return readConfig('REDIRECT_ALL_EMAIL_TO'); },
  get completedGraceDays() { return Number(readConfig('COMPLETED_GRACE_DAYS', '14')); },
  get port() { return Number(readConfig('PORT', '8080')); },
};
