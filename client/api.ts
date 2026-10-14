import type { Card, Folder, NextCardResponse, Rating } from '../shared/types';

export interface User {
  id: number;
  email: string;
  timezone: string;
}

export interface FolderWithStats extends Folder {
  card_count: number;
  learned_count: number;
  due_count: number;
}

export type ImportDestination = { type: 'new'; name: string; parentId?: number | null } | { type: 'existing'; folderId: number };
export interface ImportOptions {
  destination: ImportDestination;
  rebuildFolders: boolean;
  skipDuplicates: boolean;
}
export interface ImportSummary {
  imported: number;
  duplicates: number;
  empty: number;
  foldersCreated: number;
  newFolderPaths: string[];
  images: number;
  folderId?: number;
}
export interface ApkgNoteType {
  id: string;
  name: string;
  fields: string[];
  cloze: boolean;
  count: number;
  examples: string[];
}
export type ApkgMappings = Record<string, { front: number; back: number | null }>;
export interface ApkgAnalysis {
  token: string;
  fileName: string;
  format: string;
  noteCount: number;
  mediaCount: number;
  noteTypes: ApkgNoteType[];
  decks: { path: string; count: number }[];
  commonRoot: string | null;
  suggestedName: string;
  mappings: ApkgMappings;
}
export interface ApkgStats {
  notes: number;
  images: number;
  missingMedia: number;
  unsupportedMedia: number;
  cloze: number;
  audio: number;
}
export interface ApkgSample {
  path: string[];
  front: string;
  back: string;
  frontImages: string[];
  backImages: string[];
}
export interface ApkgSettings {
  token: string;
  mappings: ApkgMappings;
  stripCommonRoot: boolean;
}

