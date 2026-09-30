// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { salesPrices } from '@/db/schema';
import { createTokenGuard } from '@/server/chat/graph/guard';
import { COST_REPLY_USER } from '@/server/chat/respond';

import { ScriptedChatModel, type ScriptStep } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * PR-C QA 가드 표 31종(G01~G31) 고정 (PRAMI-002 §4.4.3·AC-247, QA L-5 후속). 실제 그래프 + 스크립트 모델, LLM 경로.
 * R = 역할별 거부 문구로 교체, K = 유지(모델 출력과 바이트 동일). QA 결과와 다른 4건(G25·G27·G28·G29)이 이번 수정 대상.
 * 원가 누설 방지가 우선 — 오탐을 줄이면서 생길 수 있는 미탐을 막는 추가 케이스(X*)도 함께 고정한다.
 */
const PRODUCT = 'DA-MYQ 원가 cost 마진 이익률 Edition';
const R = 'replaced' as const;
const K = 'kept' as const;

type Case = [id: string, text: string, expect: typeof R | typeof K, withTool?: boolean];

const QA_GUARD_CASES: Case[] = [
  ['G01 ZWSP', '원​가는 1,000원입니다.', R],
  ['G02 전각 숫자', '원가는 １，０００원입니다.', R],
  ['G03 한글 수사', '원가는 오천만 원입니다.', R],
  ['G04 margin %', 'The margin is about 35%.', R],
  ['G05 이익률 %', '이익률은 35%입니다.', R],
  ['G06 텍스트 unit_cost', '{"unit_cost": 1000}', R],
  ['G07 ZWJ', '원‍가 1,000원', R],
  ['G08 soft hyphen', '마­진은 30%', R],
  ['G09 WORD JOINER', '원⁠가 5,000원', R],
  ['G10 BOM', 'cost﻿ is $1,200.', R],
  ['G11 전각 영문', 'ｃｏｓｔ is ＄１２０.', R],
  ['G12 전각 퍼센트', '마진율은 ３５％', R],
  ['G13 소수 억원', '구매단가는 1.2억원', R],
  ['G14 한글 천만', '매입가는 칠천만 원', R],
  ['G15 달러 단어', 'purchase price is 500 dollars', R],
  ['G16 퍼센트 단어', '마진은 30 퍼센트', R],
  ['G17 unitCost 싱글쿼트', "{'unitCost': 5}", R],
  ['G18 material_code 등호', 'material_code=W1001010008', R],
  ['G19 대문자 COST', 'COST: 9,000 USD.', R],
  ['G20 줄바꿈 경계', '원가 안내\n1,000원', K],
  ['G21 다른 문장', '원가 정보를 확인했습니다. 가격은 1,000원입니다.', K],
  ['G22 전각 스페이스', '원가　는 1,000원', R],
  ['G23 NFD 분해', '원가는 1,000원'.normalize('NFD'), R],
  ['G24 margins 복수', 'Our margins are 40%.', R],
  ['G25 원화 기호 ₩', '원가는 ₩1,000입니다.', R],
  ['G26 ⑥ 숫자 없는 거부', '원가는 챗봇에서 제공하지 않습니다.', K],
  ['G27 사원(일반어)', '마진 관련 문의는 담당 사원에게 하세요.', K],
  ['G28 이원화(일반어)', '원가 관리는 이원화되어 있습니다.', K],
  ['G29 영어 동사 costs', 'Wapples-500 costs 12,000,000원 as list price.', K],
  ['G30 ⑧ 도구 품명', `${PRODUCT} 의 가격은 9,500,000원입니다.`, K, true],
  ['G31 품명 마스킹 악용', `${PRODUCT} 의 원가는 1,000원입니다.`, R, true],
];

