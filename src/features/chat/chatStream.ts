'use client';

import type { ChatHistoryItem, ChatReplyView } from './types';

/**
 * 챗봇 SSE 클라이언트 (PRAMI-002 §4.3.9, PR-C): `Accept: text/event-stream` 으로 요청하고 token·status·final·done 을 점진적으로 전달한다.
 * `final` 이 정본 — 토큰으로 그린 텍스트를 교체한다(출력 가드가 바꿀 수 있음). `discard` 는 거부 전 부분 출력을 즉시 비운다. 서버가 JSON 으로 답하면(규칙 전용 배포 등) JSON 으로 처리한다.
 * 같은 출처 fetch 만 쓴다(CSP connect-src 'self' 유지). 중단은 AbortSignal.
 */
export type StreamHandlers = {
  onToken: (text: string) => void;
  onStatus: (label: string) => void;
  /** 벤더 거부로 서버가 부분 출력 폐기를 알림 (event: discard, QA L-1) — 그린 텍스트를 즉시 비운다 */
  onDiscard: () => void;
};

export type AskResult = { ok: true; data: ChatReplyView } | { ok: false; message: string };

export const CONNECT_ERROR = '챗봇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.';
export const STREAM_ERROR = '답변을 받는 중 오류가 발생했습니다. 다시 시도해주세요.';
export const STREAM_ABORTED = '답변을 중단했습니다.';

type SseEvent = { event: string; data: unknown };

/** 버퍼에서 완성된 이벤트 블록(빈 줄로 끝나는)만 꺼낸다 */
export function takeSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
      const raw = /^data: (.*)$/m.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(raw) as unknown };
    });
  return { events, rest };
}

async function readJson(response: Response): Promise<AskResult> {
  const json = (await response.json()) as
    { ok: true; data: ChatReplyView } | { ok: false; error: { message: string } };
  return json.ok ? json : { ok: false, message: json.error.message };
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<AskResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: ChatReplyView | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const taken = takeSseEvents(buffer);
    buffer = taken.rest;
    for (const { event, data } of taken.events) {
      if (event === 'token') handlers.onToken((data as { text: string }).text);
      else if (event === 'status') handlers.onStatus((data as { label: string }).label);
      else if (event === 'discard') handlers.onDiscard();
      else if (event === 'final') final = data as ChatReplyView;
      else if (event === 'error') return { ok: false, message: STREAM_ERROR };
    }
  }
  return final ? { ok: true, data: final } : { ok: false, message: STREAM_ERROR };
}

export async function askChatStream(
  message: string,
  history: ChatHistoryItem[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<AskResult> {
  try {
    const body = history.length > 0 ? { message, history } : { message };
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
    const type = response.headers?.get?.('content-type') ?? '';
    if (!type.includes('text/event-stream') || !response.body) return await readJson(response);
    return await readStream(response.body, handlers);
  } catch {
    return { ok: false, message: signal.aborted ? STREAM_ABORTED : CONNECT_ERROR };
  }
}
