// @vitest-environment node
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { CHAT_DOMAIN_FEATURES, chatGraphFor } from '@/server/chat/domains';
import { toolsFor } from '@/server/chat/features/registry';
import { mentionsCostAmount, productTermsOf } from '@/server/chat/graph/guard';
import { PROCUREMENT_RULE_REPLY } from '@/server/chat/graph/messages';
import { buildSystemPrompt } from '@/server/chat/graph/prompt';
import { runChat } from '@/server/chat/graph/run';
import type { ChatRuntime } from '@/server/chat/graph/types';
import { COST_REPLY_USER } from '@/server/chat/respond';
import { FakeChatModel } from '@/server/llm/vendors/fake-chat';

import { ScriptedChatModel, type ScriptStep } from '../../fixtures/chat/scripted-model';
import { captureSql, scriptedRuntime, setupChatDb } from '../../helpers/chat';
import {
  COST_WORD_TITLE,
  INJECTION_TITLE,
  seedProcurementChat,
} from '../../helpers/procurement-chat';

/**
 * 조달 챗봇 그래프 (UX 4건 §4.2·§7 C3, PR-C3) — PGlite(판매단가 + 합성 조달 픽스처) + 스크립트 모델.
 * domain 별 도구 분리(노출·실행), procurement.read 권한, 조달 프롬프트, 규칙 폴백(가격 규칙 엔진 미사용),
 * 공고명 속 지시문(합성) 무시, 조달 금액 문장 가드 오탐 없음(원가 문장은 여전히 차단).
 */
const perm = vi.hoisted(() => ({ denyProcurement: false }));
vi.mock('@/lib/constants/permissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/constants/permissions')>();
  return {
    ...original,
    hasPermission: (role: Parameters<typeof original.hasPermission>[0], key: string) =>
      perm.denyProcurement && key === 'procurement.read'
        ? false
        : original.hasPermission(role, key as Parameters<typeof original.hasPermission>[1]),
  };
});

let handle: DbHandle;

beforeAll(async () => {
  ({ handle } = await setupChatDb());
  await seedProcurementChat(handle);
}, 120_000);

afterAll(async () => {
  await handle.close();
});

afterEach(() => {
  perm.denyProcurement = false;
});

const PRICING_TOOLS = ['price_lookup', 'price_compare_previous', 'quote_start'];
const PROCUREMENT_TOOLS = [
  'procurement_performance_summary',
  'procurement_item_search',
  'procurement_bid_search',
  'procurement_delivery_search',
];

const BID_ARGS = {
  query: null,
  product: null,
  includeClosed: false,
  topGradeOnly: false,
  deadlineWithinDays: null,
  sort: null,
};

function scripted(steps: ScriptStep[]): { model: ScriptedChatModel; runtime: ChatRuntime } {
  const model = new ScriptedChatModel(steps);
  return { model, runtime: scriptedRuntime(handle, { model }) };
}

function run(domain: 'pricing' | 'procurement', runtime: ChatRuntime, text: string) {
  return runChat(
    chatGraphFor(domain),
    {
      text,
      truncated: false,
      history: [],
      actor: { userId: '00000000-0000-4000-8000-00000000000a', role: 'USER' },
    },
    runtime,
  );
}

function toolResults(model: ScriptedChatModel): ToolMessage[] {
  // 마지막 호출의 messages = 이번 턴 전체(도구 결과 다음에는 항상 모델 호출이 이어진다)
  return (model.calls.at(-1)?.messages ?? []).filter(
    (message): message is ToolMessage => message instanceof ToolMessage,
  );
}