/** 오탐 수정이 만들 수 있는 미탐 방지 — 모두 교체 */
const NO_NEW_MISS: Case[] = [
  ['X01 전각 원화 기호 ￦', '원가는 ￦1,000입니다.', R],
  ['X02 원화 기호 뒤 공백', '매입가 ₩ 5,000', R],
  ['X03 한글 수사 천 단위', '원가는 삼천원입니다.', R],
  ['X04 한글 수사 붙여쓰기', '원가오천만원', R],
  ['X05 한글 수사 달러', '원가는 이백 달러', R],
  ['X06 명사 costs', 'Our costs are 5,000원.', R],
  ['X07 costs 콜론', 'costs: 1,000원', R],
  ['X08 생산 원가 동사', 'It costs us 5,000원 to produce.', R],
  ['X09 the costs', 'The costs were $1,200.', R],
  ['X10 costs + 원가 단어', '원가 기준으로 costs 5,000원', R],
  // 보안 리뷰: 판매가 신호 없는 "X costs <금액>" 은 원가 진술일 수 있다 — 막는다
  ['X11 bare it costs', 'It costs 12,000,000원.', R],
  ['X12 manufacturing costs', 'Manufacturing this part costs 12,000,000원.', R],
  ['X13 this item costs $', 'This item costs $1,200.', R],
];

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
  await ctx.handle.db.insert(salesPrices).values({
    sourceId: 99401,
    productFamily: 'D.AMO',
    itemCode: 'PQA31',
    itemName: PRODUCT,
    unit: 'EA',
    priceType: '정상판매',
    priceCategory: '일반',
    currency: 'KRW',
    hasCorePrice: false,
    unitPrice: '9500000.00',
    effectiveFrom: '2026-01-01',
    appliesToAllCustomers: false,
    isFinalSource: true,
    baseCoreCount: 0,
    unitPricePerCore: '0.00',
    customerCode: '0',
    source: 'erp',
    operationStatus: '운영중',
  });
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});

async function run(text: string, withTool = false) {
  const steps: ScriptStep[] = withTool
    ? [{ toolCalls: [{ name: 'price_lookup', args: { query: 'PQA31', family: null } }] }, { text }]
    : [{ text }];
  return ask(scriptedRuntime(ctx.handle, { model: new ScriptedChatModel(steps) }), '가격');
}

describe('QA 가드 표 31종 (AC-247 · QA L-5)', () => {
  it.each(QA_GUARD_CASES)('%s', async (_id, text, expected, withTool) => {
    const reply = await run(text, withTool);
    expect(reply.mode).toBe('llm');
    if (expected === R) expect(reply.reply).toBe(COST_REPLY_USER);
    else expect(reply.reply).toBe(text);
  });
});

describe('미탐 방지 추가 케이스 (오탐 수정의 반대 방향)', () => {
  it.each(NO_NEW_MISS)('%s', async (_id, text) => {
    expect((await run(text)).reply).toBe(COST_REPLY_USER);
  });
});

describe('QA 스트리밍 분할 S01~S06 (토큰 가드, 같은 판정)', () => {
  it.each([
    ['S01 원|가 분할', ['가격 안내입니다. 원', '가는 1,', '000원입니다.'], '가격 안내입니다.'],
    ['S02 마|진 분할 + %', ['마', '진은 3', '5%입니다.'], ''],
    ['S03 c|ost 분할', ['The c', 'ost is $', '1,200.'], ''],
    ['S04 ZWSP 분할', ['원\u200b', '가는 1,000원입니다.'], ''],
    ['S05 unit_|cost 분할', ['{"unit_', 'cost": ', '1000}'], ''],
    [
      'S06 정상 문장',
      ['두 모델이 있습니다. ', '가격은 12,000,000원입니다.'],
      '두 모델이 있습니다. 가격은 12,000,000원입니다.',
    ],
  ])('%s', (id, chunks, streamed) => {
    const guard = createTokenGuard();
    const out = chunks.map((chunk) => guard.push(chunk)).join('') + guard.flush();
    expect(out.trim()).toBe(streamed);
    expect(guard.blocked).toBe(streamed === '' || id.startsWith('S01'));
  });
});
