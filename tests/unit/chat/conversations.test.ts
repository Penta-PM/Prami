// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, chatConversations, chatMessages, users } from '@/db/schema';
import {
  autoTitle,
  CHAT_CONVERSATION_MAX,
  CHAT_MESSAGE_MAX,
  normalizeTitle,
} from '@/lib/chat/conversations';
import type { PermissionKey } from '@/lib/constants/permissions';
import {
  AUDIT_CHAT_CONVERSATION_CREATE,
  AUDIT_CHAT_CONVERSATION_DELETE,
  AUDIT_CHAT_CONVERSATION_RENAME,
  beginTurn,
  completeTurn,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  storedAction,
  type ChatOwner,
} from '@/server/chat/conversations';
import { buildChatGraph } from '@/server/chat/graph/build';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut } from '@/server/chat/graph/types';
import { queryRows } from '@/server/imports/sql-rows';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { scriptedRuntime, setupChatDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';

/**
 * 챗봇 대화 저장 (UX 4건 §4.2, PR-C1) — 저장소 규칙. PGlite, 합성 데이터만.
 * 소유자 전용(남·ADMIN → 404), 상한 200/400, domain 불일치 거부, DB history(최근 N·1,000자), 자동 제목 30자, 이름 검증,
 * 완전 삭제 CASCADE, 감사 내용 없음, 가드 통과 최종 답·액션만 저장, procurement.read 검사.
 */
let handle: DbHandle;
let userA: string;
let userB: string;
let adminId: string;

const META = { ip: null, userAgent: 'vitest' };

function owner(userId: string, deny: PermissionKey[] = []): ChatOwner & { denials: string[] } {
  const denials: string[] = [];
  return {
    userId,
    label: `${userId.slice(0, 8)}@pentasecurity.com`,
    can: (key) => !deny.includes(key),
    denied: async (key) => {
      denials.push(key);
    },
    denials,
  };
}

const ctx = (o: ChatOwner) => ({ handle, owner: o, meta: META });

const begin = (
  o: ChatOwner,
  conversationId: string,
  message: string,
  domain = 'pricing' as const,
) => beginTurn(handle, o, { conversationId, domain, message, historyMaxTurns: 10 });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? 'THROWN';
  }
}

beforeAll(async () => {
  const setup = await setupChatDb();
  handle = setup.handle;
  userA = setup.userId;
  adminId = setup.adminId;
  userB = (await insertUser(handle, { email: 'chat-b@pentasecurity.com', role: 'USER' })).id;
}, 120_000);

afterAll(async () => {
  await handle?.close();
});

describe('순수 규칙', () => {
  it('자동 제목 = 첫 질문 앞 30자(공백 정리, 코드 포인트), 빈 질문은 null', () => {
    const long = '가'.repeat(40);
    expect(autoTitle(long)).toBe('가'.repeat(30));
    expect(autoTitle('  Wapples-500\n  가격  ')).toBe('Wapples-500 가격');
    expect(autoTitle('😀'.repeat(31))).toBe('😀'.repeat(30));
    expect(autoTitle('   ')).toBeNull();
  });

  it('이름 검증: 앞뒤 공백 제거 1~100자', () => {
    expect(normalizeTitle('  새 이름  ')).toEqual({ ok: true, title: '새 이름' });
    expect(normalizeTitle('x'.repeat(100))).toEqual({ ok: true, title: 'x'.repeat(100) });
    expect(normalizeTitle('x'.repeat(101)).ok).toBe(false);
    expect(normalizeTitle('   ').ok).toBe(false);
    expect(normalizeTitle(42).ok).toBe(false);
  });

  it('저장 액션은 서버 링크 세 필드·앱 내부 경로만', () => {
    expect(
      storedAction({ type: 'calculator', href: '/calculator?item=P1', label: '계산기에서 열기' }),
    ).toEqual({ type: 'calculator', href: '/calculator?item=P1', label: '계산기에서 열기' });
    const extra = { type: 'calculator', href: '/c', label: 'l', raw: 'x' } as never;
    expect(storedAction(extra)).toEqual({ type: 'calculator', href: '/c', label: 'l' });
    expect(
      storedAction({ type: 'calculator', href: 'https://evil.example', label: 'l' }),
    ).toBeNull();
    expect(storedAction({ type: 'calculator', href: '//evil.example', label: 'l' })).toBeNull();
    expect(storedAction(null)).toBeNull();
  });
});

