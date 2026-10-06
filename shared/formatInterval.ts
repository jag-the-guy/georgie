import type { Rating, SchedCard } from './types';
import { RATINGS } from './types';
import type { SrsConfig } from './srsConfig';
import { schedule } from './scheduler';

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** 3 -> "3d", 60 -> "2mo", 400 -> "1.1y" */
export function formatDays(days: number): string {
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

/** 60_000 -> "1m", 3_600_000 -> "1h" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${trim(hours)}h`;
  return formatDays(hours / 24);
}

/** The label shown under each rating button, e.g. { 1: "1m", 2: "1m", 3: "10m", 4: "4d" }. */
export function previewIntervals(card: SchedCard, now: number, config: SrsConfig): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const rating of RATINGS) {
    const next = schedule(card, rating, now, config);
    out[rating] = next.state === 'review' ? formatDays(next.interval_days) : formatDuration(next.due_at - now);
  }
  return out;
}
