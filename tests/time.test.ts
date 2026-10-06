import { describe, expect, it } from 'vitest';
import { addStudyDays, studyDay, studyDayStart, tzOffsetMs, zonedTimeToUtc } from '../shared/time';
import { schedule, newCardFields } from '../shared/scheduler';
import { makeConfig } from '../shared/srsConfig';

const iso = (ms: number) => new Date(ms).toISOString();

describe('4am study day boundary (UTC)', () => {
  it('3:59am belongs to the previous day', () => {
    expect(studyDay(Date.UTC(2026, 5, 10, 3, 59), 'UTC', 4)).toEqual({ year: 2026, month: 6, day: 9 });
    expect(iso(studyDayStart(Date.UTC(2026, 5, 10, 3, 59), 'UTC', 4))).toBe('2026-06-09T04:00:00.000Z');
  });
  it('4:00am starts the new day', () => {
    expect(studyDay(Date.UTC(2026, 5, 10, 4, 0), 'UTC', 4)).toEqual({ year: 2026, month: 6, day: 10 });
    expect(iso(studyDayStart(Date.UTC(2026, 5, 10, 4, 0), 'UTC', 4))).toBe('2026-06-10T04:00:00.000Z');
  });
  it('a 1 day interval rated at 3:59am is due at 4am that same morning', () => {
    expect(iso(addStudyDays(Date.UTC(2026, 5, 10, 3, 59), 1, 'UTC', 4))).toBe('2026-06-10T04:00:00.000Z');
  });
  it('a 1 day interval rated at 4:00am is due at 4am the next day', () => {
    expect(iso(addStudyDays(Date.UTC(2026, 5, 10, 4, 0), 1, 'UTC', 4))).toBe('2026-06-11T04:00:00.000Z');
  });
  it('crosses month and year ends', () => {
    expect(iso(addStudyDays(Date.UTC(2026, 11, 31, 12), 1, 'UTC', 4))).toBe('2027-01-01T04:00:00.000Z');
  });
});

describe('4am study day boundary in a local timezone', () => {
  const tz = 'America/New_York';
  it('uses local 4am, not UTC 4am', () => {
    // 2026-06-10 07:59 UTC is 03:59 EDT -> still June 9.
    expect(studyDay(Date.UTC(2026, 5, 10, 7, 59), tz, 4)).toEqual({ year: 2026, month: 6, day: 9 });
    // 08:00 UTC is 04:00 EDT -> June 10.
    expect(studyDay(Date.UTC(2026, 5, 10, 8, 0), tz, 4)).toEqual({ year: 2026, month: 6, day: 10 });
    expect(iso(studyDayStart(Date.UTC(2026, 5, 10, 12), tz, 4))).toBe('2026-06-10T08:00:00.000Z');
  });
  it('lands on 4am local across the spring-forward DST change', () => {
    // DST starts 2026-03-08 in New York (EST -5 -> EDT -4).
    const before = Date.UTC(2026, 2, 7, 15); // Mar 7, 10am EST
    expect(iso(addStudyDays(before, 1, tz, 4))).toBe('2026-03-08T08:00:00.000Z'); // 4am EDT
    expect(iso(addStudyDays(before, 0, tz, 4))).toBe('2026-03-07T09:00:00.000Z'); // 4am EST
  });
  it('lands on 4am local across the fall-back DST change', () => {
    // DST ends 2026-11-01 in New York.
    const before = Date.UTC(2026, 9, 31, 15);
    expect(iso(addStudyDays(before, 1, tz, 4))).toBe('2026-11-01T09:00:00.000Z'); // 4am EST
  });
  it('handles timezones ahead of UTC', () => {
    // Sydney is AEST (+10) in June: 18:30 UTC is 04:30 on June 11, 17:59 UTC is 03:59.
    expect(studyDay(Date.UTC(2026, 5, 10, 18, 30), 'Australia/Sydney', 4)).toEqual({ year: 2026, month: 6, day: 11 });
    expect(studyDay(Date.UTC(2026, 5, 10, 17, 59), 'Australia/Sydney', 4)).toEqual({ year: 2026, month: 6, day: 10 });
  });
  it('offset and zonedTimeToUtc round-trip', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 1), tz)).toBe(-5 * 3_600_000);
    expect(iso(zonedTimeToUtc({ year: 2026, month: 1, day: 1 }, 4, tz))).toBe('2026-01-01T09:00:00.000Z');
  });
});

describe('review due times', () => {
  it('come back exactly interval x 24 hours later, not snapped to 4am', () => {
    const config = makeConfig({ timezone: 'Europe/London' });
    for (const hour of [0, 3, 4, 9, 15, 22]) {
      const now = Date.UTC(2026, 0, 15, hour, 17);
      const card = { id: 1, ...newCardFields(now, config), state: 'learning' as const, step: 1 };
      const good = schedule(card, 3, now, config);
      expect(good.interval_days).toBe(1);
      expect(good.due_at - now).toBe(86_400_000);
      const easy = schedule(card, 4, now, config);
      expect(easy.due_at - now).toBe(4 * 86_400_000);
    }
  });
});
