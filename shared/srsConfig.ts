/** Every tunable number used by the scheduler and the study queue lives here. */
export interface SrsConfig {
  /** Learning steps for new cards, in minutes. */
  learningSteps: number[];
  /** Relearning steps after a lapse, in minutes. */
  relearningSteps: number[];
  /** Medium on a learning/relearning card: stay on the same step, but come back after this many minutes. */
  mediumLearningDelay: number;
  startingEase: number;
  minEase: number;
  lapseEasePenalty: number;
  mediumEasePenalty: number;
  easyEaseBonus: number;
  /** Review: Medium multiplies the interval by this. */
  mediumMultiplier: number;
  /** Review: Easy multiplies (interval x ease) by this. */
  easyBonus: number;
  /** Interval in days when a card graduates from learning with Good. */
  graduatingInterval: number;
  /** Interval in days when a card graduates from learning with Easy. */
  easyInterval: number;
  /** After a lapse, the new interval is old interval x this ... */
  lapseMultiplier: number;
  /** ... but never less than this many days. */
  minLapseInterval: number;
  maxInterval: number;
  /** Intervals longer than fuzzMinInterval days are randomly moved by up to +/- this fraction. */
  fuzzFraction: number;
  fuzzMinInterval: number;
  /** The study day starts at this local hour. */
  dayStartHour: number;
  /** Default daily new-card limit per folder. */
  newPerDay: number;
  /** IANA timezone of the user, e.g. "Europe/London". */
  timezone: string;
}

export const DEFAULT_CONFIG: SrsConfig = {
  learningSteps: [1, 10],
  relearningSteps: [10],
  mediumLearningDelay: 5,
  startingEase: 2.5,
  minEase: 1.3,
  lapseEasePenalty: 0.2,
  mediumEasePenalty: 0.15,
  easyEaseBonus: 0.15,
  mediumMultiplier: 1.2,
  easyBonus: 1.3,
  graduatingInterval: 1,
  easyInterval: 4,
  lapseMultiplier: 0.5,
  minLapseInterval: 1,
  maxInterval: 365,
  fuzzFraction: 0.05,
  fuzzMinInterval: 2,
  dayStartHour: 4,
  newPerDay: 20,
  timezone: 'UTC',
};

export function makeConfig(overrides: Partial<SrsConfig> = {}): SrsConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
