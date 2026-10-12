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
  ['F79 일반 명사 원리를', '마진 2 원리를 설명합니다.', K],
  ['F80 일반 명사 원본은', '원가 1 원본은 보관합니다.', K],
  ['F81 일반 명사 원장이', '원가팀 3 원장이 확인합니다.', K],
  ['F82 원래(제외 안 함)', '원가는 3,000 원래 가격', R],
  ['F83 원인 끝', '원가는 오천만 원인', R],
  ['F84 일반 명사 원인을', '원가 3 원인을 분석합니다.', K],
  ['F85 원대하(제외 안 함)', '원가 백만 원대하', R],
  ['F86 원인 경우', '원가는 1,000 원인 경우가 많습니다.', R],
  ['F87 원소(목록 밖 명사)', '원가 3 원소', R],
  // 재검증 CRITICAL (QA msg_e0a0e1d8cba8): '원인' + 지·가는 금액, 띄어 쓴 어림 수사 + 억·조도 금액.
  // 띄어 쓴 어림 수사 뒤 붙여 쓴 '조원'은 구성원(K) — (a)의 단독 '조원'과 같다
  ['F88 원인지', '원가는 1,000 원인지 확인 필요합니다.', R],
  ['F89 원인가', '원가는 1,000 원인가요?', R],
  ['F90 띄어 쓴 몇 억 원', '원가는 몇 억 원 수준입니다.', R],
  ['F91 띄어 쓴 수십 억 원', '원가는 수십 억 원입니다.', R],
  ['F92 띄어 쓴 몇 조 원', '원가는 몇 조 원', R],
  ['F93 몇 억원', '원가는 몇 억원', R],
  ['F94 수 억 원대', '원가는 수 억 원대입니다.', R],
  ['F95 몇 조원으로(main 과 같은 차단)', '원가 구조를 몇 조원으로 나눠 봅니다.', R],
  ['F96 조원 몇 명', '원가 담당 조원 몇 명', K],
  ['F97 몇 조로 나눠 조원', '원가 구조를 몇 조로 나눠 조원에게 배정', K],
  // 새 누설 0 원칙 (Plan msg_f823633dacef): main 이 막던 문장은 새로 통과시키지 않는다 — 거부 목록은 조사가 붙은 명사만.
  // 조사 없는 명사 오탐('3 원칙')은 main 과 같은 동작이라 수용
  ['F98 원리금', '원가는 1,000 원리금 포함', R],
  ['F99 원리 끝', '원가는 1,000 원리', R],
  ['F100 원본 끝', '원가는 1,000 원본', R],
  ['F101 원장 끝', '원가는 1,000 원장', R],
  ['F102 원장부가', '원가는 1,000 원장부가', R],
  ['F103 원본가', '원가는 1,000 원본가', R],
  ['F104 원칙적으로', '원가는 1,000 원칙적으로', R],
  ['F105 원인 + 구두점', '원가 1,000 원인.', R],
  ['F106 원래는', '원가는 1,000 원래는', R],
  ['F107 원만하다', '원가 백만 원만하다', R],
  ['F108 원만히', '원가는 오천만 원만히 맞춥니다.', K],
  ['F109 조사 없는 명사(main 과 같음)', '원가 3 원칙', R],
  ['F110 명사 + 공백', '원가 3 원칙 준수', K],
  // Plan 결정 (나) (msg_ce9a915179e9): 띄어 쓴 어림 수사 + 붙여 쓴 '조원'도 금액(규모 노출도 누설). 에게·한테·들·끼리 앞만 구성원
  ['F111 몇 조원입니다', '원가는 몇 조원입니다.', R],
  ['F112 수십 조원 규모', '원가는 수십 조원 규모입니다.', R],
  ['F113 수 조원', '원가는 수 조원', R],
  ['F114 수백 조원', '원가는 수백 조원', R],
  ['F115 십수 조원', '원가는 십수 조원', R],
  ['F116 몇 조원 규모', '원가는 몇 조원 규모', R],
  ['F117 수십 조원으로 추정', '원가는 수십 조원으로 추정됩니다.', R],
  ['F118 조원들에게(구성원)', '원가 담당 조원들에게 공유합니다.', K],
  ['F119 몇 조원끼리(구성원)', '원가 검토는 몇 조원끼리 나눠 합니다.', K],
];

/**
 * 출력 가드 미탐 보강 2차 PR-2 (스펙 output-guard-coverage-2 §2 G1–G7·G10, §4 PR-2) — 원가 단어와 같은 문장일 때만 쓰인다.
 * G8(맨숫자·통화 없는 k 단독)·G9(일본어 원가 단어)는 비범위. 기존 F01~F119 기대값은 그대로다.
 */
