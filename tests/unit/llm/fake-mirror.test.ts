// @vitest-environment node
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { env } from '@/env';
import { runChat } from '@/server/chat/graph/run';
import { chatGraph, createChatRuntime } from '@/server/chat/graph/runtime';
import { streamChat } from '@/server/chat/graph/stream';
import { COST_REPLY, COST_REPLY_USER } from '@/server/chat/respond';
import { resolveChatCredential } from '@/server/llm/credentials/chat';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import { saveCredential, type CredentialsContext } from '@/server/llm/credentials/service';
import { verifyCredential } from '@/server/llm/verify';
import { anthropic } from '@/server/llm/vendors/anthropic';
import { simulateVendorResponse } from '@/server/llm/vendors/fake';
import {
  createFakeChatModel,
  FakeChatModel,
  FakeMirrorChatModel,
  fakeBehaviorFor,
  MIRROR_CHUNK_SIZE,
  mirrorChunks,
} from '@/server/llm/vendors/fake-chat';
import { isAcceptableKey } from '@/server/llm/vendors/registry';
import { MASK, sanitizeForLog } from '@/server/log';

import { setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';
import { expectNoSecret, makeFakeKey } from '../../helpers/secret';

/**
 * 출력 가드 2차 PR-1 미러 벤더 (`fake-mirror-`, 스펙 output-guard-coverage-2 §2 PR-1·§4 PR-1):
 * fake 모드 전용·live 거부·배포 환경 팩토리 throw, 응답 = 입력에서 `§` 제거, 3자 청크 스트리밍,
 * fake-echo-(AC-204) 동작·로그 마스킹 무변화, 미러 키 로그 미노출.
 */
const MIRROR = makeFakeKey('fake-mirror-');

describe('키 접두·모드 잠금', () => {
  it('fake-mirror- 는 mirror 동작, fake-echo- 는 기존과 같다 (채팅 answer · 검증은 키를 반복하며 실패)', () => {
    expect(fakeBehaviorFor(MIRROR)).toBe('mirror');
    const echo = makeFakeKey('fake-echo-');
    expect(fakeBehaviorFor(echo)).toBe('answer');
    expect(createFakeChatModel(echo)).toBeInstanceOf(FakeChatModel);
    const simulated = simulateVendorResponse(
      echo,
      'anthropic',
      'https://api.anthropic.com/v1/models',
    );
    expect(simulated).toEqual({ throw: new Error(`Incorrect API key provided: ${echo}`) });
  });

  it('fake 모드에서만 받는다 — live 모드 레지스트리는 fake-mirror- 키를 거부한다', () => {
    expect(isAcceptableKey(anthropic, MIRROR, true)).toBe(true);
    expect(isAcceptableKey(anthropic, MIRROR, false)).toBe(false);
  });

  it('fake 모드 검증은 정상(설정 화면에서 저장 가능)', async () => {
    await expect(verifyCredential(anthropic, MIRROR, { mode: 'fake' })).resolves.toMatchObject({
      outcome: 'valid',
    });
  });
});

describe('배포 환경 팩토리 throw (다층 방어)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('NODE_ENV=production 이면 미러 팩토리가 throw', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createFakeChatModel(MIRROR)).toThrow(/not allowed/);
    expect(() => new FakeMirrorChatModel()).toThrow(/not allowed/);
  });

  it.each(['production', 'preview', 'development'])(
    'VERCEL_ENV=%s 이면 미러 팩토리가 throw',
    (value) => {
      vi.stubEnv('VERCEL_ENV', value);
      expect(() => createFakeChatModel(MIRROR)).toThrow(/not allowed/);
    },
  );

  it('로컬·테스트 환경에서는 생성된다', () => {
    expect(createFakeChatModel(MIRROR)).toBeInstanceOf(FakeMirrorChatModel);
  });
});

describe('미러 응답', () => {
  const messages = (text: string) => [
    new SystemMessage('system prompt'),
    new HumanMessage('이전 질문'),
    new AIMessage('이전 답'),
    new HumanMessage(text),
  ];

  it('마지막 Human 메시지에서 § 를 모두 지운 텍스트, 도구 호출 없음 (bindTools 무시)', async () => {
    const model = (createFakeChatModel(MIRROR) as FakeMirrorChatModel).bindTools();
    const reply = await model.invoke(messages('원§가는 1,000§원입니다. §§끝'));
    expect(reply.content).toBe('원가는 1,000원입니다. 끝');
    expect(reply.tool_calls ?? []).toEqual([]);
  });

  it('3자(코드 포인트) 청크로 스트리밍한다 — 마지막 청크만 3자 이하', async () => {
    const text = '원§가는 1,000원입니다. The co§st is 5 dollars. 😀끝';
    const expected = text.replaceAll('§', '');
    const chunks: string[] = [];
    for await (const chunk of await createFakeChatModel(MIRROR).stream(messages(text))) {
      chunks.push(String(chunk.content));
    }
    expect(chunks.join('')).toBe(expected);
    expect(chunks.length).toBe(Math.ceil(Array.from(expected).length / MIRROR_CHUNK_SIZE));
    chunks.slice(0, -1).forEach((chunk) => expect(Array.from(chunk)).toHaveLength(3));
    expect(Array.from(chunks.at(-1)!).length).toBeLessThanOrEqual(3);
    expect(mirrorChunks('abcdefg')).toEqual(['abc', 'def', 'g']);
  });
});

