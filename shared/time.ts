/**
 * Timezone helpers for the "study day", which starts at a configurable local hour (4am by default).
 * Uses only Intl, so it works the same in Node and the browser.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at instant `utcMs`, in ms (local = utc + offset). */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(whole))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - whole;
}

/** The UTC instant at which the wall clock in `tz` reads the given local date and hour. */
export function zonedTimeToUtc(date: CivilDate, hour: number, tz: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  const firstOffset = tzOffsetMs(guess, tz);
  let utc = guess - firstOffset;
  const secondOffset = tzOffsetMs(utc, tz);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return utc;
}

function addDaysToCivil(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The study day that `now` belongs to. Before `dayStartHour` local time it is still the previous day. */
export function studyDay(now: number, tz: string, dayStartHour: number): CivilDate {
  const shifted = new Date(now + tzOffsetMs(now, tz) - dayStartHour * HOUR);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The instant the current study day began (e.g. today's 4am local). */
export function studyDayStart(now: number, tz: string, dayStartHour: number): number {
  return zonedTimeToUtc(studyDay(now, tz, dayStartHour), dayStartHour, tz);
}

/** The instant `days` study days after the one containing `now` begins (e.g. 4am local, 3 days from today). */
export function addStudyDays(now: number, days: number, tz: string, dayStartHour: number): number {
  return zonedTimeToUtc(addDaysToCivil(studyDay(now, tz, dayStartHour), days), dayStartHour, tz);
}

