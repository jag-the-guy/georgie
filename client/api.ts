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
  exportUrl: '/api/export.csv',

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

  calendar: (year: number, month: number) =>
    request<{ days: Record<number, number>; reviewedToday: number }>(`/stats/calendar?year=${year}&month=${month}`),
};
