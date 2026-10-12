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

/**
 * #17 출력 가드 후속 (L-A 미탐·L-B 오탐·I-1 COGS) 회귀 표 — 스펙 issue-17-output-guard-followup.md.
 * 1차 방어(intent COST_RE·컨텍스트·prompt)는 그대로이고 출력 가드(2차 방어)만 바꾼다.
 */
const ISSUE17_CASES: Case[] = [
  // L-A 통화 코드·won 미탐
  ['F01 KRW 코드 + 숫자', '원가는 KRW 1,000입니다.', R],
  ['F02 USD 코드 + 숫자', 'The cost is USD 500.', R],
  ['F03 숫자 + won', 'The cost is 1,000 won.', R],
  ['F04 JPY 붙여쓰기', '원가 JPY500', R],
  ['F05 유로 기호', 'cost €500', R],
  // 계속 차단 (한글 수사·단위)
  ['F06 천원 단독', '원가는 천원입니다.', R],
  ['F07 만원 단독', '원가 만원', R],
  ['F08 삼천원', '원가는 삼천원', R],
  ['F09 오천만 원입니다', '원가는 오천만 원입니다.', R],
  ['F10 오천만 원 끝', '원가는 오천만 원', R],
  ['F11 숫자 + 조원', '원가 1조원', R],
  ['F12 일조원', '원가는 일조원입니다.', R],
  ['F13 숫자 + 천억원', '원가는 2천억원', R],
  ['F14 억원대', '원가는 억원대입니다.', R],
  // L-B 수사 없는 단위·'원'으로 시작하는 일반 명사 오탐
  ['F15 조원(구성원)', '마진 보고는 조원 모두에게 공유합니다.', K],
  ['F16 구조 원칙', '원가 구조 원칙을 설명합니다.', K],
  ['F17 강조 원칙', '원가 절감을 강조 원칙으로 삼습니다.', K],
  // 경계
  ['F18 wonderful', 'cost 1,000 wonderful', K],
  ['F19 USB 3.0', 'USB 3.0 cost', K],
  ['F20 연도', 'cost in 2026', K],
  ['F21 통화 코드만', 'cost KRW', K],
  // I-1 COGS (대문자만)
  ['F22 COGS + $', 'COGS is $500.', R],
  ['F23 COGS margin %', 'COGS margin 30%', R],
  ['F24 COGS 금액 없음', 'What is COGS?', K],
  ['F25 소문자 cogs(톱니)', 'The gear cogs margin is not set, 3 pcs', K],
  // L-B (b) 보강: '원'으로 시작하는 일반 명사는 유지, 허용 조사·서술어는 계속 차단
  ['F26 구조 원리', '원가 구조 원리를 설명합니다.', K],
  ['F27 강조 원인', '마진 강조 원인을 분석합니다.', K],
  ['F28 원만하게', '원가 구조 원만하게 조정합니다.', K],
  ['F29 오천만 원 정도', '원가는 오천만 원 정도입니다.', R],
  // Plan 결정 Q1: 공백 없는 조원대·억원대는 금액, 뒤에 '표'(조원대표)면 제외, 공백 있는 '조원 대표'는 (a)대로 유지
  ['F30 조원대', '원가는 조원대입니다.', R],
  ['F31 조원대표', '마진은 조원대표가 보고합니다.', K],
  ['F32 조원 대표(공백)', '마진 보고는 조원 대표가 합니다.', K],
  // Plan 결정 Q2: '원만'·'원대' 뒤 하·한·히·해는 일반어, 그 외 '만'·'대'는 조사·접미
  ['F33 원만하게', '원가는 오천만 원만하게 맞춥니다.', K],
  ['F34 원만 받습니다', '원가는 오천만 원만 받습니다.', R],
  ['F35 원대입니다', '원가는 오천만 원대입니다.', R],
  // Plan 결정 Q3: 숫자와 '원' 사이에 공백이 있으면 '원' 뒤 판정, 붙여 쓰면 그대로 금액
  ['F36 숫자 + 공백 + 원칙', '원가 3 원칙을 설명합니다.', K],
  ['F37 숫자 + 공백 + 원입니다', '원가는 3 원입니다.', R],
  ['F38 숫자 + 공백 + 원 끝', '원가 1,000 원', R],
  ['F39 숫자 + 원칙(붙여쓰기)', '원가 1,000원칙', R],
  // 규칙 (b) 정정 (QA CRITICAL msg_c0eb6f72d24a → Plan 결정 ①+③): 공백 뒤 '원'은 기본 금액, 일반 명사만 제외.
  // QA 코퍼스에서 main 은 막고 이전 PR 이 통과시켰던 30 + 9건 — 어림 수사 + 억·조(③) 포함
  ['F40 QA 누설', '원가 이천 원임', R],
  ['F41 QA 누설', '원가는 수억원입니다', R],
  ['F42 QA 누설', '원가는 몇억원', R],
  ['F43 QA 누설', '원가는 수조원', R],
  ['F44 QA 누설', '원가는 1,000 원부터', R],
  ['F45 QA 누설', '원가는 1,000 원까지', R],
  ['F46 QA 누설', '원가는 1,000 원보다 낮음', R],
  ['F47 QA 누설', '원가는 1,000 원어치', R],
  ['F48 QA 누설', '원가는 1,000 원쯤', R],
  ['F49 QA 누설', '원가는 1,000 원밖에 안 됩니다', R],
  ['F50 QA 누설', '원가는 1,000 원임', R],
  ['F51 QA 누설', '원가는 1,000 원선', R],
  ['F52 QA 누설', '원가는 오천만 원부터', R],
  ['F53 QA 누설', '원가는 오천만 원까지', R],
  ['F54 QA 누설', '원가는 오천만 원인데', R],
  ['F55 QA 누설', '원가는 오천만 원쯤', R],
  ['F56 QA 누설', '원가는 삼천 원어치', R],
  ['F57 QA 누설', '원가는 천 원보다 쌉니다', R],
  ['F58 QA 누설', '원가는 천 원임', R],
  ['F59 QA 누설', '원가는 1천 원부터', R],
  ['F60 QA 누설', '원가는 1천 원인데', R],
  ['F61 QA 누설 (NBSP)', '원가는 1,000\u00a0원부터', R],
  ['F62 QA 누설', '원가는 1,000 원로', R],
  ['F63 QA 누설', '원가는 1,000 원하고', R],
  ['F64 QA 누설', '원가는 1,000 원뿐', R],
  ['F65 QA 누설', '원가는 1,000 원+VAT', R],
  ['F66 QA 누설', '원가는 1,000 원인 셈', R],
  ['F67 QA 누설', '원가 10만 원부터', R],
  ['F68 QA 누설', '원가는 오천 원부터', R],
  ['F69 QA 누설', '원가는 오천 원까지', R],
  ['F70 QA 누설', '원가는 일만 원부터', R],
  ['F71 QA 누설', '원가 만 원부터', R],
  ['F72 QA 누설', '원가는 3만 원선입니다', R],
  ['F73 QA 누설', '원가는 2천 원대한', R],
  ['F74 QA 누설', 'cost 1,000 원부터', R],
  ['F75 QA 누설', '원가는 백만 원부터 시작합니다.', R],
  ['F76 QA 누설', '원가는 십수억원', R],
  ['F77 QA 누설', '원가 1억 원부터', R],
  ['F78 QA 누설', '원가 1 억 원부터', R],
  ['F79 일반 명사 원리', '마진 2 원리', K],
  ['F80 일반 명사 원본', '원가 1 원본', K],
  ['F81 일반 명사 원장', '원가팀 3 원장', K],
  ['F82 일반 명사 원래', '원가 5 원래', K],
  ['F83 일반 명사 원인 끝', '마진 3 원인', K],
  ['F84 일반 명사 원인을', '원가 3 원인을 분석합니다.', K],
  ['F85 일반 명사 원대하다', '원가 목표는 오천만 원대하다.', K],
  ['F86 원인 경우', '원가는 1,000 원인 경우가 많습니다.', R],
  ['F87 원소(목록 밖 명사)', '원가 3 원소', R],
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

describe('#17 출력 가드 후속 F01~F87 (L-A·L-B·I-1·규칙 (b) 정정)', () => {
  it.each(ISSUE17_CASES)('%s', async (_id, text, expected) => {
    const reply = await run(text);
    expect(reply.mode).toBe('llm');
    if (expected === R) expect(reply.reply).toBe(COST_REPLY_USER);
    else expect(reply.reply).toBe(text);
  });
});

describe('QA 스트리밍 분할 S01~S11 (토큰 가드, 같은 판정)', () => {
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
    // #17 L-A: 통화 코드와 숫자가 청크로 나뉘어도 같은 판정(isAmount)으로 막는다
    ['S07 KRW|숫자 분할', ['원가는 KRW', ' 1,000입니다.'], ''],
    // Plan 결정 Q3: '원' 뒤 판정은 문장이 끝난 뒤에 한다 — 청크 경계에서 '원' 뒤 글자를 아직 못 받아도 보류된다
    ['S08 숫자|공백 원칙 분할', ['원가 3', ' 원칙을 설명합니다.'], '원가 3 원칙을 설명합니다.'],
    ['S09 숫자|공백 원 분할', ['원가는 3', ' 원입니다.'], ''],
    ['S10 원|칙 분할', ['원가 3 원', '칙을 설명합니다.'], '원가 3 원칙을 설명합니다.'],
    ['S11 원|입니다 분할', ['원가는 3 원', '입니다.'], ''],
  ])('%s', (id, chunks, streamed) => {
    const guard = createTokenGuard();
    const out = chunks.map((chunk) => guard.push(chunk)).join('') + guard.flush();
    expect(out.trim()).toBe(streamed);
    expect(guard.blocked).toBe(streamed === '' || id.startsWith('S01'));
  });
});
