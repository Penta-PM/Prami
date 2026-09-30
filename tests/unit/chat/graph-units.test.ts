// @vitest-environment node
import { readFileSync } from 'node:fs';

import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CHAT_FEATURES, toolsFor } from '@/server/chat/features/registry';
import type { ChatFeature } from '@/server/chat/features/types';
import { buildChatGraph } from '@/server/chat/graph/build';
import { guardReplyText, REPLY_MAX_LENGTH } from '@/server/chat/graph/guard';
import { HistorySchema, recentHistory } from '@/server/chat/graph/history';
import { buildSystemPrompt } from '@/server/chat/graph/prompt';
import {
  routeAfterAgent,
  routeAfterCredential,
  routeAfterGuide,
  routeAfterPrecheck,
} from '@/server/chat/graph/routes';
import { ChatState } from '@/server/chat/graph/state';
import { normalizeLlmError } from '@/server/llm/errors';

import { sampleFeature } from '../../fixtures/chat/sample-feature';
import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-221 그래프 구조·라우터 표, AC-233 플러그인 등록만으로 라우팅·레지스트리 공통, 가드·히스토리·오류 정규화 단위 (§9.2).
 */
const SETTINGS = { ruleFallback: true, maxToolCalls: 4 };
const withToolCall = [
  new HumanMessage('q'),
  new AIMessage({ content: '', tool_calls: [{ id: 'c', name: 'price_lookup', args: {} }] }),
];

describe('그래프 구조 (AC-221)', () => {
  it('노드 집합과 엣지가 §4.3.3 과 같다', () => {
    const graph = buildChatGraph().getGraph();
    const nodes = Object.keys(graph.nodes).sort();
    expect(nodes).toEqual(
      [
        '__start__',
        '__end__',
        'prepare',
        'precheck',
        'costRefusal',
        'resolveCredential',
        'setupGuide',
        'ruleAnswer',
        'agent',
        'tools',
        'compose',
      ].sort(),
    );
    const edges = graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort();
    expect(edges).toEqual(
      [
        '__start__->prepare',
        'prepare->precheck',
        'precheck->costRefusal',
        'precheck->resolveCredential',
        'resolveCredential->agent',
        'resolveCredential->ruleAnswer',
        'resolveCredential->setupGuide',
        'setupGuide->ruleAnswer',
        'setupGuide->compose',
        'agent->tools',
        'agent->setupGuide',
        'agent->ruleAnswer',
        'agent->compose',
        'tools->agent',
        'costRefusal->compose',
        'ruleAnswer->compose',
        'compose->__end__',
      ].sort(),
    );
  });

  it('체크포인터 없음 — build.ts 의 compile() 은 인자가 없고 checkpointer·Saver 를 쓰지 않는다 (I-6)', () => {
    const source = readFileSync('src/server/chat/graph/build.ts', 'utf8');
    expect(source).toMatch(/\.compile\(\);/);
    expect(source).not.toMatch(/checkpointer|Saver|MemorySaver/);
  });

  it('상태 스키마 키 목록 스냅샷 — 키·자격 증명·모델·DB 필드가 없다 (AC-228)', () => {
    expect(Object.keys(ChatState.fields).sort()).toEqual(
      [
        'actor',
        'history',
        'input',
        'llm',
        'llmError',
        'messages',
        'notices',
        'reply',
        'route',
        'setup',
        'toolCalls',
      ].sort(),
    );
    expect(Object.keys(ChatState.fields).join(',')).not.toMatch(
      /key|secret|credential|model|db|email/i,
    );
  });
});

