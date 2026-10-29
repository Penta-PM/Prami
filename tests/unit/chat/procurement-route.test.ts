// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import type { ChatRuntime } from '@/server/chat/graph/types';

import { ScriptedChatModel, type ScriptStep } from '../../fixtures/chat/scripted-model';
import { scriptedRuntime, setupChatDb } from '../../helpers/chat';
import { auditByAction } from '../../helpers/pglite';
import { seedProcurementChat } from '../../helpers/procurement-chat';

/**
 * 조달 챗봇 전송 (UX 4건 §7 C3, PR-C3) — 실제 라우트(runRoute·세션 가드) + PGlite(합성 조달 픽스처) + 스크립트 모델.
 * - 조달 대화 전송 = 조달 도구 그래프(SSE status·final), 저장은 가드 통과 최종 텍스트뿐(도구 원본 JSON 없음)
 * - 같은 사용자의 가격 대화에는 조달 도구가 노출되지 않는다
 * - procurement.read 를 잃으면 메뉴(사이드바 항목)·화면(requirePagePermission)·API(목록·생성·조회·전송) 모두 거부, 대화는 남는다
 *   (현재 역할 매트릭스는 USER·ADMIN 모두 procurement.read — 권한 상실은 hasPermission 대역으로 만든다)
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  runtime: undefined as ChatRuntime | undefined,
  denyProcurement: false,
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
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/constants/permissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/constants/permissions')>();
  return {
    ...original,
    hasPermission: (role: Parameters<typeof original.hasPermission>[0], key: string) =>
      state.denyProcurement && key === 'procurement.read'
        ? false
        : original.hasPermission(role, key as Parameters<typeof original.hasPermission>[1]),
  };
});

const chatRoute = await import('@/app/api/chat/route');
const listRoute = await import('@/app/api/chat/conversations/route');
const itemRoute = await import('@/app/api/chat/conversations/[id]/route');
const { rateLimiters } = await import('@/server/rate-limit');
const { invalidateSessionUser } = await import('@/server/auth/session-user');
const { requirePagePermission } = await import('@/server/auth/rbac');
const { AUDIT_ACTIONS } = await import('@/server/audit/log');
const { getProcurementNavItems, navVisibility } = await import('@/features/shell/nav');

let userId: string;
let model: ScriptedChatModel;

const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function useModel(steps: ScriptStep[]) {
  model = new ScriptedChatModel(steps);
  state.runtime = scriptedRuntime(state.handle!, { model });
}

async function create(domain: string): Promise<string> {
  const response = await listRoute.POST(json('POST', '/api/chat/conversations', { domain }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

type Detail = { data: { messages: { role: string; content: string; action: unknown }[] } };

async function detail(id: string) {
  const response = await itemRoute.GET(json('GET', `/api/chat/conversations/${id}`), params(id));
  return { status: response.status, body: (await response.json()) as Detail };
}

function sseEvents(raw: string): { event: string; data: unknown }[] {
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine!.replace('event: ', ''),
        data: JSON.parse(dataLine!.replace('data: ', '')) as unknown,
      };
    });
}

beforeAll(async () => {
  const ctx = await setupChatDb();
  state.handle = ctx.handle;
  userId = ctx.userId;
  await seedProcurementChat(ctx.handle);
}, 120_000);

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  rateLimiters.chat.reset();
  rateLimiters.chat.configure(1000);
  state.sessionUserId = userId;
  state.denyProcurement = false;
  useModel([{ text: '답변입니다.' }]);
});

describe('조달 대화 전송', () => {
  it('SSE: 조달 도구 상태 → final, 저장 = 질문 + 가드 통과 최종 텍스트(도구 원본 없음)', async () => {
    const id = await create('procurement');
    useModel([
      {
        toolCalls: [
          {
            name: 'procurement_bid_search',
            args: {
              query: null,
              product: 'WAPPLES',
              includeClosed: false,
              topGradeOnly: false,
              deadlineWithinDays: 7,
              sort: 'deadline',
            },
          },
        ],
      },
      { text: '7일 안에 마감되는 WAPPLES 입찰 공고는 1건이며 배정예산은 12억 3,400만원입니다.' },
    ]);
    const response = await chatRoute.POST(
      json(
        'POST',
        '/api/chat',
        { message: '이번 주 마감 입찰 공고 알려줘', conversationId: id, domain: 'procurement' },
        { accept: 'text/event-stream' },
      ),
    );
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    expect(events).toContainEqual({ event: 'status', data: { label: '입찰 공고 검색 중' } });
    const final = events.find((event) => event.event === 'final')!.data as {
      reply: string;
      mode: string;
    };
    expect(final).toMatchObject({
      mode: 'llm',
      reply: '7일 안에 마감되는 WAPPLES 입찰 공고는 1건이며 배정예산은 12억 3,400만원입니다.',
    });
    expect(model.calls[0]!.tools).toEqual([
      'procurement_performance_summary',
      'procurement_item_search',
      'procurement_bid_search',
      'procurement_delivery_search',
    ]);
    const { body } = await detail(id);
    expect(body.data.messages.map((m) => [m.role, m.content, m.action])).toEqual([
      ['user', '이번 주 마감 입찰 공고 알려줘', null],
      ['assistant', final.reply, null],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/fitReasons|bidNo|CHAT-B-|\[시스템 지시\]/);
  });

  it('같은 사용자의 가격 대화에는 조달 도구가 노출되지 않고, 조달 도구 이름을 불러도 실행되지 않는다', async () => {
    const id = await create('pricing');
    useModel([
      {
        toolCalls: [
          {
            name: 'procurement_item_search',
            args: { query: 'CHAT', product: null },
          },
        ],
      },
      { text: '확인할 수 없습니다.' },
    ]);
    const response = await chatRoute.POST(
      json('POST', '/api/chat', { message: '조달 품목', conversationId: id, domain: 'pricing' }),
    );
    expect(response.status).toBe(200);
    expect(model.calls[0]!.tools.some((name) => name.startsWith('procurement_'))).toBe(false);
    const toolMessage = model.calls[1]!.messages.at(-1)!;
    expect(String(toolMessage.content)).toContain('사용할 수 없습니다');
    expect(String(toolMessage.content)).not.toContain('CHAT-W-');
  });

  it('무저장 경로(conversationId 없음)는 pricing 그래프 — 조달 도구 없음', async () => {
    const response = await chatRoute.POST(json('POST', '/api/chat', { message: '입찰 공고' }));
    expect(response.status).toBe(200);
    expect(model.calls[0]!.tools.some((name) => name.startsWith('procurement_'))).toBe(false);
  });
});

describe('procurement.read 권한 상실 — 메뉴·화면·API 모두 거부, 대화는 지우지 않음', () => {
  it('메뉴: 조달 섹션(조달 챗봇 포함)이 사라진다', () => {
    expect(
      getProcurementNavItems(navVisibility('USER')).some(
        (item) => item.href === '/procurement/chat',
      ),
    ).toBe(true);
    state.denyProcurement = true;
    expect(getProcurementNavItems(navVisibility('USER'))).toEqual([]);
  });

  it('화면: requirePagePermission(procurement.read) 이 감사 denied 후 / 로 보낸다', async () => {
    state.denyProcurement = true;
    await expect(requirePagePermission('procurement.read', '/procurement/chat')).rejects.toThrow(
      'NEXT_REDIRECT:/',
    );
    expect(
      (await auditByAction(state.handle!, AUDIT_ACTIONS.accessDenied)).some(
        (row) => row.result === 'denied' && row.targetId === '/procurement/chat',
      ),
    ).toBe(true);
  });

  it('API: 목록·생성·조회·전송 403, 가격 대화는 그대로, 권한이 돌아오면 대화가 남아 있다', async () => {
    const id = await create('procurement');
    state.denyProcurement = true;
    invalidateSessionUser();
    expect(
      (await listRoute.GET(json('GET', '/api/chat/conversations?domain=procurement'))).status,
    ).toBe(403);
    expect(
      (await listRoute.POST(json('POST', '/api/chat/conversations', { domain: 'procurement' })))
        .status,
    ).toBe(403);
    expect((await detail(id)).status).toBe(403);
    const send = await chatRoute.POST(
      json('POST', '/api/chat', {
        message: '입찰 공고',
        conversationId: id,
        domain: 'procurement',
      }),
    );
    expect(send.status).toBe(403);
    expect(model.calls).toHaveLength(0);
    // 전송 거부도 감사 denied (행위 = chat.ask) — 트랜잭션 롤백 뒤 기록
    expect(
      (await auditByAction(state.handle!, chatRoute.AUDIT_CHAT_ASK)).filter(
        (row) => row.result === 'denied',
      ),
    ).toHaveLength(1);
    expect(
      (await listRoute.GET(json('GET', '/api/chat/conversations?domain=pricing'))).status,
    ).toBe(200);

    state.denyProcurement = false;
    invalidateSessionUser();
    const restored = await detail(id);
    expect(restored.status).toBe(200);
    expect(restored.body.data.messages).toEqual([]);
  });
});
