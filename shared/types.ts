export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** 1 = Hard, 2 = Medium, 3 = Good, 4 = Easy */
export type Rating = 1 | 2 | 3 | 4;

export const RATINGS: Rating[] = [1, 2, 3, 4];
export const RATING_LABELS: Record<Rating, string> = { 1: 'Hard', 2: 'Medium', 3: 'Good', 4: 'Easy' };

/** The scheduling fields stored on every card. Timestamps are epoch milliseconds. */
export interface SchedulingFields {
  state: CardState;
  ease: number;
  interval_days: number;
  due_at: number;
  step: number;
  lapses: number;
  last_reviewed_at: number | null;
}

export interface SchedCard extends SchedulingFields {
  id: number;
}

export interface CardImage {
  id: number;
  side: 'front' | 'back';
}

export interface Card extends SchedCard {
  folder_id: number;
  front: string;
  back: string;
  created_at: number;
  updated_at: number;
  images: CardImage[];
}

export interface Folder {
  id: number;
  parent_id: number | null;
  name: string;
  color: string;
  new_per_day: number | null;
  created_at: number;
}

export interface QueueCounts {
  new: number;
  learning: number;
  review: number;
}

export type NextCardResponse =
  | { done: false; card: Card; counts: QueueCounts }
  | { done: true; nextDueAt: number | null; counts: QueueCounts };
