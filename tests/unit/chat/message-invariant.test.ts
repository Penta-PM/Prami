// @vitest-environment node
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { checkModelInput } from '@/server/chat/graph/message-id';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut } from '@/server/chat/graph/types';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-351 ④ 모델 입력 불변식 (PRAMI-003 §4.5.4 H1-3): System 없는·이력이 사라진 상태로는 **모델을 부르지 않는다**(fail-closed) —
 * 규칙 답 + `chat.message_invariant_violation` 1행(메시지 수·타입만). 주입은 H-1 자체를 되살린다: `withMessageId` 를
 * 무력화하면 SSE(messages 모드)에서 prepare 메시지가 같은 run id 로 합쳐져 `[human]` 만 남는다.
 */
const disabled = vi.hoisted(() => ({ value: false }));

vi.mock('@/server/chat/graph/message-id', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/chat/graph/message-id')>();
  return {
    ...actual,
    withMessageId: <T>(message: T) =>
      disabled.value ? message : actual.withMessageId(message as never),
  };
});

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => {
  disabled.value = false;
  vi.restoreAllMocks();
});

const HISTORY = [
  { role: 'user' as const, text: 'INVARIANT-HIST-Q1' },
  { role: 'assistant' as const, text: 'INVARIANT-HIST-A1' },
];
const QUESTION = 'INVARIANT-QUESTION Wapples-500 가격';

function captureErrors() {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return () => lines.filter((line) => line.includes('chat.message_invariant_violation'));
}

async function sseFinal(model: ScriptedChatModel): Promise<ChatReplyOut> {
  const raw = await new Response(
    streamChat(
      buildChatGraph(),
      {
        text: QUESTION,
        truncated: false,
        history: HISTORY,
        actor: { userId: '00000000-0000-4000-8000-00000000000a', role: 'USER' },
      },
      scriptedRuntime(ctx.handle, { model }),
    ),
  ).text();
  const block = raw.split('\n\n').find((entry) => entry.startsWith('event: final'))!;
  return JSON.parse(/^data: (.*)$/m.exec(block)![1]!) as ChatReplyOut;
}

describe('H1-3 불변식 위반 주입 → 모델 호출 0 · 규칙 답 (AC-351 ④)', () => {
  it('SSE: id 부여를 끄면(H-1 재현) 모델을 부르지 않고 규칙 답, 위반 로그 1행은 수·타입만', async () => {
    disabled.value = true;
    const violations = captureErrors();
    const model = new ScriptedChatModel([{ text: 'LLM-SHOULD-NOT-ANSWER' }]);
    const final = await sseFinal(model);
    expect(model.calls).toHaveLength(0);
    expect(final.mode).toBe('rule');
    expect(final.reply).not.toContain('LLM-SHOULD-NOT-ANSWER');
    const lines = violations();
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'error', reason: 'system_not_first', count: 1 });
    expect(entry.types).toEqual(['human']);
    expect(lines[0]).not.toMatch(/INVARIANT-(HIST|QUESTION)/);
  });

  it('JSON(invoke) 은 id 부여를 꺼도 리듀서가 고유 id 를 붙여 불변식 통과 — 모델 호출 1회 (대조군)', async () => {
    disabled.value = true;
    const violations = captureErrors();
    const model = new ScriptedChatModel([{ text: '두 모델입니다.' }]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), QUESTION, { history: HISTORY });
    expect(model.calls).toHaveLength(1);
    expect(reply.mode).toBe('llm');
    expect(violations()).toHaveLength(0);
  });

  it('정상(id 부여 켜짐) SSE: 위반 로그 0, 모델 호출 1회', async () => {
    const violations = captureErrors();
    const model = new ScriptedChatModel([{ text: '두 모델입니다.' }]);
    const final = await sseFinal(model);
    expect(model.calls).toHaveLength(1);
    expect(final.mode).toBe('llm');
    expect(violations()).toHaveLength(0);
  });
});

describe('checkModelInput 표 (H1-3)', () => {
  const sys = (id = 's') => new SystemMessage({ content: 'sys', id });
  const human = (id: string) => new HumanMessage({ content: 'q', id });
  const ai = (id: string) => new AIMessage({ content: 'a', id });

  it.each([
    [
      '정상: [system, human, ai, human], 이력 2',
      [sys(), human('h1'), ai('a1'), human('h2')],
      4,
      null,
    ],
    [
      '도구 루프 뒤에도 정상',
      [sys(), human('h1'), ai('a1'), new AIMessage({ content: '', id: 'a2' })],
      2,
      null,
    ],
    ['id 없음', [sys(), new HumanMessage('q')], 2, 'missing_id'],
    ['id 중복', [sys('x'), human('x')], 2, 'duplicate_id'],
    ['System 없음', [human('h1')], 2, 'system_not_first'],
    ['System 2개', [sys('s1'), sys('s2'), human('h1')], 3, 'system_not_first'],
    ['이력 유실 (기대 4, 실제 2)', [sys(), human('h2')], 4, 'history_lost'],
  ] as const)('%s', (_label, messages, prefix, expected) => {
    expect(checkModelInput(messages, prefix)).toBe(expected);
  });
});