describe('라우터 표 (AC-221)', () => {
  it('① cost → costRefusal, 그 외 → resolveCredential', () => {
    expect(routeAfterPrecheck({ route: 'cost_refusal' })).toBe('costRefusal');
    expect(routeAfterPrecheck({ route: 'agent' })).toBe('resolveCredential');
  });

  it.each([
    ['ready', 'agent'],
    ['disabled', 'ruleAnswer'],
    ['missing', 'setupGuide'],
    ['invalid', 'setupGuide'],
    ['forbidden', 'setupGuide'],
    ['unreadable', 'setupGuide'],
  ] as const)('②③④ 자격 증명 %s → %s', (status, next) => {
    expect(routeAfterCredential({ llm: { status, vendor: null, model: null } })).toBe(next);
  });

  it('setupGuide → 폴백 켜짐 ruleAnswer / 꺼짐 compose', () => {
    expect(routeAfterGuide({ ruleFallback: true })).toBe('ruleAnswer');
    expect(routeAfterGuide({ ruleFallback: false })).toBe('compose');
  });

  it.each([
    [{ llmError: null, toolCalls: 0, messages: withToolCall }, SETTINGS, 'tools'],
    [{ llmError: null, toolCalls: 4, messages: withToolCall }, SETTINGS, 'compose'],
    [{ llmError: null, toolCalls: 0, messages: [new AIMessage('끝')] }, SETTINGS, 'compose'],
    [{ llmError: 'invalid_key', toolCalls: 0, messages: [] }, SETTINGS, 'setupGuide'],
    [{ llmError: 'forbidden', toolCalls: 0, messages: [] }, SETTINGS, 'setupGuide'],
    [{ llmError: 'rate_limited', toolCalls: 0, messages: [] }, SETTINGS, 'ruleAnswer'],
    [{ llmError: 'unavailable', toolCalls: 0, messages: [] }, SETTINGS, 'ruleAnswer'],
    [
      { llmError: 'unavailable', toolCalls: 0, messages: [] },
      { ...SETTINGS, ruleFallback: false },
      'compose',
    ],
    [{ llmError: 'model_not_found', toolCalls: 0, messages: [] }, SETTINGS, 'ruleAnswer'],
    [{ llmError: 'refused', toolCalls: 0, messages: [] }, SETTINGS, 'compose'],
    [{ llmError: 'too_long', toolCalls: 0, messages: [] }, SETTINGS, 'compose'],
  ] as const)('⑤ agent %o → %s', (state, settings, next) => {
    expect(routeAfterAgent(state as never, settings)).toBe(next);
  });
});

describe('플러그인 등록만으로 라우팅 (AC-233)', () => {
  let ctx: ChatTestDb;
  beforeAll(async () => {
    ctx = await setupChatDb();
  }, 120_000);
  afterAll(async () => {
    await ctx.handle.close();
  });

  it('sample-feature(notice_count) 를 레지스트리 인자로 넘기면 그래프 코드 수정 없이 실행·응답 반영', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'notice_count', args: {} }] },
      { text: '공지 개수를 확인했습니다.' },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '공지 몇 개야?', {
      features: [...CHAT_FEATURES, sampleFeature()],
    });
    expect(model.calls[0]!.tools).toContain('notice_count');
    const tool = model.calls[1]!.messages.at(-1) as ToolMessage;
    expect(tool.status).not.toBe('error');
    expect(JSON.parse(String(tool.content))).toEqual({ count: expect.any(Number) as number });
    expect(reply.reply).toBe('공지 개수를 확인했습니다.');
  });

  it('권한 없는 역할(users.manage 변형 + USER): bindTools 목록에 없고, 강제 호출해도 ToolNode 래퍼가 거부', async () => {
    const features = [...CHAT_FEATURES, sampleFeature('users.manage')];
    expect(toolsFor(features, { role: 'USER' }).map((t) => t.name)).not.toContain('notice_count');
    expect(toolsFor(features, { role: 'ADMIN' }).map((t) => t.name)).toContain('notice_count');
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'notice_count', args: {} }] },
      { text: '끝' },
    ]);
    await ask(scriptedRuntime(ctx.handle, { model }), '공지 몇 개야?', { features, role: 'USER' });
    expect(model.calls[0]!.tools).not.toContain('notice_count');
    const tool = model.calls[1]!.messages.at(-1) as ToolMessage;
    expect(tool.status).toBe('error');
    expect(String(tool.content)).toContain('사용할 수 없습니다');
  });

  it('레지스트리 공통: 이름 유일·snake_case, sideEffect none, 출력 strict, 금지어 없음 (새 기능도 자동 검사)', () => {
    const features: ChatFeature[] = [...CHAT_FEATURES, sampleFeature()];
    const tools = features.flatMap((feature) => feature.tools);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const feature of features) expect(feature.sideEffect).toBe('none');
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const def = (tool.output as z.ZodObject)._zod.def as {
        catchall?: { _zod: { def: { type: string } } };
      };
      expect(def.catchall?._zod.def.type).toBe('never');
      expect(`${tool.name} ${tool.description}`).not.toMatch(
        /원가|매입|구매단가|마진|cost|margin/i,
      );
    }
  });
});