describe('그래프 전 경로 (fake 모드 자격 증명 → 미러 → 출력 가드)', () => {
  let ctx: ChatTestDb;
  const logs: string[] = [];
  const credentialsCtx = (userId: string): CredentialsContext => ({
    handle: ctx.handle,
    actor: { id: userId, label: 'mirror-test' },
    meta: { ip: null, userAgent: 'vitest' },
    keys: keyringFromEnv(env),
    mode: 'fake',
  });
  const input = (userId: string, role: 'USER' | 'ADMIN', text: string) => ({
    text,
    truncated: false,
    history: [],
    actor: { userId, role },
  });
  const runtime = (userId: string) => createChatRuntime({ db: ctx.handle.db, userId, env });

  beforeAll(async () => {
    ctx = await setupChatDb();
    for (const level of ['error', 'warn', 'info', 'log', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(
          args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
      });
    }
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await ctx.handle.close();
  });

  async function sse(userId: string, role: 'USER' | 'ADMIN', text: string) {
    const raw = await new Response(
      streamChat(chatGraph, input(userId, role, text), runtime(userId)),
    ).text();
    const events = raw
      .split('\n\n')
      .filter((block) => block.trim())
      .map((block) => ({
        event: /^event: (.+)$/m.exec(block)?.[1] ?? '',
        data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as Record<string, unknown>,
      }));
    const tokens = events
      .filter((event) => event.event === 'token')
      .map((event) => String(event.data.text))
      .join('');
    return { raw, tokens, final: events.find((event) => event.event === 'final')?.data };
  }

  it('K: 응답 = 입력(§ 제거), SSE 토큰도 같다 / R: 역할별 거부 문구, SSE 본문에 금액 0회 / 로그에 미러 키 없음', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'mirror-u@pentasecurity.com' })).id;
    const adminId = (
      await insertUser(ctx.handle, { email: 'mirror-a@pentasecurity.com', role: 'ADMIN' })
    ).id;
    for (const id of [userId, adminId]) {
      await saveCredential(credentialsCtx(id), { vendor: 'anthropic', apiKey: MIRROR });
    }

    const benign = '원§가 기준 연도는 2025년입니다.';
    const expected = '원가 기준 연도는 2025년입니다.';
    const json = await runChat(chatGraph, input(userId, 'USER', benign), runtime(userId));
    expect(json).toMatchObject({ mode: 'llm', reply: expected });

    const k = await sse(userId, 'USER', benign);
    expect(k.tokens).toBe(expected);
    expect(k.final).toMatchObject({ mode: 'llm', reply: expected });

    // precheck(COST_RE)를 § 로 우회 → 출력 가드가 거부 (mode=llm 은 precheck 거부(mode=refusal)가 아니라는 뜻)
    const r = await sse(userId, 'USER', '원§가는 1,000원입니다.');
    expect(r.final).toMatchObject({ mode: 'llm', reply: COST_REPLY_USER });
    expect(r.tokens).toBe('');
    expect(r.raw).not.toContain('1,000');

    const a = await sse(adminId, 'ADMIN', '마§진은 2,500원입니다.');
    expect(a.final).toMatchObject({ mode: 'llm', reply: COST_REPLY });
    expect(a.raw).not.toContain('2,500');

    // live 모드는 실제 어댑터만 — 같은 저장 키라도 미러 모델이 만들어지지 않는다
    const live = await resolveChatCredential({
      db: ctx.handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'live',
    });
    expect(live.status).toBe('ready');
    expect(live.createModel!({ maxTokens: 10, timeoutMs: 1000 })).not.toBeInstanceOf(
      FakeMirrorChatModel,
    );

    expect(sanitizeForLog(`key ${MIRROR} end`)).toBe(`key ${MASK} end`);
    expectNoSecret(logs.join('\n'), MIRROR, '로그');
  });
});
