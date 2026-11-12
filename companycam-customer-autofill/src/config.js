import { EnvironmentVariablesManager, SecretsManager } from '@mondaycom/apps-sdk';

// On monday code, secrets come from `mapps code:secret` and env vars from `mapps code:env`.
// Locally (tests / dev), both fall back to process.env.
let secrets;
let envs;
try { secrets = new SecretsManager(); } catch { secrets = null; }
try { envs = new EnvironmentVariablesManager(); } catch { envs = null; }

// When the manager has any keys we're on monday code and it is the source of truth. Do NOT fall back to
// process.env there: monday code also copies env vars into process.env at container start, so a key
// deleted with `mapps code:env -m delete` would otherwise keep its old value until the next restart
// (that is how TEST_NAME_FILTER survived its deletion on 2026-11-10).
export function readFrom(manager, key, processEnv = process.env) {
  let authoritative = false;
  try {
    const keys = manager?.getKeys?.();
    authoritative = Array.isArray(keys) && keys.length > 0;
    const v = manager?.get(key);
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch { /* fall through */ }
  if (authoritative) return undefined;
  const v = processEnv[key];
  return v === undefined || v === '' ? undefined : v;
}
const read = (manager, key) => readFrom(manager, key);

export const secret = (key) => read(secrets, key);
export const env = (key) => read(envs, key);

/** Fixed facts from the spec. Overridable by env var for testing only. */
export const settings = {
  companycamBaseUrl: () => env('COMPANYCAM_BASE_URL') || 'https://api.companycam.com/public_api/v1',
  // Projects created by the native monday integration are created as this user (Xander Harms).
  integrationCreatorId: () => env('INTEGRATION_CREATOR_ID') || '4362847',
  mondayBoardId: () => env('MONDAY_BOARD_ID') || '18409503078',
  mondayPhoneColumn: () => env('MONDAY_PHONE_COLUMN') || 'phone_mm2kg9m6',
  mondayEmailColumn: () => env('MONDAY_EMAIL_COLUMN') || 'email_mm5swnng',
  sweepDays: () => Number(env('SWEEP_DAYS') || 14),
  // Optional safety gate while testing: only touch projects whose name contains this text (case-insensitive).
  testNameFilter: () => env('TEST_NAME_FILTER') || null,
  // Anything other than the literal string "false" means dry run. Read on every run so a flip takes effect
  // without a code push.
  dryRun: () => (env('DRY_RUN') ?? 'true').toLowerCase() !== 'false',
};
