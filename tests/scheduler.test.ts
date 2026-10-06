import { describe, expect, it } from 'vitest';
import { schedule, newCardFields } from '../shared/scheduler';
import { makeConfig } from '../shared/srsConfig';
import { DAY_MS } from '../shared/time';
import { previewIntervals } from '../shared/formatInterval';
import type { Rating, SchedCard } from '../shared/types';

const MIN = 60_000;
const config = makeConfig({ timezone: 'UTC' });
// 2026-03-10 12:00 UTC
const NOW = Date.UTC(2026, 2, 10, 12, 0, 0);

function card(overrides: Partial<SchedCard> = {}): SchedCard {
  return { id: 1, ...newCardFields(NOW - 1000, config), ...overrides };
}
function learning(step: number) {
  return card({ state: 'learning', step, last_reviewed_at: NOW - MIN });
}
function review(interval_days: number, ease = 2.5, id = 1) {
  return card({ id, state: 'review', interval_days, ease, last_reviewed_at: NOW - interval_days * 86_400_000 });
}
function relearning(interval_days: number, step = 0) {
  return card({ state: 'relearning', interval_days, step, ease: 2.3, lapses: 1, last_reviewed_at: NOW - 10 * MIN });
}
const dueInDays = (days: number) => NOW + days * DAY_MS;

describe('new cards', () => {
  it('Hard -> learning step 0, due in 1 minute', () => {
    const r = schedule(card(), 1, NOW, config);
    expect(r).toMatchObject({ state: 'learning', step: 0, interval_days: 0, due_at: NOW + MIN, last_reviewed_at: NOW });
  });
  it('Medium -> stays on step 0, due in 5 minutes', () => {
    expect(schedule(card(), 2, NOW, config)).toMatchObject({ state: 'learning', step: 0, due_at: NOW + 5 * MIN });
  });
  it('Good -> moves to step 1, due in 10 minutes', () => {
    expect(schedule(card(), 3, NOW, config)).toMatchObject({ state: 'learning', step: 1, due_at: NOW + 10 * MIN });
  });
  it('Easy -> graduates to review with 4 days', () => {
    const r = schedule(card(), 4, NOW, config);
    expect(r).toMatchObject({ state: 'review', interval_days: 4, step: 0, due_at: dueInDays(4) });
  });
  it('uses the starting ease and does not touch lapses', () => {
    const r = schedule(card(), 3, NOW, config);
    expect(r.ease).toBe(2.5);
    expect(r.lapses).toBe(0);
  });
});

describe('learning cards', () => {
  it('step 0: Hard 1m, Medium 5m, Good 10m, Easy 4d', () => {
    expect(schedule(learning(0), 1, NOW, config)).toMatchObject({ state: 'learning', step: 0, due_at: NOW + MIN });
    expect(schedule(learning(0), 2, NOW, config)).toMatchObject({ state: 'learning', step: 0, due_at: NOW + 5 * MIN });
    expect(schedule(learning(0), 3, NOW, config)).toMatchObject({ state: 'learning', step: 1, due_at: NOW + 10 * MIN });
    expect(schedule(learning(0), 4, NOW, config)).toMatchObject({ state: 'review', interval_days: 4 });
  });
  it('step 1: Hard back to step 0 (1m), Medium stays on step 1 but comes back in 5m', () => {
    expect(schedule(learning(1), 1, NOW, config)).toMatchObject({ state: 'learning', step: 0, due_at: NOW + MIN });
    expect(schedule(learning(1), 2, NOW, config)).toMatchObject({ state: 'learning', step: 1, due_at: NOW + 5 * MIN });
  });
  it('step 1 (last step): Good graduates with 1 day, due exactly 24 hours later', () => {
    const r = schedule(learning(1), 3, NOW, config);
    expect(r).toMatchObject({ state: 'review', interval_days: 1, step: 0, due_at: dueInDays(1) });
    expect(new Date(r.due_at).toISOString()).toBe('2026-03-11T12:00:00.000Z');
  });
  it('step 1: Easy graduates with 4 days', () => {
    expect(schedule(learning(1), 4, NOW, config)).toMatchObject({ state: 'review', interval_days: 4, due_at: dueInDays(4) });
  });
});

