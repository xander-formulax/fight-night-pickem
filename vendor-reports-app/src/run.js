// One weekly run: build every enabled vendor's report, gate on readiness,
// send, and record. Shared by the cron endpoint and the app's manual actions.

import { SecureStorage } from '@mondaycom/apps-sdk';
import { config } from './config.js';
import { loadReportData, markSent } from './monday.js';
import { buildReport } from './buildReport.js';
import { renderEmail, renderSubject } from './renderEmail.js';
import { sendEmail } from './email.js';
import { checkVendor, accountReadiness } from './readiness.js';
import { reportWeek, addDays } from './week.js';

let store;
function storage() {
  if (!store) store = new SecureStorage();
  return store;
}

const sendKey = (vendorId, weekStart) => `sent:${vendorId}:${weekStart}`;

async function alreadySent(vendorId, weekStart) {
  try { return Boolean(await storage().get(sendKey(vendorId, weekStart))); }
  catch { return false; }
}

async function recordSend(vendorId, weekStart, record) {
  try { await storage().set(sendKey(vendorId, weekStart), JSON.stringify(record)); }
  catch (err) { console.error('could not record send', err.message); }
}

/**
 * @param {object} opts
 * @param {boolean} opts.dryRun  build and render but never send
 * @param {string[]} [opts.onlyVendorIds]  restrict to these vendors
 * @param {boolean} [opts.force] send even if this week is already recorded
 */
export async function runWeek({ dryRun = false, onlyVendorIds = null, force = false, now = new Date() } = {}) {
  const token = config.mondayToken;
  if (!token) throw new Error('MONDAY_API_TOKEN is not configured');

  const week = reportWeek(now);
  const data = await loadReportData({
    token,
    recentlyCompletedSince: addDays(week.start, -config.completedGraceDays),
  });

  const results = [];

  for (const [vendorId, jobs] of data.jobsByVendorId) {
    if (onlyVendorIds && !onlyVendorIds.includes(vendorId)) continue;

    const vendor = data.vendorsById.get(vendorId);
    const name = vendor?.name || `vendor ${vendorId}`;

    if (!onlyVendorIds && !vendor?.enabled) {
      results.push({ vendorId, name, status: 'paused' });
      continue;
    }

    const readiness = checkVendor(vendor, jobs);
    if (!readiness.ok) {
      results.push({ vendorId, name, status: 'skipped', problems: readiness.problems });
      continue;
    }

    if (!force && !dryRun && await alreadySent(vendorId, week.start)) {
      results.push({ vendorId, name, status: 'already-sent' });
      continue;
    }

    const report = buildReport({ vendor, jobs, tasksById: data.tasksById, week });
    const subject = renderSubject(report);
    const html = renderEmail(report, { officePhone: config.officePhone });

    if (dryRun) {
      results.push({ vendorId, name, status: 'dry-run', subject,
        homes: report.activeHomes, completed: report.completedCount });
      continue;
    }

    try {
      const sent = await sendEmail({ to: vendor.recipients, subject, html });
      await recordSend(vendorId, week.start, {
        sentAt: new Date().toISOString(), to: vendor.recipients, subject, messageId: sent.id,
      });
      await markSent({ vendorId, date: week.end, token }).catch(() => {});
      results.push({ vendorId, name, status: 'sent', to: vendor.recipients,
        subject, homes: report.activeHomes, completed: report.completedCount });
    } catch (err) {
      console.error(`send failed for ${name}:`, err.message);
      results.push({ vendorId, name, status: 'failed', error: err.message });
    }
  }

  const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  return { week, results, tally, readiness: accountReadiness(data) };
}

/** Build one vendor's report without sending — used by the preview endpoint. */
export async function previewVendor({ vendorId, now = new Date() }) {
  const token = config.mondayToken;
  if (!token) throw new Error('MONDAY_API_TOKEN is not configured');

  const week = reportWeek(now);
  const data = await loadReportData({
    token,
    recentlyCompletedSince: addDays(week.start, -config.completedGraceDays),
  });

  const vendor = data.vendorsById.get(String(vendorId));
  const jobs = data.jobsByVendorId.get(String(vendorId)) || [];
  const report = buildReport({ vendor: vendor || { id: vendorId, name: 'Unknown vendor' }, jobs, tasksById: data.tasksById, week });

  return {
    report,
    subject: renderSubject(report),
    html: renderEmail(report, { officePhone: config.officePhone }),
    readiness: checkVendor(vendor, jobs),
  };
}
