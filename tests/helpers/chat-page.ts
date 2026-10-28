import { vi } from 'vitest';

import type { ChatDomain } from '@/lib/chat/conversations';
import type {
  ChatReplyView,
  ChatStatusView,
  ConversationSummary,
  StoredMessageView,
} from '@/features/chat/types';

/**
 * 챗봇 화면(UX PR-C2) 단위 테스트용 가짜 서버 — fetch 를 대신해 PR-C1 라우트 계약(봉투 `{ ok, data }`·`{ ok:false, error }`)만 흉내 낸다.
 * 대화는 메모리에 두고, POST /api/chat 은 테스트가 넘긴 `chat` 처리기로 답한다(JSON·SSE·오류). 합성 데이터만.
 */
export type FakeConversation = ConversationSummary & { messages: StoredMessageView[] };

export type ChatCall = {
  body: { message: string; conversationId?: string; domain?: ChatDomain; history?: unknown };
  accept: string | null;
  signal: AbortSignal | undefined;
};

export type ChatHandler = (call: ChatCall) => Promise<Response> | Response;

const encoder = new TextEncoder();

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** 청크를 차례로 보내는 SSE 응답. gates[i] 가 있으면 i 번째 청크 전에 기다린다. signal 이 abort 되면 스트림을 오류로 끝낸다 */
export function sseResponse(
  chunks: string[],
  options: { gates?: (Promise<void> | undefined)[]; signal?: AbortSignal } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
      options.signal?.addEventListener('abort', abort);
      try {
        for (const [index, chunk] of chunks.entries()) {
          await options.gates?.[index];
          if (options.signal?.aborted) return;
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch {
        // abort 뒤 enqueue·close 는 무시
      }
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

export function reply(partial: Partial<ChatReplyView> = {}): ChatReplyView {
  return {
    intent: 'price',
    reply: '답변',
    candidates: [],
    showProductChips: false,
    action: null,
    ...partial,
  };
}

export const LLM_READY = { status: 'ready', vendor: 'anthropic', model: 'm' };
export const MISSING_MESSAGE = 'LLM API 키가 등록되지 않았습니다. 사용자 설정에서 등록하세요.';

export function statusView(kind: 'ready' | 'missing'): ChatStatusView {
  return kind === 'ready'
    ? { llm: LLM_READY, ruleFallback: true }
    : {
        llm: { status: 'missing', vendor: null, model: null },
        ruleFallback: true,
        setup: { status: 'missing', message: MISSING_MESSAGE, href: '/settings#llm' },
      };
}

let idSeq = 0;
export const uuid = () => `00000000-0000-4000-8000-${String((idSeq += 1)).padStart(12, '0')}`;

export function conversation(partial: Partial<FakeConversation> = {}): FakeConversation {
  return {
    id: uuid(),
    domain: 'pricing',
    title: '합성 대화',
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    messages: [],
    ...partial,
  };
}

export type FakeServer = ReturnType<typeof createFakeServer>;

/**
 * fetch 대역 설치. options.list 를 주면 목록 응답을 그 Promise 가 끝날 때까지 미룬다(스켈레톤 관찰).
 * calls 로 요청 기록을 본다.
 */
export function createFakeServer(
  fetchMock: ReturnType<typeof vi.fn>,
  options: {
    conversations?: FakeConversation[];
    status?: ChatStatusView;
    chat?: ChatHandler;
    listGate?: Promise<void>;
    failCreate?: { status: number; message: string };
  } = {},
) {
  const state = {
    conversations: [...(options.conversations ?? [])],
    status: options.status ?? statusView('missing'),
    chat: options.chat ?? (() => json({ ok: true, data: reply() })),
  };
  const calls: { method: string; url: string; body: unknown }[] = [];
  const chatCalls: ChatCall[] = [];

  fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, body });
    if (url === '/api/chat/status') return json({ ok: true, data: state.status });
    if (url === '/api/chat' && method === 'POST') {
      const headers = new Headers(init.headers);
      const call = {
        body: body as ChatCall['body'],
        accept: headers.get('accept'),
        signal: init.signal ?? undefined,
      };
      chatCalls.push(call);
      // 서버처럼: 첫 질문 앞 30자 자동 제목 + 최근 활동 갱신
      const target = state.conversations.find((item) => item.id === call.body.conversationId);
      if (target) {
        if (target.title === null) target.title = call.body.message.slice(0, 30);
        target.updatedAt = new Date().toISOString();
      }
      return state.chat(call);
    }
    const listMatch = /^\/api\/chat\/conversations\?domain=(\w+)$/.exec(url);
    if (listMatch && method === 'GET') {
      await options.listGate;
      const rows = state.conversations
        .filter((item) => item.domain === listMatch[1])
        .map(({ messages, ...summary }) => (void messages, summary));
      return json({ ok: true, data: rows });
    }
    if (url === '/api/chat/conversations' && method === 'POST') {
      if (options.failCreate)
        return json(
          { ok: false, error: { code: 'CONFLICT', message: options.failCreate.message } },
          options.failCreate.status,
        );
      const created = conversation({
        domain: (body as { domain: ChatDomain }).domain,
        title: null,
        updatedAt: new Date().toISOString(),
      });
      state.conversations.unshift(created);
      const { messages, ...summary } = created;
      void messages;
      return json({ ok: true, data: summary }, 201);
    }
    const itemMatch = /^\/api\/chat\/conversations\/([^/?]+)$/.exec(url);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]!);
      const found = state.conversations.find((item) => item.id === id);
      if (!found)
        return json(
          { ok: false, error: { code: 'NOT_FOUND', message: '대화를 찾을 수 없습니다' } },
          404,
        );
      if (method === 'GET') return json({ ok: true, data: found });
      if (method === 'PATCH') {
        const title = String((body as { title: unknown }).title).trim();
        if (title.length > 100)
          return json(
            {
              ok: false,
              error: { code: 'VALIDATION', message: '대화 이름은 100자까지 입력할 수 있습니다' },
            },
            400,
          );
        found.title = title;
        const { messages, ...summary } = found;
        void messages;
        return json({ ok: true, data: summary });
      }
      if (method === 'DELETE') {
        state.conversations = state.conversations.filter((item) => item.id !== id);
        return json({ ok: true, data: { id, domain: found.domain } });
      }
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });

  return {
    state,
    calls,
    chatCalls,
    /** 서버 쪽에서 첫 질문 → 자동 제목처럼 바꿔 둔다(목록 다시 읽기 확인용) */
    setTitle(id: string, title: string | null) {
      const found = state.conversations.find((item) => item.id === id);
      if (found) found.title = title;
    },
    count: (method: string, pattern: RegExp) =>
      calls.filter((call) => call.method === method && pattern.test(call.url)).length,
  };
}
