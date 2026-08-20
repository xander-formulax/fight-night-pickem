// Renders a report object to email HTML.
//
// Everything here is a fixed template with values interpolated in. There is no
// generated prose. The only free text that reaches a vendor is a job name, an
// address, and a phase name — all typed by the office, all already on the board.
//
// Email-client constraints: tables for layout, inline styles only, no external
// stylesheet, no flexbox/grid. The progress bar is a table cell with a
// background colour, which renders everywhere including Outlook.

import { formatWeekRange } from './week.js';

const INK = '#191F21';
const SOFT = '#5A6863';
const FAINT = '#8B9791';
const RULE = '#D5DAD3';
const WELL = '#EFF1ED';
const GREEN = '#0B6E4F';
const AMBER = '#B26612';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TONE = { active: GREEN, hold: AMBER, unscheduled: FAINT, scheduled: SOFT };

function progressBar({ done, total, pct }) {
  const filled = Math.max(pct, 0);
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
        <tr>
          <td width="148" style="padding-right:12px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="148" style="background:${WELL};border-radius:4px">
              <tr><td height="7" width="${filled}%" style="background:${GREEN};border-radius:4px;font-size:0;line-height:0">&nbsp;</td>
                  <td height="7" style="font-size:0;line-height:0">&nbsp;</td></tr>
            </table>
          </td>
          <td style="font:500 12.5px ${FONT};color:${SOFT};white-space:nowrap">${done} of ${total} steps</td>
        </tr>
      </table>`;
}

function line(left, right, colour) {
  return `
        <tr>
          <td style="font:400 14.5px ${FONT};color:${INK};padding:0 0 5px;border-bottom:1px solid ${RULE}">${esc(left)}</td>
          <td align="right" style="font:500 12px ${FONT};color:${colour};padding:0 0 5px;border-bottom:1px solid ${RULE};white-space:nowrap">${esc(right)}</td>
        </tr>`;
}

function group(heading, colour, rows) {
  return `
      <p style="margin:0 0 6px;font:600 10.5px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:${colour}">${heading}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">${rows}</table>`;
}

function note(text) {
  return `<p style="margin:0 0 16px;padding:10px 14px;background:${WELL};border-radius:3px;font:400 14.5px ${FONT};color:${SOFT}">${esc(text)}</p>`;
}

function jobSection(job) {
  const completed = job.completed.length
    ? group('Completed this week', GREEN,
        job.completed.map((c) => line(c.name, c.dateLabel, SOFT)).join(''))
    : note('No tasks were completed on this home this week.');

  const pending = job.pending.length
    ? group('Still to do', SOFT,
        job.pending.map((p) => line(p.name, p.status, TONE[p.tone] || SOFT)).join(''))
    : note('All scheduled work on this home is complete.');

  return `
    <tr><td style="padding:22px 0 0;border-top:1px solid ${RULE}">
      <p style="margin:0 0 2px;font:600 17px ${FONT};color:${INK}">${esc(job.name)}</p>
      ${job.address ? `<p style="margin:0 0 14px;font:400 13.5px ${FONT};color:${SOFT}">${esc(job.address)}</p>` : ''}
      ${progressBar(job.progress)}
      ${completed}
      ${pending}
    </td></tr>`;
}

export function renderEmail(report, { officePhone = '(432) 555-0148' } = {}) {
  const homes = `${report.activeHomes} active home${report.activeHomes === 1 ? '' : 's'}`;
  const tasks = `${report.completedCount} task${report.completedCount === 1 ? '' : 's'} completed this week`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.vendor.name)} — weekly progress</title></head>
<body style="margin:0;padding:0;background:#F1F3EF">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1F3EF">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#FFFFFF;border:1px solid ${RULE};border-radius:4px">
        <tr><td style="padding:30px 28px 34px">

          <p style="margin:0 0 3px;font:700 13px ${FONT};letter-spacing:1.6px;text-transform:uppercase;color:${GREEN}">Dragon Transport</p>
          <h1 style="margin:0 0 3px;font:600 24px ${FONT};color:${INK};letter-spacing:-.4px">Weekly Progress Report</h1>
          <p style="margin:0 0 18px;font:400 13.5px ${FONT};color:${SOFT}">${esc(report.vendor.name)} · ${esc(formatWeekRange(report.week))}</p>
          <p style="margin:0 0 8px;padding:11px 15px;background:${WELL};border-radius:3px;font:400 14px ${FONT};color:${INK}"><strong>${homes}</strong> · ${tasks}</p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${report.jobs.map(jobSection).join('')}
          </table>

          <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid ${RULE};font:400 13px ${FONT};color:${SOFT}">Questions on any home above? Reply to this email or call the office at ${esc(officePhone)}.</p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderSubject(report) {
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(`${report.week.start}T12:00:00Z`));
  return `${report.vendor.name} — weekly progress, week of ${monthDay}`;
}