describe('review cards', () => {
  it('Hard is a lapse: lapses +1, ease -0.20, relearning with a 10 minute step', () => {
    const r = schedule(review(20), 1, NOW, config);
    expect(r).toMatchObject({ state: 'relearning', step: 0, lapses: 1, ease: 2.3, due_at: NOW + 10 * MIN });
    expect(r.interval_days).toBe(10); // half of 20, kept for when it graduates again
  });
  it('lapse interval is never below 1 day', () => {
    expect(schedule(review(1), 1, NOW, config).interval_days).toBe(1);
  });
  it('Medium: interval x 1.2 (fuzzed), ease -0.15', () => {
    const r = schedule(review(50), 2, NOW, config);
    expect(r.state).toBe('review');
    expect(r.ease).toBe(2.35);
    expect(r.interval_days).toBeGreaterThanOrEqual(Math.round(60 * 0.95));
    expect(r.interval_days).toBeLessThanOrEqual(Math.round(60 * 1.05));
    expect(r.due_at).toBe(dueInDays(r.interval_days));
  });
  it('Good: interval x ease (fuzzed), ease unchanged', () => {
    const r = schedule(review(20), 3, NOW, config);
    expect(r.ease).toBe(2.5);
    expect(r.interval_days).toBeGreaterThanOrEqual(Math.round(50 * 0.95));
    expect(r.interval_days).toBeLessThanOrEqual(Math.round(50 * 1.05));
  });
  it('Easy: interval x ease x 1.3 (fuzzed), ease +0.15', () => {
    const r = schedule(review(20), 4, NOW, config);
    expect(r.ease).toBe(2.65);
    expect(r.interval_days).toBeGreaterThanOrEqual(Math.round(65 * 0.95));
    expect(r.interval_days).toBeLessThanOrEqual(Math.round(65 * 1.05));
  });
  it('without fuzz the multipliers are exact', () => {
    const noFuzz = makeConfig({ timezone: 'UTC', fuzzFraction: 0 });
    expect(schedule(review(50), 2, NOW, noFuzz).interval_days).toBe(60);
    expect(schedule(review(20), 3, NOW, noFuzz).interval_days).toBe(50);
    expect(schedule(review(20), 4, NOW, noFuzz).interval_days).toBe(65);
  });
});

describe('relearning cards', () => {
  it('Hard -> back to step 0 (10m), no extra lapse', () => {
    const r = schedule(relearning(5), 1, NOW, config);
    expect(r).toMatchObject({ state: 'relearning', step: 0, lapses: 1, due_at: NOW + 10 * MIN, interval_days: 5 });
  });
  it('Medium -> stays on the step, due in 5 minutes', () => {
    expect(schedule(relearning(5), 2, NOW, config)).toMatchObject({ state: 'relearning', step: 0, due_at: NOW + 5 * MIN });
  });
  it('Good -> graduates with max(1, old interval / 2)', () => {
    const lapsed = schedule(review(20), 1, NOW, config);
    const r = schedule(lapsed, 3, NOW + 10 * MIN, config);
    expect(r.state).toBe('review');
    expect(r.interval_days).toBeGreaterThanOrEqual(Math.round(10 * 0.95));
    expect(r.interval_days).toBeLessThanOrEqual(Math.round(10 * 1.05));
  });
  it('Good after a lapse from a 1 day card graduates with 1 day', () => {
    const lapsed = schedule(review(1), 1, NOW, config);
    expect(schedule(lapsed, 3, NOW, config)).toMatchObject({ state: 'review', interval_days: 1, due_at: dueInDays(1) });
  });
  it('Easy -> graduates with a longer interval than Good', () => {
    const good = schedule(relearning(5), 3, NOW, config);
    const easy = schedule(relearning(5), 4, NOW, config);
    expect(easy.state).toBe('review');
    expect(easy.interval_days).toBeGreaterThan(good.interval_days);
  });
  it('keeps the lowered ease', () => {
    expect(schedule(relearning(5), 3, NOW, config).ease).toBe(2.3);
  });
});

describe('ease clamping', () => {
  it('never drops below 1.3 on a lapse', () => {
    expect(schedule(review(10, 1.4), 1, NOW, config).ease).toBe(1.3);
    expect(schedule(review(10, 1.3), 1, NOW, config).ease).toBe(1.3);
  });
  it('never drops below 1.3 on Medium', () => {
    expect(schedule(review(10, 1.35), 2, NOW, config).ease).toBe(1.3);
  });
  it('stays at 1.3 after many lapses', () => {
    let c: SchedCard = review(30);
    for (let i = 0; i < 20; i++) {
      c = schedule(c, 1, NOW + i * 1000, config); // lapse
      c = schedule(c, 3, NOW + i * 1000 + 500, config); // graduate again
    }
    expect(c.ease).toBe(1.3);
    expect(c.lapses).toBe(20);
  });
});