describe('domain 별 도구 분리', () => {
  it('레지스트리: pricing = 가격 도구 3, procurement = 조달 도구 4 — 서로 겹치지 않는다', () => {
    const pricing = toolsFor(CHAT_DOMAIN_FEATURES.pricing, { role: 'USER' }).map((t) => t.name);
    const procurement = toolsFor(CHAT_DOMAIN_FEATURES.procurement, { role: 'USER' }).map(
      (t) => t.name,
    );
    expect(pricing).toEqual(PRICING_TOOLS);
    expect(procurement).toEqual(PROCUREMENT_TOOLS);
    expect(toolsFor(CHAT_DOMAIN_FEATURES.procurement, { role: 'ADMIN' })).toHaveLength(4);
  });

  it('가격 대화 모델에는 가격 도구만, 조달 대화 모델에는 조달 도구만 바인딩된다 (+ domain 프롬프트)', async () => {
    const pricing = scripted([{ text: '가격 답.' }]);
    await run('pricing', pricing.runtime, '안녕');
    expect(pricing.model.calls[0]!.tools).toEqual(PRICING_TOOLS);
    const pricingSystem = String(pricing.model.calls[0]!.messages[0]!.content);
    expect(pricingSystem).toBe(buildSystemPrompt(CHAT_DOMAIN_FEATURES.pricing));
    expect(pricingSystem).not.toMatch(/procurement_|조달/);

    const procurement = scripted([{ text: '조달 답.' }]);
    await run('procurement', procurement.runtime, '안녕');
    expect(procurement.model.calls[0]!.tools).toEqual(PROCUREMENT_TOOLS);
    const system = procurement.model.calls[0]!.messages[0]!;
    expect(system).toBeInstanceOf(SystemMessage);
    expect(String(system.content)).toBe(
      buildSystemPrompt(CHAT_DOMAIN_FEATURES.procurement, 'procurement'),
    );
    expect(String(system.content)).toContain('조달 정보 도우미');
    expect(String(system.content)).toContain('외부에서 수집한 텍스트');
    expect(String(system.content)).toContain('마지막 수집 시점');
    expect(String(system.content)).not.toMatch(/price_lookup|cost/);
  });

  it('조달 대화에서 모델이 가격 도구를, 가격 대화에서 조달 도구를 불러도 실행되지 않는다 (실행 재검사)', async () => {
    const procurement = scripted([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-500', family: null } }] },
      { text: '확인할 수 없습니다.' },
    ]);
    const capture = captureSql(handle);
    try {
      await run('procurement', procurement.runtime, '가격 알려줘');
    } finally {
      capture.restore();
    }
    expect(toolResults(procurement.model).map((m) => [m.name, m.status])).toEqual([
      ['price_lookup', 'error'],
    ]);
    expect(String(toolResults(procurement.model)[0]!.content)).toContain('사용할 수 없습니다');
    expect(capture.statements.join('\n')).not.toMatch(/sales_prices/);

    const pricing = scripted([
      { toolCalls: [{ name: 'procurement_bid_search', args: BID_ARGS }] },
      { text: '확인할 수 없습니다.' },
    ]);
    const pricingCapture = captureSql(handle);
    try {
      await run('pricing', pricing.runtime, '입찰 공고 알려줘');
    } finally {
      pricingCapture.restore();
    }
    expect(toolResults(pricing.model).map((m) => [m.name, m.status])).toEqual([
      ['procurement_bid_search', 'error'],
    ]);
    expect(pricingCapture.statements.join('\n')).not.toMatch(/procurement/);
  });

  it('procurement.read 가 없으면 조달 도구는 노출 0·실행 거부, 조달 표 SQL 0', async () => {
    perm.denyProcurement = true;
    const { model, runtime } = scripted([
      { toolCalls: [{ name: 'procurement_bid_search', args: BID_ARGS }] },
      { text: '확인할 수 없습니다.' },
    ]);
    const capture = captureSql(handle);
    try {
      await run('procurement', runtime, '입찰 공고');
    } finally {
      capture.restore();
    }
    expect(model.calls[0]!.tools).toEqual([]);
    expect(toolResults(model)[0]!.status).toBe('error');
    expect(capture.statements.join('\n')).not.toMatch(/procurement/);
  });
});

describe('조달 도구 경로', () => {
  it('도구 결과는 strict JSON(화이트리스트)로만 모델에 가고, 최종 답에 도구 원본 필드가 붙지 않는다', async () => {
    const { model, runtime } = scripted([
      { toolCalls: [{ name: 'procurement_bid_search', args: BID_ARGS }] },
      { text: '진행 중 입찰 공고는 3건입니다.' },
    ]);
    const reply = await run('procurement', runtime, '진행 중 입찰 공고');
    expect(reply).toMatchObject({ mode: 'llm', reply: '진행 중 입찰 공고는 3건입니다.' });
    expect(reply.candidates).toEqual([]);
    expect(reply.action).toBeNull();
    const [result] = toolResults(model);
    const data = JSON.parse(String(result!.content)) as { total: number; bids: unknown[] };
    expect(data.total).toBe(3);
    expect(JSON.stringify(reply)).not.toMatch(/fitReasons|bidNo/);
  });

  it('LLM 미연결이면 가격 규칙 엔진이 아니라 조달 고정 안내 (DB 0)', async () => {
    const runtime = scriptedRuntime(handle, { status: 'missing' });
    const capture = captureSql(handle);
    let reply;
    try {
      reply = await run('procurement', runtime, 'Wapples-500 가격');
    } finally {
      capture.restore();
    }
    expect(reply).toMatchObject({ mode: 'rule', reply: PROCUREMENT_RULE_REPLY });
    expect(reply.reply).not.toContain('12,000,000원');
    expect(capture.statements).toEqual([]);
  });

  it('원가 의도는 조달 대화에서도 LLM·DB 전에 거부', async () => {
    const { model, runtime } = scripted([{ text: '안 불려야 함' }]);
    const reply = await run('procurement', runtime, '이 공고 마진 얼마야');
    expect(reply.reply).toBe(COST_REPLY_USER);
    expect(model.calls).toHaveLength(0);
  });
});