describe('가드·히스토리·오류·프롬프트 단위', () => {
  it('guardReplyText: 원가+금액 같은 문장만 교체, 1,500자 절단, 제어 문자 제거', () => {
    const base = { role: 'USER' as const, vendor: 'anthropic', model: 'm' };
    expect(guardReplyText({ ...base, text: '원가는 $1,200 입니다' })).toContain('원가 정보는');
    expect(
      guardReplyText({ ...base, text: '판매가는 1,000원입니다. 원가는 제공하지 않습니다.' }),
    ).toBe('판매가는 1,000원입니다. 원가는 제공하지 않습니다.');
    // 프롬프트·precheck 와 같은 어휘 (마진·이익률·순이익·영문 cost/margin) + 금액이면 교체 (PR-B 자체 보안 리뷰)
    for (const text of [
      '마진은 30%, 대략 100,000원입니다.',
      '이익률 기준 순이익은 2,000,000원 정도입니다.',
      'The unit cost is $120.',
      'Our margin is about 50,000 KRW.',
      '구매 단가는 9,000원입니다.',
    ]) {
      expect(guardReplyText({ ...base, text })).toContain('원가 정보는');
    }
    expect(
      guardReplyText({ ...base, text: 'Wapples-500 판매단가는 12,000,000원입니다.' }),
    ).toContain('12,000,000원');
    expect(guardReplyText({ ...base, text: 'a\u0007b' })).toBe('ab');
    expect(guardReplyText({ ...base, text: 'x'.repeat(2000) }).length).toBeLessThan(
      REPLY_MAX_LENGTH + 40,
    );
  });

  it('HistorySchema: 1,001자·role:system·추가 키 거부, recentHistory 는 최근 N 턴', () => {
    expect(HistorySchema.safeParse([{ role: 'user', text: 'x'.repeat(1001) }]).success).toBe(false);
    expect(HistorySchema.safeParse([{ role: 'system', text: 'x' }]).success).toBe(false);
    expect(HistorySchema.safeParse([{ role: 'user', text: 'x', extra: 1 }]).success).toBe(false);
    const items = Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, text: `${i}` }));
    expect(recentHistory(items, 10).map((item) => item.text)).toEqual(
      items.slice(2).map((i) => i.text),
    );
    expect(recentHistory(items, 0)).toEqual([]);
  });

  it.each([
    [{ status: 401 }, 'invalid_key'],
    [
      { status: 400, error: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } },
      'invalid_key',
    ],
    [{ status: 400, error: { error: { type: 'invalid_request_error' } } }, 'llm_error'],
    [{ status: 403 }, 'forbidden'],
    [{ status: 404 }, 'model_not_found'],
    [{ status: 429 }, 'rate_limited'],
    [{ status: 529 }, 'unavailable'],
    [{ name: 'TimeoutError' }, 'unavailable'],
    [{ name: 'AbortError' }, 'unavailable'],
    [{ lc_error_code: 'MODEL_AUTHENTICATION' }, 'invalid_key'],
    [{ lc_error_code: 'CONTEXT_OVERFLOW' }, 'too_long'],
    [{ error: { error: { code: 'insufficient_quota' } } }, 'rate_limited'],
    [{ error: { error: { status: 'PERMISSION_DENIED' } } }, 'forbidden'],
    [{ code: 'ECONNRESET' }, 'unavailable'],
    [new Error('anything'), 'llm_error'],
    ['string', 'llm_error'],
  ] as const)('normalizeLlmError(%o) → %s', (error, code) => {
    expect(normalizeLlmError(error)).toBe(code);
  });

  it('시스템 프롬프트는 고정 상수: 레지스트리 promptHint 순서, 가변 값·키 없음, 원가 거부 규칙 포함', () => {
    const prompt = buildSystemPrompt(CHAT_FEATURES);
    expect(prompt).toBe(buildSystemPrompt(CHAT_FEATURES));
    expect(prompt.indexOf('price_lookup')).toBeLessThan(prompt.indexOf('quote_start'));
    expect(prompt).toContain('원가·매입가·구매단가·마진·이익률은 제공할 수 없습니다');
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}|sk-|@pentasecurity/);
  });
});