describe('소유자 전용 (남의 대화·ADMIN → NOT_FOUND)', () => {
  it('목록·조회·이름 변경·삭제·전송 모두 본인 것만', async () => {
    const a = owner(userA);
    const mine = await createConversation(ctx(a), { domain: 'pricing' });
    await begin(a, mine.id, '내 질문');
    for (const other of [owner(userB), owner(adminId)]) {
      expect((await listConversations(handle.db, other, 'pricing')).map((c) => c.id)).not.toContain(
        mine.id,
      );
      expect(await codeOf(getConversation(handle.db, other, mine.id))).toBe('NOT_FOUND');
      expect(await codeOf(renameConversation(ctx(other), mine.id, { title: '탈취' }))).toBe(
        'NOT_FOUND',
      );
      expect(await codeOf(deleteConversation(ctx(other), mine.id))).toBe('NOT_FOUND');
      expect(await codeOf(begin(other, mine.id, '끼어들기'))).toBe('NOT_FOUND');
    }
    // 잘못된 id 도 404 (DB 캐스트 오류 아님)
    expect(await codeOf(getConversation(handle.db, a, 'not-a-uuid'))).toBe('NOT_FOUND');
    const detail = await getConversation(handle.db, a, mine.id);
    expect(detail.title).toBe('내 질문');
    expect(detail.messages.map((m) => m.content)).toEqual(['내 질문']);
  });

  it('목록은 최근 활동 순, domain 별로 나뉜다', async () => {
    const o = owner(userB);
    const first = await createConversation(ctx(o), { domain: 'pricing' });
    const second = await createConversation(ctx(o), { domain: 'pricing' });
    const proc = await createConversation(ctx(o), { domain: 'procurement' });
    await begin(o, first.id, '나중에 쓴 대화');
    const list = await listConversations(handle.db, o, 'pricing');
    expect(list.map((c) => c.id).slice(0, 2)).toEqual([first.id, second.id]);
    expect(list.map((c) => c.id)).not.toContain(proc.id);
    expect((await listConversations(handle.db, o, 'procurement')).map((c) => c.id)).toEqual([
      proc.id,
    ]);
  });
});

