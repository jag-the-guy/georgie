/**
 * Modified SM-2 scheduler.
 *
 * schedule() is pure: it never reads the clock, the database or Math.random. The server
 * calls it to save a rating; the client calls it only to preview intervals on the buttons.
 */
import type { Rating, SchedCard } from './types';
import type { SrsConfig } from './srsConfig';
import { DAY_MS } from './time';

const MINUTE = 60_000;

export function schedule<T extends SchedCard>(card: T, rating: Rating, now: number, config: SrsConfig): T {
  const base = { ...card, last_reviewed_at: now };
  switch (card.state) {
    case 'new':
    case 'learning':
      return scheduleLearning(base, card, rating, now, config);
    case 'review':
      return scheduleReview(base, card, rating, now, config);
    case 'relearning':
      return scheduleRelearning(base, card, rating, now, config);
  }
}

function scheduleLearning<T extends SchedCard>(base: T, card: T, rating: Rating, now: number, config: SrsConfig): T {
  const steps = config.learningSteps;
  const current = card.state === 'new' ? 0 : clampStep(card.step, steps);
  const ease = card.state === 'new' ? config.startingEase : card.ease;
  const stay = (step: number, delayMinutes = steps[step]): T => ({
    ...base,
    state: 'learning',
    ease,
    interval_days: 0,
    step,
    due_at: now + delayMinutes * MINUTE,
  });

  if (rating === 1) return stay(0);
  if (rating === 2) return stay(current, config.mediumLearningDelay);
  if (rating === 3 && current + 1 < steps.length) return stay(current + 1);

  // Graduate. Good and Easy are fuzzed with the same seed and ordered, so Easy always beats Good.
  const [good, easy] = orderedIntervals(card, [config.graduatingInterval, config.easyInterval], 0, config);
  return graduate(base, ease, rating === 4 ? easy : good, now, config);
}

function scheduleReview<T extends SchedCard>(base: T, card: T, rating: Rating, now: number, config: SrsConfig): T {
  const old = Math.max(1, card.interval_days);

  if (rating === 1) {
    // Lapse: keep the post-lapse interval on the card so relearning knows where to graduate to.
    const lapseInterval = Math.min(
      config.maxInterval,
      Math.max(config.minLapseInterval, Math.round(old * config.lapseMultiplier)),
    );
    return {
      ...base,
      state: 'relearning',
      ease: clampEase(card.ease - config.lapseEasePenalty, config),
      interval_days: lapseInterval,
      step: 0,
      lapses: card.lapses + 1,
      due_at: now + config.relearningSteps[0] * MINUTE,
    };
  }

  const [medium, good, easy] = orderedIntervals(
    card,
    [old * config.mediumMultiplier, old * card.ease, old * card.ease * config.easyBonus],
    old + 1,
    config,
  );
  const interval = rating === 2 ? medium : rating === 3 ? good : easy;
  const ease =
    rating === 2
      ? clampEase(card.ease - config.mediumEasePenalty, config)
      : rating === 4
        ? clampEase(card.ease + config.easyEaseBonus, config)
        : card.ease;
  return graduate(base, ease, interval, now, config);
}

function scheduleRelearning<T extends SchedCard>(base: T, card: T, rating: Rating, now: number, config: SrsConfig): T {
  const steps = config.relearningSteps;
  const current = clampStep(card.step, steps);
  const stay = (step: number, delayMinutes = steps[step]): T => ({
    ...base,
    state: 'relearning',
    step,
    due_at: now + delayMinutes * MINUTE,
  });

  if (rating === 1) return stay(0);
  if (rating === 2) return stay(current, config.mediumLearningDelay);
  if (rating === 3 && current + 1 < steps.length) return stay(current + 1);

  const stored = Math.max(config.minLapseInterval, card.interval_days);
  const [good, easy] = orderedIntervals(card, [stored, stored + 1], 0, config);
  return graduate(base, card.ease, rating === 4 ? easy : good, now, config);
}

function graduate<T extends SchedCard>(base: T, ease: number, interval: number, now: number, config: SrsConfig): T {
  return {
    ...base,
    state: 'review',
    ease,
    interval_days: interval,
    step: 0,
    // Exactly `interval` days from now, so a card rated at 3pm with a 4d button comes back in 4 days at 3pm.
    due_at: now + interval * DAY_MS,
  };
}

/**
 * Fuzzes and rounds raw intervals (given in ascending rating order), then enforces:
 * first >= minFirst, and each subsequent interval at least 1 day longer than the one before.
 * The cap is applied last, so it always wins.
 */
function orderedIntervals(card: SchedCard, raw: number[], minFirst: number, config: SrsConfig): number[] {
  const factor = fuzzFactor(card, config);
  const result: number[] = [];
  let floor = minFirst;
  for (const value of raw) {
    const fuzzed = value > config.fuzzMinInterval ? value * factor : value;
    const days = Math.max(floor, Math.round(fuzzed), 1);
    result.push(days);
    floor = days + 1;
  }
  return result.map((d) => Math.min(d, config.maxInterval));
}

/**
 * Deterministic "random" fuzz factor in [1 - f, 1 + f], seeded by the card id and its
 * previous review time. Different cards spread out, and the button preview matches what the server saves.
 */
function fuzzFactor(card: SchedCard, config: SrsConfig): number {
  const u = hashToUnit(`${card.id}:${card.last_reviewed_at ?? 0}:${card.lapses}`);
  return 1 + config.fuzzFraction * (2 * u - 1);
}

/** FNV-1a hash mapped to [0, 1). */
export function hashToUnit(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

function clampEase(ease: number, config: SrsConfig): number {
  return Math.max(config.minEase, Math.round(ease * 100) / 100);
}

function clampStep(step: number, steps: number[]): number {
  return Math.min(Math.max(0, step), steps.length - 1);
}

/** A fresh, never-studied card's scheduling fields. */
export function newCardFields(now: number, config: SrsConfig) {
  return {
    state: 'new' as const,
    ease: config.startingEase,
    interval_days: 0,
    due_at: now,
    step: 0,
    lapses: 0,
    last_reviewed_at: null,
  };
}