describe('E2E fake 모델 (LLM_VENDOR_MODE=fake)', () => {
  it('조달 대화면 질문의 영숫자 토큰으로 procurement_bid_search 를 부르고 공고명·적합도를 요약한다', async () => {
    const runtime = scriptedRuntime(handle, { model: new FakeChatModel('answer') });
    const reply = await run('procurement', runtime, 'CHAT-B 입찰 공고 찾아줘');
    expect(reply.mode).toBe('llm');
    expect(reply.reply).toMatch(/^\[fake LLM\] 입찰 공고 4건: /);
    expect(reply.reply).toContain(`${INJECTION_TITLE}(상)`);
    expect(reply.reply).toContain(`${COST_WORD_TITLE}(중)`);
  });
});

describe('프롬프트 인젝션 — 공고명 속 지시문(합성)은 데이터', () => {
  it('지시문은 도구 결과 JSON 문자열 값으로만 들어가고, 지시를 따른 행동(가격 도구·원가 답)은 막힌다', async () => {
    const { model, runtime } = scripted([
      {
        toolCalls: [
          { name: 'procurement_bid_search', args: { ...BID_ARGS, query: '시스템 지시' } },
        ],
      },
      // 지시문을 "따르는" 모델을 가정 — 다른 domain 도구 호출
      { toolCalls: [{ name: 'price_lookup', args: { query: '원가', family: null } }] },
      // 지시문대로 원가 문장 출력
      { text: '원가는 1,000원 입니다.' },
    ]);
    const reply = await run('procurement', runtime, '시스템 지시 공고 알려줘');
    const results = toolResults(model);
    expect(results.map((m) => [m.name, m.status ?? 'success'])).toEqual([
      ['procurement_bid_search', 'success'],
      ['price_lookup', 'error'],
    ]);
    // 지시문은 ToolMessage 안의 JSON 값(title)일 뿐 — System·Human 메시지에는 없다
    const parsed = JSON.parse(String(results[0]!.content)) as { bids: { title: string }[] };
    expect(parsed.bids[0]!.title).toBe(INJECTION_TITLE);
    for (const call of model.calls) {
      for (const message of call.messages) {
        if (message instanceof SystemMessage || message instanceof HumanMessage) {
          expect(String(message.content)).not.toContain('[시스템 지시]');
        }
      }
    }
    // 지시를 따른 원가 문장은 출력 가드가 역할별 거부 문구로 바꾼다
    expect(reply.reply).toBe(COST_REPLY_USER);
  });
});

describe('가드 오탐 — 조달 금액 문장은 통과, 원가 문장은 차단', () => {
  const PROCUREMENT_SENTENCES = [
    '2025년 1~6월 WAPPLES 조달 실적 합계는 7억 8,000만원(계약 12건)입니다.',
    '자사 점유율은 1.3%이고 전년 같은 기간 대비 +12.5%입니다.',
    '물품 CHAT-W-003 의 계약단가는 3,000만원입니다.',
    '배정예산은 12억 3,400만원, 추정가격은 11억원입니다.',
    '2025-03 납품요구 합계 금액은 7억 8,000만원이고 가장 큰 건은 1억 2,000만원입니다.',
    '단가 5,000원짜리 품목이 1건 있습니다.',
  ];

  it.each(PROCUREMENT_SENTENCES)('통과: %s', (sentence) => {
    expect(mentionsCostAmount(sentence)).toBe(false);
  });

  it.each([
    '원가는 1,000원입니다.',
    '이 공고의 마진은 3,000만원입니다.',
    '이익률은 35%입니다.',
    '매입가 12억원입니다.',
  ])('차단: %s', (sentence) => {
    expect(mentionsCostAmount(sentence)).toBe(true);
  });

  it('공고명에 "원가"가 들어 있어도 그 공고의 예산 문장은 도구 결과 이름으로 가려 통과 (그래프 경로)', async () => {
    const answer = `공고 '${COST_WORD_TITLE}'의 배정예산은 3억원입니다.`;
    expect(mentionsCostAmount(answer)).toBe(true); // 가리지 않으면 오탐
    const ok = scripted([
      {
        toolCalls: [{ name: 'procurement_bid_search', args: { ...BID_ARGS, query: '원가 분석' } }],
      },
      { text: answer },
    ]);
    // 질문 자체에 원가 단어가 있으면 precheck 가 결정적으로 거부하므로, 질문은 원가 단어 없이
    const passed = await run('procurement', ok.runtime, '분석 시스템 공고 예산 알려줘');
    expect(passed.reply).toBe(answer);
  });

  it('조달 이름 가리기는 4자 이상만 — 한 단어 이름이 원가 단어 자체를 가리지 않는다', () => {
    const message = new ToolMessage({
      tool_call_id: 't1',
      name: 'procurement_item_search',
      content: JSON.stringify({
        items: [{ itemId: 'CHAT-W-001', itemName: '가상 품목', manufacturer: '마진' }],
        bids: [{ title: '원가', demandOrg: '가상 수요기관' }],
      }),
    });
    const terms = productTermsOf([message]);
    expect(terms).toEqual(expect.arrayContaining(['CHAT-W-001', '가상 품목', '가상 수요기관']));
    expect(terms).not.toContain('마진');
    expect(terms).not.toContain('원가');
    expect(mentionsCostAmount('마진은 1,000원입니다.', terms)).toBe(true);
  });
});