const COVERAGE2_CASES: Case[] = [
  // §4 PR-2 R 예문 — G1~G6·G10(원가량·원가까이 금액 유지). 영문 5k·1.5k 는 원가 단어가 있는 문장으로(규칙은 같은 문장에서만)
  ['F120 G3 숫자 million won', 'The cost is 5 million won.', R],
  ['F121 G3 50K USD', 'margin 50K USD', R],
  ['F122 G3 5k won(원가 단어 문장)', 'cost is 5k won', R],
  ['F123 G3 1.5k USD(원가 단어 문장)', '원가 1.5k USD', R],
  ['F124 G3 1.2M 달러', '원가 1.2M 달러', R],
  ['F125 G5 3억입니다', '원가는 3억입니다.', R],
  ['F126 G6 5천만 정도', '마진은 5천만 정도입니다.', R],
  ['F127 G5 몇 억 수준', '원가는 몇 억 수준입니다.', R],
  ['F128 G1 500円', '원가는 500円입니다.', R],
  ['F129 G2 오천 엔', '원가는 오천 엔입니다.', R],
  ['F130 G2 5만엔', '원가는 5만엔입니다.', R],
  ['F131 G4 five million won', 'The cost is five million won.', R],
  ['F132 G4 one thousand won', 'one thousand won cost', R],
  ['F133 G4 five dollars', 'cost of five dollars', R],
  ['F134 G4 several million dollars', 'cost of several million dollars', R],
  ['F135 G10 원가량(금액 유지)', '원가는 1,000 원가량입니다.', R],
  ['F136 G10 원가까이(금액 유지)', '원가는 3,000 원가까이 됩니다.', R],
  // §4 PR-2 K 예문 — main 의 엔 오탐 3문장(F143~F145)·G10 제품코드(F141·F150)는 main R → K (스펙 허용 R→K)
  ['F137 연도', '원가 기준은 2025년입니다.', K],
  ['F138 개수', '원가 항목은 3개입니다.', K],
  ['F139 용량', '128GB 모델의 원가', K],
  ['F140 G3 4K 모니터', '4K 모니터 원가는 제공하지 않습니다.', K],
  ['F141 G10 WAPPLES-500 원가', 'WAPPLES-500 원가', K],
  ['F142 G6 10만 건', '원가 데이터 10만 건', K],
  ['F143 G2 엔지니어·엔진(main 엔 오탐 정정)', '원가 담당 엔지니어 2명이 5 엔진을 봅니다.', K],
  ['F144 G2 엔드포인트(main 엔 오탐 정정)', '원가 계산 API는 3 엔드포인트로 구성됩니다.', K],
  ['F145 G2 v2엔(main 엔 오탐 정정)', '원가 시스템은 v2엔 없습니다.', K],
  ['F146 G7 제3조', '원가 원칙 제3조', K],
  ['F147 G5 1억 명', '원가 사용자 1억 명', K],
  ['F148 G6 3개만', '원가 검토는 3개만 하면 됩니다.', K],
  ['F149 맨숫자 비범위(G8)', 'cost 1,000 wonderful', K],
  ['F150 G10 SA-200 원가는', 'SA-200 원가는 제공하지 않습니다.', K],
  // 경계: G5·G6 단위 명사·단어 중간·단독 단위 제외, 수 표현은 끝까지 읽음
  ['F151 G5 3억 건', '원가 데이터 3억 건', K],
  ['F152 G5 2억 개', '원가 부품 2억 개', K],
  ['F153 G5 1억 년', '원가 이력 1억 년', K],
  ['F154 G5 1억명(붙여 씀)', '원가 사용자 1억명', K],
  ['F155 G5 1억 가지', '원가 조합은 1억 가지입니다.', K],
  ['F156 G5 1억가지(붙여 씀)', '원가 조합은 1억가지', K],
  ['F157 G5 1억 이상', '원가 데이터 1억 이상', K],
  ['F158 G6 3천만 명(끝까지 읽음)', '원가 사용자 3천만 명', K],
  ['F159 G6 2만 번', '원가 조회 2만 번', K],
  ['F160 G6 2만 배', '원가 차이 2만 배', K],
  ['F161 G6 1만 회', '원가 집계 1만 회', K],
  ['F162 G6 2만 대(기기)', '원가 집계 대상 기기는 2만 대입니다.', K],
  ['F163 G5 단어 중간 …구억…', '원가 연구억지 주장', K],
  ['F164 G5 단어 중간 추억', '원가 추억이 있습니다.', K],
  ['F165 G6 단독 만(조사)', '원가 만이 아니라 판매가도 봅니다.', K],
  ['F166 G6 천만에요', '원가 문의 감사는 천만에요.', K],
  // G5·G6 차단 형태 (문장 끝·서술어·어림·억대)
  ['F167 G5 1억이다', '원가는 1억이다', R],
  ['F168 G5 1억대', '원가는 1억대입니다.', R],
  ['F169 G5 표 끝', '| 원가 | 3억 |', R],
  ['F170 G5 수십억 정도', '원가는 수십억 정도', R],
  ['F171 G6 이천만입니다', '원가는 이천만입니다.', R],
  ['F172 G6 3억5000만 정도', '원가는 3억5000만 정도', R],
  ['F173 G6 2천만 가량', '원가는 2천만 가량', R],
  // G3 통화 필수·소문자 m 제외, G4 a·some 단독·several·few 는 scale 단어 앞만
  ['F174 G3 5k rows(통화 없음)', 'The cost dashboard shows 5k rows.', K],
  ['F175 G3 4K video(통화 없음)', 'The cost of 4K video encoding is not shown.', K],
  ['F176 G3 1.5M users(통화 없음)', 'The cost for 1.5M users is not shown.', K],
  ['F177 G3 소문자 m(배수 아님)', 'cost 5m won', K],
  ['F178 G3 bn USD', 'cost 2bn USD', R],
  ['F179 G4 a 단독', 'cost of a dollar store', K],
  ['F180 G4 some 단독', 'cost some dollars', K],
  ['F181 G4 several 단독', 'cost several dollars', K],
  ['F182 G4 few 단독', 'cost a few dollars', K],
  ['F183 G4 few hundred', 'the cost was a few hundred dollars', R],
  ['F184 G4 하이픈 조합', 'cost of twenty-five thousand won', R],
  // G1·G2 엔·円: 엔화 금액, 엔진·엔지니어·엔드포인트·엔터·엔트리·버전 토큰 제외, 한글 수사는 단어 중간 제외
  ['F185 G2 엔화', '원가는 5,000 엔화입니다.', R],
  ['F186 G2 엔화(수사 없음)', '원가는 엔화로 표시합니다.', K],
  ['F187 G2 엔진', '원가 3 엔진', K],
  ['F188 G2 엔터', '원가 입력은 2 엔터로 확정합니다.', K],
  ['F189 G2 엔트리', '원가 표의 3 엔트리를 확인하세요.', K],
  ['F190 G2 백엔드', '원가 백엔드 서버', K],
  ['F191 G2 v2엔(끝)', '원가 v2엔', K],
  ['F192 G2 조사 만 + 엔화', '원가만 엔화로 표시합니다.', K],
  ['F193 G2 수억 엔', '원가는 수억 엔', R],
  ['F194 G1 한글 수사 円', '원가는 오천 円', R],
  // G7 조 제외, G10 숫자 + 공백 + 원가
  ['F195 G7 1조', '원가 원칙 1조', K],
  ['F196 G7 1조를', '원가 원칙 1조를 따릅니다.', K],
  ['F197 G10 WAPPLES-500 원가는', 'WAPPLES-500 원가는 제공하지 않습니다.', K],
  ['F198 G10 원가치(금액 유지)', '원가는 1,000 원가치', R],
  ['F199 G10 원가격(금액 유지)', '원가는 1,000 원가격', R],
  ['F200 G10 붙여 쓴 원가량(무변경)', '원가는 500원가량입니다.', R],
  // Plan 결정 msg_70967862fa90: Q2 B('원가' 뒤 문장부호·끝은 금액, 제품코드 뒤는 원가 단어), Q3 B(어림 수사 + 천·만)
  ['F201 G10 원가 + 물음표(금액, Plan Q2 B)', '원가는 1,000 원가?', R],
  ['F202 G10 원가 + 마침표(금액)', '원가는 1,000 원가.', R],
  ['F203 G10 원가로 문장 끝(금액)', '원가는 1,000 원가', R],
  ['F204 G10 제품코드 + 원가로 끝(원가 단어)', 'WAPPLES-500 원가', K],
  ['F205 G10 제품코드 + 원가 + 물음표(원가 단어)', 'SA-200 원가?', K],
  ['F206 G10 제품코드 + 원가는(원가 단어)', 'SA-200 원가는 제공하지 않습니다.', K],
  ['F207 G10 제품코드 + 원가량(금액 유지)', '원가는 SA-200 원가량', R],
  ['F208 G6 어림 수사 + 천만(Plan Q3 B)', '원가는 수천만입니다.', R],
  ['F209 G6 어림 수사 + 만 + 어림', '원가는 몇만 정도입니다.', R],
  ['F210 G6 어림 수사 + 천 + 단위 명사(제외)', '원가 데이터는 수천 건입니다.', K],
  ['F211 G6 어림 수사 + 만 + 단위 명사(제외)', '원가 조회 사용자는 수만 명입니다.', K],
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

describe('#17 출력 가드 후속 F01~F119 (L-A·L-B·I-1·규칙 (b) 정정)', () => {
  it.each(ISSUE17_CASES)('%s', async (_id, text, expected) => {
    const reply = await run(text);
    expect(reply.mode).toBe('llm');
    if (expected === R) expect(reply.reply).toBe(COST_REPLY_USER);
    else expect(reply.reply).toBe(text);
  });
});

describe('출력 가드 2차 PR-2 F120~F211 (G1–G7·G10 + 경계)', () => {
  it.each(COVERAGE2_CASES)('%s', async (_id, text, expected) => {
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
