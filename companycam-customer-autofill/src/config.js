import { EnvironmentVariablesManager, SecretsManager } from '@mondaycom/apps-sdk';

// On monday code, secrets come from `mapps code:secret` and env vars from `mapps code:env`.
// Locally (tests / dev), both fall back to process.env.
let secrets;
let envs;
try { secrets = new SecretsManager(); } catch { secrets = null; }
try { envs = new EnvironmentVariablesManager(); } catch { envs = null; }

function read(manager, key) {
  try {
    const v = manager?.get(key);
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch { /* fall through */ }
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
}

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
