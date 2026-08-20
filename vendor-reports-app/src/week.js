// Date helpers. The report week is Monday 00:00 -> Sunday 23:59 in America/Chicago.
//
// monday returns dates as plain 'YYYY-MM-DD' strings with no timezone, so we do
// all arithmetic on plain dates anchored at UTC noon. That keeps a day from
// slipping either side of a DST boundary, and lets range checks be plain string
// comparisons.

const TZ = 'America/Chicago';

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Current date in Chicago as 'YYYY-MM-DD'. */
export function todayInChicago(now = new Date()) {
  return ymdFmt.format(now);
}

/** ISO weekday (Mon=1 .. Sun=7) for a 'YYYY-MM-DD' date. */
export function isoWeekday(ymd) {
  return DOW[dowFmt.format(anchor(ymd))];
}

function anchor(ymd) {
  return new Date(`${ymd}T12:00:00Z`);
}

/** Shift a 'YYYY-MM-DD' date by whole days. */
export function addDays(ymd, days) {
  const d = anchor(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The report week containing `now` — the week just ending.
 * Running on Friday, this is Monday of the current week through the coming Sunday.
 */
export function reportWeek(now = new Date()) {
  const today = todayInChicago(now);
  const start = addDays(today, -(isoWeekday(today) - 1));
  return { start, end: addDays(start, 6) };
}

/** True when a 'YYYY-MM-DD' date falls inside the week, inclusive. */
export function inWeek(ymd, week) {
  return Boolean(ymd) && ymd >= week.start && ymd <= week.end;
}

const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
});

/** 'YYYY-MM-DD' -> 'Tue, Aug 18' */
export function formatDay(ymd) {
  return dayFmt.format(anchor(ymd)).replace(',', ',');
}

const rangeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric',
});

/** A week -> 'August 17-23, 2026' */
export function formatWeekRange(week) {
  const a = rangeFmt.format(anchor(week.start));
  const b = rangeFmt.format(anchor(week.end));
  const year = week.end.slice(0, 4);
  const [am] = a.split(' ');
  const [bm, bd] = b.split(' ');
  return am === bm ? `${a}-${bd}, ${year}` : `${a} - ${b}, ${year}`;
}
