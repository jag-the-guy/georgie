import crypto from 'node:crypto';
import type { GenerateResult } from './types';

export interface Job {
  id: string;
  userId: number;
  status: 'working' | 'done' | 'error' | 'cancelled';
  stage: string;
  /** Cards written so far, while the AI is still working. */
  cards: number;
  result?: GenerateResult;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  abort: AbortController;
}

const KEEP_MS = 60 * 60 * 1000;

/** Notes jobs wait in memory: they take a minute or two, and the results are reviewed (then imported or discarded) right away. */
export class JobStore {
  private jobs = new Map<string, Job>();

  create(userId: number, now = Date.now()): Job {
    this.sweep(now);
    const job: Job = { id: crypto.randomBytes(18).toString('hex'), userId, status: 'working', stage: 'Starting…', cards: 0, startedAt: now, abort: new AbortController() };
    this.jobs.set(job.id, job);
    return job;
  }

  /** Only the person who started a job can see it. */
  get(userId: number, id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job && job.userId === userId ? job : undefined;
  }

  working(userId: number): Job | undefined {
    return [...this.jobs.values()].find((j) => j.userId === userId && j.status === 'working');
  }

  remove(id: string) {
    this.jobs.delete(id);
  }

  sweep(now = Date.now()) {
    for (const [id, job] of this.jobs) if (job.status !== 'working' && now - (job.finishedAt ?? job.startedAt) > KEEP_MS) this.jobs.delete(id);
  }
}