describe('domain·권한', () => {
  it('요청 domain 과 대화 domain 이 다르면 NOT_FOUND, 저장 없음', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    expect(
      await codeOf(
        beginTurn(handle, a, {
          conversationId: conv.id,
          domain: 'procurement',
          message: '도메인 위조',
          historyMaxTurns: 10,
        }),
      ),
    ).toBe('NOT_FOUND');
    expect((await getConversation(handle.db, a, conv.id)).messages).toEqual([]);
  });

  it('procurement 대화는 procurement.read 필요 — 없으면 목록·생성·조회·이름 변경·삭제·전송 FORBIDDEN(+감사 훅), 행은 남는다', async () => {
    const full = owner(userA);
    const conv = await createConversation(ctx(full), { domain: 'procurement' });
    const lost = owner(userA, ['procurement.read']);
    expect(await codeOf(listConversations(handle.db, lost, 'procurement'))).toBe('FORBIDDEN');
    expect(await codeOf(createConversation(ctx(lost), { domain: 'procurement' }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(getConversation(handle.db, lost, conv.id))).toBe('FORBIDDEN');
    expect(await codeOf(renameConversation(ctx(lost), conv.id, { title: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(deleteConversation(ctx(lost), conv.id))).toBe('FORBIDDEN');
    expect(
      await codeOf(
        beginTurn(handle, lost, {
          conversationId: conv.id,
          domain: 'procurement',
          message: 'q',
          historyMaxTurns: 10,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(lost.denials.length).toBe(6);
    expect(lost.denials.every((key) => key === 'procurement.read')).toBe(true);
    // pricing 은 chat.use 만으로
    expect(await codeOf(listConversations(handle.db, lost, 'pricing'))).toBe('OK');
    // 권한을 잃어도 지우지 않는다
    expect((await getConversation(handle.db, full, conv.id)).id).toBe(conv.id);
  });

  it('procurement 대화 전송은 PR-C3 전까지 VALIDATION(준비 중), 저장 없음', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'procurement' });
    expect(
      await codeOf(
        beginTurn(handle, a, {
          conversationId: conv.id,
          domain: 'procurement',
          message: '입찰 공고',
          historyMaxTurns: 10,
        }),
      ),
    ).toBe('VALIDATION');
    expect((await getConversation(handle.db, a, conv.id)).messages).toEqual([]);
  });
});

describe('상한', () => {
  it(`사용자·domain 당 대화 ${CHAT_CONVERSATION_MAX}개 — 초과 생성은 CONFLICT, 다른 domain·다른 사용자는 영향 없음`, async () => {
    const userC = (await insertUser(handle, { email: 'chat-c@pentasecurity.com' })).id;
    await handle.db.insert(chatConversations).values(
      Array.from({ length: CHAT_CONVERSATION_MAX }, () => ({
        userId: userC,
        domain: 'pricing' as const,
      })),
    );
    const c = owner(userC);
    const error = await createConversation(ctx(c), { domain: 'pricing' }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'conversation_limit', max: CHAT_CONVERSATION_MAX },
    });
    expect((error as Error).message).toContain('200');
    expect(await codeOf(createConversation(ctx(c), { domain: 'procurement' }))).toBe('OK');
    expect(await codeOf(createConversation(ctx(owner(userB)), { domain: 'pricing' }))).toBe('OK');
  });

  it(`대화당 메시지 ${CHAT_MESSAGE_MAX}개 — 질문+답이 넘치면 CONFLICT, 질문도 저장하지 않는다`, async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    await handle.db.insert(chatMessages).values(
      Array.from({ length: CHAT_MESSAGE_MAX - 1 }, (_, index) => ({
        conversationId: conv.id,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `m${index}`,
      })),
    );
    const error = await begin(a, conv.id, '넘치는 질문').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CONFLICT', details: { reason: 'message_limit' } });
    expect((await getConversation(handle.db, a, conv.id)).messages).toHaveLength(
      CHAT_MESSAGE_MAX - 1,
    );
  });
});

describe('전송 — DB history·자동 제목·재시도', () => {
  it('history 는 이번 질문 전 최근 10개(시간 순), 항목 1,000자 절단', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    await handle.db.insert(chatMessages).values(
      Array.from({ length: 14 }, (_, index) => ({
        conversationId: conv.id,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: index === 13 ? 'L'.repeat(1500) : `m${index}`,
      })),
    );
    const turn = await begin(a, conv.id, '새 질문');
    expect(turn.history).toHaveLength(10);
    expect(turn.history.map((h) => h.text.slice(0, 3))).toEqual([
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
      'm11',
      'm12',
      'LLL',
    ]);
    expect(turn.history.at(-1)).toEqual({ role: 'assistant', text: 'L'.repeat(1000) });
    expect(turn.history.some((h) => h.text === '새 질문')).toBe(false);
    // 저장본은 절단하지 않는다
    const stored = (await getConversation(handle.db, a, conv.id)).messages;
    expect(stored.at(-2)!.content).toHaveLength(1500);
    expect(stored.at(-1)).toMatchObject({ role: 'user', content: '새 질문' });
  });

  it('자동 제목은 첫 질문에서만, 사용자가 붙인 이름은 덮지 않는다', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    expect(conv.title).toBeNull();
    const question = 'Wapples-500 정상판매 단가와 작년 대비 인상률을 같이 알려 주세요';
    await begin(a, conv.id, question);
    await begin(a, conv.id, '두 번째 질문');
    expect((await getConversation(handle.db, a, conv.id)).title).toBe(autoTitle(question));
    expect(autoTitle(question)).toHaveLength(30);
    const named = await createConversation(ctx(a), { domain: 'pricing' });
    await renameConversation(ctx(a), named.id, { title: '내가 붙인 이름' });
    await begin(a, named.id, '첫 질문');
    expect((await getConversation(handle.db, a, named.id)).title).toBe('내가 붙인 이름');
  });

  it('답 없이 끝난 같은 질문을 다시 보내면 재사용(중복 저장 없음), history 에도 넣지 않는다', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    await begin(a, conv.id, '실패한 질문');
    const retry = await begin(a, conv.id, '실패한 질문');
    expect(retry.reused).toBe(true);
    expect(retry.history).toEqual([]);
    expect((await getConversation(handle.db, a, conv.id)).messages).toHaveLength(1);
  });

  it('스트림 도중 대화가 삭제되면 답을 저장하지 않는다', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    const turn = await begin(a, conv.id, 'q');
    await deleteConversation(ctx(a), conv.id);
    expect(await completeTurn(handle, a, turn.conversationId, { reply: 'r', action: null })).toBe(
      false,
    );
  });
});