export type NotesDensity = 'light' | 'standard' | 'thorough';
export interface NotesStatus {
  available: boolean;
  mode?: 'claude' | 'demo';
  model?: string | null;
  dailyLimit?: number;
  usedToday?: number;
  limits?: { maxFiles: number; maxFileMB: number; maxImageMB: number; maxTextChars: number; maxFocusChars: number };
}
export interface NotesResult {
  mode: 'claude' | 'demo';
  model?: string;
  subject: string;
  summary: string;
  warnings: string[];
  topics: { name: string; cards: { front: string; back: string }[] }[];
}
export interface NotesJob {
  status: 'working' | 'done' | 'error' | 'cancelled';
  stage: string;
  cards: number;
  error?: string;
  result?: NotesResult;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Called when any request comes back 401, so the app can drop back to the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${url}`, {
    ...rest,
    credentials: 'same-origin',
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data.error ?? 'Something went wrong');
  }
  return data as T;
}

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export interface OwnerOverview {
  totals: { users: number; folders: number; cards: number; reviews: number; neverStudied: number };
  newUsers: { last24h: number; last7d: number; last30d: number };
  activeUsers: { last24h: number; last7d: number; last30d: number };
  series: { date: string; signups: number; active: number }[];
  generatedAt: number;
}
export interface OwnerUser {
  id: number;
  email: string;
  createdAt: number;
  lastActive: number | null;
  folders: number;
  cards: number;
  reviews: number;
  reviewsLast7Days: number;
  isYou: boolean;
}

export const api = {
  me: () => request<{ user: User | null }>('/auth/me'),
  signup: (email: string, password: string) =>
    request<{ user: User }>('/auth/signup', { method: 'POST', json: { email, password, timezone: timezone() } }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', json: { email, password, timezone: timezone() } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  folders: () => request<{ folders: FolderWithStats[] }>('/folders'),
  createFolder: (body: { name: string; parent_id?: number | null; color?: string; new_per_day?: number | null }) =>
    request<{ folder: Folder }>('/folders', { method: 'POST', json: body }),
  updateFolder: (id: number, body: Partial<Pick<Folder, 'name' | 'parent_id' | 'color' | 'new_per_day'>>) =>
    request<{ folder: Folder }>(`/folders/${id}`, { method: 'PATCH', json: body }),
  deleteFolder: (id: number) => request(`/folders/${id}`, { method: 'DELETE' }),
  resetFolder: (id: number) => request<{ reset: number }>(`/folders/${id}/reset`, { method: 'POST' }),
  /** Leave `folderIds` out to export everything. */
  exportUrl: (folderIds?: number[]) => (folderIds ? `/api/export.csv?folders=${folderIds.join(',')}` : '/api/export.csv'),

  cards: (folderId: number) => request<{ cards: Card[] }>(`/folders/${folderId}/cards`),
  deepCards: (folderId: number) => request<{ cards: Card[] }>(`/folders/${folderId}/cards?deep=1`),
  search: (q: string) => request<{ cards: Card[] }>(`/cards/search?q=${encodeURIComponent(q)}`),
  createCard: (folderId: number, body: { front: string; back: string }) =>
    request<{ card: Card }>(`/folders/${folderId}/cards`, { method: 'POST', json: body }),
  updateCard: (id: number, body: { front?: string; back?: string; folder_id?: number }) =>
    request<{ card: Card }>(`/cards/${id}`, { method: 'PATCH', json: body }),
  deleteCard: (id: number) => request(`/cards/${id}`, { method: 'DELETE' }),

  uploadImages: (cardId: number, side: 'front' | 'back', files: File[]) => {
    const form = new FormData();
    form.append('side', side);
    for (const f of files) form.append('images', f);
    return request<{ card: Card }>(`/cards/${cardId}/images`, { method: 'POST', body: form });
  },
  deleteImage: (id: number) => request<{ card: Card }>(`/images/${id}`, { method: 'DELETE' }),
  imageUrl: (id: number) => `/api/images/${id}`,

  nextCard: (folderId: number) => request<NextCardResponse>(`/study/${folderId}/next`),
  rate: (folderId: number, cardId: number, rating: Rating) =>
    request<NextCardResponse>(`/study/${folderId}/rate`, { method: 'POST', json: { cardId, rating } }),

  importDryRun: (body: ImportOptions & { cards: { path: string[]; front: string; back: string }[] }) =>
    request<ImportSummary>('/import/dry-run', { method: 'POST', json: body }),
  importCommit: (body: ImportOptions & { cards: { path: string[]; front: string; back: string }[] }) =>
    request<ImportSummary>('/import', { method: 'POST', json: body }),
  apkgAnalyze: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ApkgAnalysis>('/import/apkg/analyze', { method: 'POST', body: form });
  },
  apkgPreview: (settings: ApkgSettings, shift: number) =>
    request<{ samples: ApkgSample[]; stats: ApkgStats }>('/import/apkg/preview', { method: 'POST', json: { ...settings, shift } }),
  apkgDryRun: (settings: ApkgSettings, options: ImportOptions) =>
    request<ImportSummary & { stats: ApkgStats }>('/import/apkg/dry-run', { method: 'POST', json: { ...settings, options } }),
  apkgCommit: (settings: ApkgSettings, options: ImportOptions) =>
    request<ImportSummary & { stats: ApkgStats }>('/import/apkg/commit', { method: 'POST', json: { ...settings, options } }),

  notesStatus: () => request<NotesStatus>('/notes/status'),
  notesGenerate: (form: FormData) => request<{ jobId: string }>('/notes/generate', { method: 'POST', body: form }),
  notesJob: (id: string) => request<NotesJob>(`/notes/jobs/${id}`),
  notesCancel: (id: string) => request<{ ok: boolean }>(`/notes/jobs/${id}`, { method: 'DELETE' }),

  ownerMe: () => request<{ admin: boolean }>('/owner/me'),
  ownerOverview: () => request<OwnerOverview>('/owner/overview'),
  ownerUsers: () => request<{ users: OwnerUser[]; total: number; truncated: boolean }>('/owner/users'),

  calendar: (year: number, month: number) =>
    request<{ days: Record<number, number>; reviewedToday: number }>(`/stats/calendar?year=${year}&month=${month}`),
};
