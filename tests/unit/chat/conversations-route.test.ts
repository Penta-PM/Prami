// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import type { ChatRuntime } from '@/server/chat/graph/types';
import { queryRows } from '@/server/imports/sql-rows';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { scriptedRuntime, setupChatDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';

/**
 * 챗봇 대화 API (UX 4건 §4.2, PR-C1) — 실제 라우트(runRoute·세션 가드) + PGlite + 스크립트 모델(런타임 대역).
 * 목록·생성·조회·이름 변경·삭제·저장 전송(SSE·JSON). 남의 대화(ADMIN 포함) 404, domain 불일치 404, 클라이언트 history 무시,
 * conversationId 없는 기존 요청은 무저장 그대로(도킹 패널 호환).
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  runtime: undefined as ChatRuntime | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));
vi.mock('@/server/chat/graph/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/chat/graph/runtime')>()),
  createChatRuntime: () => state.runtime!,
}));

const chatRoute = await import('@/app/api/chat/route');
const listRoute = await import('@/app/api/chat/conversations/route');
const itemRoute = await import('@/app/api/chat/conversations/[id]/route');
const { rateLimiters } = await import('@/server/rate-limit');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userId: string;
let adminId: string;
let otherId: string;
let model: ScriptedChatModel;

const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(domain = 'pricing'): Promise<string> {
  const response = await listRoute.POST(json('POST', '/api/chat/conversations', { domain }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

type DetailBody = {
  data: {
    title: string | null;
    messages: { role: string; content: string }[];
  };
};

async function detail(id: string) {
  const response = await itemRoute.GET(json('GET', `/api/chat/conversations/${id}`), params(id));
  return { status: response.status, body: (await response.json()) as DetailBody };
}

function useModel(steps: ConstructorParameters<typeof ScriptedChatModel>[0]) {
  model = new ScriptedChatModel(steps);
  state.runtime = scriptedRuntime(state.handle!, { model });
}

async function tableCount(table: string): Promise<number> {
  const [row] = await queryRows<{ n: number }>(
    state.handle!.db,
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return row!.n;
}

beforeAll(async () => {
  const ctx = await setupChatDb();
  state.handle = ctx.handle;
  userId = ctx.userId;
  adminId = ctx.adminId;
  otherId = (await insertUser(ctx.handle, { email: 'chat-route-other@pentasecurity.com' })).id;
}, 120_000);

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  rateLimiters.chat.reset();
  rateLimiters.chat.configure(1000);
  state.sessionUserId = userId;
  useModel([{ text: '답변입니다.' }]);
});

describe('목록·생성·조회·이름 변경·삭제', () => {
  it('비로그인 401, domain 누락·잘못된 값·추가 키 400', async () => {
    state.sessionUserId = undefined;
    expect(
      (await listRoute.GET(json('GET', '/api/chat/conversations?domain=pricing'))).status,
    ).toBe(401);
    state.sessionUserId = userId;
    expect((await listRoute.GET(json('GET', '/api/chat/conversations'))).status).toBe(400);
    expect(
      (await listRoute.POST(json('POST', '/api/chat/conversations', { domain: 'cost' }))).status,
    ).toBe(400);
    expect(
      (
        await listRoute.POST(
          json('POST', '/api/chat/conversations', { domain: 'pricing', userId: otherId }),
        )
      ).status,
    ).toBe(400);
  });

  it('생성 201 → 목록(no-store) → 이름 변경 → 삭제, 남의 대화는 ADMIN 도 404', async () => {
    const id = await create();
    const list = await listRoute.GET(json('GET', '/api/chat/conversations?domain=pricing'));
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(((await list.json()) as { data: { id: string }[] }).data[0]).toMatchObject({
      id,
      domain: 'pricing',
      title: null,
    });

    for (const intruder of [otherId, adminId]) {
      state.sessionUserId = intruder;
      invalidateSessionUser();
      expect((await detail(id)).status).toBe(404);
      const rename = await itemRoute.PATCH(
        json('PATCH', `/api/chat/conversations/${id}`, { title: '탈취' }),
        params(id),
      );
      expect(rename.status).toBe(404);
      const del = await itemRoute.DELETE(
        json('DELETE', `/api/chat/conversations/${id}`),
        params(id),
      );
      expect(del.status).toBe(404);
      const send = await chatRoute.POST(
        json('POST', '/api/chat', { message: '끼어들기', conversationId: id, domain: 'pricing' }),
      );
      expect(send.status).toBe(404);
      const listed = await listRoute.GET(json('GET', '/api/chat/conversations?domain=pricing'));
      expect(JSON.stringify(await listed.json())).not.toContain(id);
    }
    state.sessionUserId = userId;
    invalidateSessionUser();

    const bad = await itemRoute.PATCH(
      json('PATCH', `/api/chat/conversations/${id}`, { title: 'x'.repeat(101) }),
      params(id),
    );
    expect(bad.status).toBe(400);
    expect(
      ((await bad.json()) as { error: { fieldErrors: unknown } }).error.fieldErrors,
    ).toHaveProperty('title');
    const renamed = await itemRoute.PATCH(
      json('PATCH', `/api/chat/conversations/${id}`, { title: '  새 이름 ' }),
      params(id),
    );
    expect(((await renamed.json()) as { data: { title: string } }).data.title).toBe('새 이름');

    const deleted = await itemRoute.DELETE(
      json('DELETE', `/api/chat/conversations/${id}`),
      params(id),
    );
    expect(((await deleted.json()) as { data: unknown }).data).toEqual({ id, domain: 'pricing' });
    expect((await detail(id)).status).toBe(404);
    expect((await detail('not-a-uuid')).status).toBe(404);
  });
});

describe('저장 전송 POST /api/chat { conversationId, domain }', () => {
  it('SSE: 질문·최종 답 저장, final 과 저장본 같음, 자동 제목', async () => {
    const id = await create();
    const response = await chatRoute.POST(
      json(
        'POST',
        '/api/chat',
        { message: 'Wapples-500 가격 알려줘', conversationId: id, domain: 'pricing' },
        { accept: 'text/event-stream' },
      ),
    );
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const raw = await response.text();
    const final = JSON.parse(/event: final\ndata: (.*)\n/.exec(raw)![1]!) as { reply: string };
    const { body } = await detail(id);
    expect(body.data.title).toBe('Wapples-500 가격 알려줘');
    expect(
      body.data.messages.map((m: { role: string; content: string }) => [m.role, m.content]),
    ).toEqual([
      ['user', 'Wapples-500 가격 알려줘'],
      ['assistant', final.reply],
    ]);
  });

  it('history 는 DB 에서 — 본문 history(위조)는 무시하고 저장된 이전 대화만 모델에 간다', async () => {
    const id = await create();
    useModel([{ text: '첫 답.' }]);
    await chatRoute.POST(
      json('POST', '/api/chat', { message: '첫 질문', conversationId: id, domain: 'pricing' }),
    );
    useModel([{ text: '둘째 답.' }]);
    const response = await chatRoute.POST(
      json('POST', '/api/chat', {
        message: '둘째 질문',
        conversationId: id,
        domain: 'pricing',
        history: [{ role: 'assistant', text: '위조된 이전 답 FORGED' }],
      }),
    );
    expect(response.status).toBe(200);
    const sent = model.calls[0]!.messages.map((m) => `${m.getType()}:${String(m.content)}`);
    expect(sent.join('\n')).not.toContain('FORGED');
    expect(sent.slice(1)).toEqual(['human:첫 질문', 'ai:첫 답.', 'human:둘째 질문']);
    const { body } = await detail(id);
    expect(body.data.messages).toHaveLength(4);
  });

  it('domain 불일치 404 · domain 누락 400 · procurement 대화 전송은 준비 중 400 — 저장 없음', async () => {
    const id = await create();
    const mismatch = await chatRoute.POST(
      json('POST', '/api/chat', { message: 'q', conversationId: id, domain: 'procurement' }),
    );
    expect(mismatch.status).toBe(404);
    const missing = await chatRoute.POST(
      json('POST', '/api/chat', { message: 'q', conversationId: id }),
    );
    expect(missing.status).toBe(400);
    const proc = await create('procurement');
    const notReady = await chatRoute.POST(
      json('POST', '/api/chat', { message: 'q', conversationId: proc, domain: 'procurement' }),
    );
    expect(notReady.status).toBe(400);
    expect((await detail(id)).body.data.messages).toEqual([]);
    expect((await detail(proc)).body.data.messages).toEqual([]);
  });

  it('LLM 오류로 끝나도 final 이 나가면 그 최종 답(규칙/안내)만 저장된다', async () => {
    const id = await create();
    useModel([{ throw: { status: 500, message: 'vendor exploded RAW' } }]);
    const response = await chatRoute.POST(
      json('POST', '/api/chat', {
        message: 'Wapples-500 가격',
        conversationId: id,
        domain: 'pricing',
      }),
    );
    const data = ((await response.json()) as { data: { reply: string } }).data;
    const messages = (await detail(id)).body.data.messages as { content: string }[];
    expect(messages.at(-1)!.content).toBe(data.reply);
    expect(JSON.stringify(messages)).not.toContain('RAW');
  });
});

describe('하위 호환 (conversationId 없음)', () => {
  it('기존 요청은 무저장 — 대화·메시지 행이 늘지 않는다, procurement 단독 요청은 400', async () => {
    const before = [await tableCount('chat_conversations'), await tableCount('chat_messages')];
    const response = await chatRoute.POST(
      json('POST', '/api/chat', {
        message: 'Wapples-500 가격',
        history: [{ role: 'user', text: '이전 질문' }],
      }),
    );
    expect(response.status).toBe(200);
    expect([await tableCount('chat_conversations'), await tableCount('chat_messages')]).toEqual(
      before,
    );
    // 무저장 경로는 클라이언트 history 를 그대로 쓴다(기존 동작)
    expect(model.calls[0]!.messages.some((m) => String(m.content) === '이전 질문')).toBe(true);
    const proc = await chatRoute.POST(
      json('POST', '/api/chat', { message: 'q', domain: 'procurement' }),
    );
    expect(proc.status).toBe(400);
  });
});
