'use client';

import type { ChatDomain } from '@/lib/chat/conversations';

import { CONNECT_ERROR } from './chatStream';
import type { ConversationDetailView, ConversationSummary } from './types';

/**
 * 저장 대화 API 클라이언트 (UX PR-C1 라우트 — 소유자 전용, 남의·없는 대화 404). 같은 출처 fetch, no-store.
 * 결과는 봉투를 풀어 `{ ok, data }` 또는 `{ ok: false, status, message }`(서버 문구 그대로)로 돌려준다.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const BASE = '/api/chat/conversations';

async function call<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const body = (await response.json()) as
      { ok: true; data: T } | { ok: false; error?: { message?: string } };
    if (body.ok) return { ok: true, data: body.data };
    return { ok: false, status: response.status, message: body.error?.message ?? CONNECT_ERROR };
  } catch {
    return { ok: false, status: 0, message: CONNECT_ERROR };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const itemUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export function fetchConversations(domain: ChatDomain) {
  return call<ConversationSummary[]>(`${BASE}?domain=${domain}`);
}

export function fetchConversation(id: string, signal?: AbortSignal) {
  return call<ConversationDetailView>(itemUrl(id), { signal });
}

export function createConversation(domain: ChatDomain) {
  return call<ConversationSummary>(BASE, json('POST', { domain }));
}

export function renameConversation(id: string, title: string) {
  return call<ConversationSummary>(itemUrl(id), json('PATCH', { title }));
}

export function deleteConversation(id: string) {
  return call<{ id: string; domain: ChatDomain }>(itemUrl(id), { method: 'DELETE' });
}