describe('저장 내용 = 가드 통과 최종 답 + 액션 (I-6 개정)', () => {
  it('도구 원본 결과·원가 문장(가드 전)은 저장되지 않고 final 과 같은 텍스트만 저장된다', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    const turn = await begin(a, conv.id, 'Wapples-500 가격');
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-500', family: null } }] },
      { text: 'Wapples-500 판매가를 확인했습니다. 참고로 원가는 1,000원입니다.' },
    ]);
    const onFinal = vi.fn(async (reply: ChatReplyOut) => {
      await completeTurn(handle, a, turn.conversationId, reply);
    });
    const raw = await new Response(
      streamChat(
        buildChatGraph(),
        {
          text: 'Wapples-500 가격',
          truncated: false,
          history: turn.history,
          actor: { userId: userA, role: 'USER' },
        },
        scriptedRuntime(handle, { model }),
        undefined,
        { onFinal },
      ),
    ).text();
    expect(onFinal).toHaveBeenCalledTimes(1);
    const final = JSON.parse(/event: final\ndata: (.*)\n/.exec(raw)![1]!) as ChatReplyOut;
    const stored = (await getConversation(handle.db, a, conv.id)).messages;
    expect(stored).toHaveLength(2);
    const answer = stored[1]!;
    expect(answer.role).toBe('assistant');
    expect(answer.content).toBe(final.reply);
    expect(answer.content).not.toContain('1,000원');
    expect(answer.action).toEqual(storedAction(final.action));
    // 행 전체에 도구 결과(JSON 키)·도구 이름·사고 흔적이 없다
    const [row] = await queryRows<{ t: string }>(
      handle.db,
      sql`select row_to_json(m)::text as t from chat_messages m where m.conversation_id = ${conv.id} and m.role = 'assistant'`,
    );
    expect(row!.t).not.toMatch(/price_lookup|unitPrice|unit_price|tool_call|thinking|"candidates"/);
    expect(Object.keys(JSON.parse(row!.t) as object).sort()).toEqual([
      'action',
      'content',
      'conversation_id',
      'created_at',
      'id',
      'role',
    ]);
  });

  it('스트림이 실패하면 onFinal 을 부르지 않는다 (질문만 남음)', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    const turn = await begin(a, conv.id, '중단될 질문');
    const controller = new AbortController();
    const model = new ScriptedChatModel([{ delayMs: 5_000 }]);
    const onFinal = vi.fn(async () => undefined);
    const body = streamChat(
      buildChatGraph(),
      {
        text: '중단될 질문',
        truncated: false,
        history: turn.history,
        actor: { userId: userA, role: 'USER' },
      },
      scriptedRuntime(handle, { model, settings: { ruleFallback: false } }),
      controller.signal,
      { onFinal },
    );
    setTimeout(() => controller.abort(), 50);
    await new Response(body).text();
    expect(onFinal).not.toHaveBeenCalled();
    expect((await getConversation(handle.db, a, conv.id)).messages.map((m) => m.role)).toEqual([
      'user',
    ]);
  });
});