describe('interval ordering', () => {
  const cases: [number, number][] = [];
  for (const interval of [1, 2, 3, 4, 5, 7, 10, 30, 100]) {
    for (const ease of [1.3, 1.5, 2.0, 2.5, 3.0]) cases.push([interval, ease]);
  }
  it.each(cases)('interval %i, ease %f: Medium >= old+1, Good > Medium, Easy > Good', (interval, ease) => {
    for (let id = 1; id <= 20; id++) {
      const c = review(interval, ease, id);
      const [m, g, e] = ([2, 3, 4] as Rating[]).map((r) => schedule(c, r, NOW, config).interval_days);
      expect(m).toBeGreaterThanOrEqual(interval + 1);
      expect(g).toBeGreaterThanOrEqual(m + 1);
      expect(e).toBeGreaterThanOrEqual(g + 1);
    }
  });
  it('at minimum ease and interval 1, gives 2 / 3 / 4 days', () => {
    const c = review(1, 1.3);
    expect(([2, 3, 4] as Rating[]).map((r) => schedule(c, r, NOW, config).interval_days)).toEqual([2, 3, 4]);
  });
});

describe('365 day cap', () => {
  it('caps every rating at 365 days', () => {
    for (const rating of [2, 3, 4] as Rating[]) {
      expect(schedule(review(330, 2.5), rating, NOW, config).interval_days).toBe(365);
    }
  });
  it('a card already at the cap stays there', () => {
    expect(schedule(review(365), 3, NOW, config).interval_days).toBe(365);
  });
  it('a lapse from the cap halves it', () => {
    expect(schedule(review(365), 1, NOW, config).interval_days).toBe(183);
  });
  it('respects a configured cap', () => {
    const small = makeConfig({ timezone: 'UTC', maxInterval: 30 });
    expect(schedule(review(20), 4, NOW, small).interval_days).toBe(30);
  });
});

describe('fuzz', () => {
  it('stays within +/- 5% and spreads cards out', () => {
    const goods = new Set<number>();
    for (let id = 1; id <= 200; id++) {
      const d = schedule(review(40, 2.5, id), 3, NOW, config).interval_days;
      expect(d).toBeGreaterThanOrEqual(Math.round(100 * 0.95));
      expect(d).toBeLessThanOrEqual(Math.round(100 * 1.05));
      goods.add(d);
    }
    expect(goods.size).toBeGreaterThan(5);
  });
  it('is deterministic: same card, same result', () => {
    const c = review(40, 2.5, 7);
    expect(schedule(c, 3, NOW, config)).toEqual(schedule(c, 3, NOW, config));
  });
  it('is not applied to intervals of 2 days or less', () => {
    for (let id = 1; id <= 50; id++) {
      expect(schedule(learning(1), 3, NOW, config).interval_days).toBe(1);
      expect(schedule(review(1, 1.3, id), 2, NOW, config).interval_days).toBe(2);
    }
  });
});

describe('purity', () => {
  it('does not mutate the input card', () => {
    const c = review(10);
    const copy = { ...c };
    schedule(c, 1, NOW, config);
    expect(c).toEqual(copy);
  });
  it('keeps extra fields on the card', () => {
    const c = { ...review(10), front: 'Q', back: 'A' };
    expect(schedule(c, 3, NOW, config)).toMatchObject({ front: 'Q', back: 'A' });
  });
});

describe('button previews', () => {
  it('new card shows 1m / 5m / 10m / 4d', () => {
    expect(previewIntervals(card(), NOW, config)).toEqual({ 1: '1m', 2: '5m', 3: '10m', 4: '4d' });
  });
  it('review card shows months', () => {
    const noFuzz = makeConfig({ timezone: 'UTC', fuzzFraction: 0 });
    expect(previewIntervals(review(24), NOW, noFuzz)).toEqual({ 1: '10m', 2: '29d', 3: '2mo', 4: '2.6mo' });
  });
});