describe('이름 변경·삭제·감사', () => {
  it('이름 변경 검증(400)·감사에는 id·domain 만', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    expect(await codeOf(renameConversation(ctx(a), conv.id, { title: '   ' }))).toBe('VALIDATION');
    expect(await codeOf(renameConversation(ctx(a), conv.id, { title: 'x'.repeat(101) }))).toBe(
      'VALIDATION',
    );
    const renamed = await renameConversation(ctx(a), conv.id, { title: '  비밀 프로젝트 견적  ' });
    expect(renamed.title).toBe('비밀 프로젝트 견적');
    const rows = await handle.db.select().from(auditLogs).where(eq(auditLogs.targetId, conv.id));
    expect(rows.map((r) => r.action).sort()).toEqual(
      [AUDIT_CHAT_CONVERSATION_CREATE, AUDIT_CHAT_CONVERSATION_RENAME].sort(),
    );
    for (const row of rows) {
      expect(row.targetType).toBe('chat.conversation');
      expect(row.targetLabel).toBeNull();
      expect({ ...row.before, ...row.after }).toEqual({ domain: 'pricing' });
      expect(JSON.stringify(row)).not.toContain('비밀');
    }
  });

  it('삭제 = 즉시 완전 삭제(메시지 CASCADE), 감사 chat.conversation.delete 에 id·domain 만, 두 번째 삭제 404', async () => {
    const a = owner(userA);
    const conv = await createConversation(ctx(a), { domain: 'pricing' });
    await begin(a, conv.id, '지워질 비밀 질문');
    await completeTurn(handle, a, conv.id, { reply: '지워질 비밀 답', action: null });
    expect(await deleteConversation(ctx(a), conv.id)).toEqual({ id: conv.id, domain: 'pricing' });
    const [left] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from chat_messages where conversation_id = ${conv.id}`,
    );
    expect(left!.n).toBe(0);
    expect(
      await handle.db.select().from(chatConversations).where(eq(chatConversations.id, conv.id)),
    ).toEqual([]);
    const [audit] = await handle.db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.targetId} = ${conv.id} and ${auditLogs.action} = ${AUDIT_CHAT_CONVERSATION_DELETE}`,
      );
    expect(audit).toMatchObject({
      action: 'chat.conversation.delete',
      targetType: 'chat.conversation',
      targetId: conv.id,
      targetLabel: null,
      before: { domain: 'pricing' },
      after: null,
      actorUserId: userA,
    });
    const all = await queryRows<{ t: string }>(
      handle.db,
      sql`select row_to_json(a)::text as t from audit_logs a where a.action like 'chat.%'`,
    );
    expect(all.map((r) => r.t).join('\n')).not.toMatch(/비밀|내 질문|Wapples/);
    expect(await codeOf(deleteConversation(ctx(a), conv.id))).toBe('NOT_FOUND');
  });

  it('사용자 삭제 시 대화·메시지 CASCADE', async () => {
    const temp = (await insertUser(handle, { email: 'chat-temp@pentasecurity.com' })).id;
    // 감사 행이 있으면 audit_logs append-only 가 actor set null 을 막으므로 감사 없이 직접 넣는다(대화 행 CASCADE 만 검사)
    const [conv] = await handle.db
      .insert(chatConversations)
      .values({ userId: temp, domain: 'pricing' })
      .returning();
    await begin(owner(temp), conv!.id, 'q');
    await handle.db.delete(users).where(eq(users.id, temp));
    const [left] = await queryRows<{ c: number; m: number }>(
      handle.db,
      sql`select (select count(*)::int from chat_conversations where user_id = ${temp}) as c,
                 (select count(*)::int from chat_messages where conversation_id = ${conv!.id}) as m`,
    );
    expect(left).toEqual({ c: 0, m: 0 });
  });
});
