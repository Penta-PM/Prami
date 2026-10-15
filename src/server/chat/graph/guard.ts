import type { ToolMessage } from '@langchain/core/messages';

import { logger } from '@/server/log';

import { COST_REPLY, COST_REPLY_USER } from '../respond';

/**
 * 원가 차단·출력 가드 (PRAMI-002 §4.4.2·§4.4.3).
 * - assertNoCostKeys: 도구 결과·최종 응답에 원가 계열 키 이름이 있으면 예외 (PRAMI-001 AC-43 키의 상위 집합)
 * - guardReplyText: 최종 텍스트에 원가 단어 + 금액 패턴이 같은 문장에 있으면 역할별 거부 문구로 교체, 길이·제어 문자 정리
 */
const FORBIDDEN_KEYS = new Set([
  'unit_cost',
  'unitCost',
  'material_code',
  'materialCode',
  'cost',
  'costs',
  'margin',
  'purchase_price',
]);

export class CostKeyError extends Error {
  constructor(readonly path: string) {
    super(`원가 계열 키가 들어 있습니다: ${path}`);
    this.name = 'CostKeyError';
  }
}

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key) || /cost/i.test(key);
}

export function assertNoCostKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCostKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw new CostKeyError(`${path}.${key}`);
    assertNoCostKeys(entry, `${path}.${key}`);
  }
}

/**
 * 원가 계열 단어 — 스펙 §4.4.3 목록(원가·매입가·구매단가·매입 단가)에 시스템 프롬프트·precheck(COST_RE)와 같은 어휘
 * (마진·이익률·이익금·순이익, 영문 cost·margin)를 더한 상위 집합 (PR-B 자체 보안 리뷰 반영)
 */
const COST_WORD =
  /원가|매입가|구매\s?단가|매입\s?단가|마진|이익률|이익금|순이익|\bcost\b|\bmargins?\b|\bpurchase\s+prices?\b/i;
/**
 * 영문 `costs` 는 원가 단어로 본다. 예외는 하나 — 가격 동사(`costs <금액>`)이면서 **판매가 신호**(list price·selling price·
 * retail·MSRP·판매가·정가 등)가 같은 문장에 있을 때만 (PR-C QA L-5 G29 "X costs 12,000,000원 as list price").
 * 신호가 없으면("It costs 12,000,000원.") 원가 진술일 수 있어 막는다 — 모르면 원가 쪽(누설 방지 우선, 보안 리뷰 반영).
 */
const COSTS_WORD = /\bcosts\b/i;
const COSTS_AS_PRICE_VERB =
  /\bcosts\s+(?:about\s+|around\s+|approximately\s+|roughly\s+|only\s+|just\s+)?[$₩\d]/i;
const SALE_PRICE_SIGNAL =
  /\b(?:list|selling|sale|retail|sales)\s+price\b|\bretail\b|\bMSRP\b|판매\s?가|판매\s?단가|정가|소비자\s?가/i;
const COST_CONTEXT =
  /\b(?:the|our|its|their|your|unit|total|material|production|purchase|internal)\s+costs\b|\bcosts\s*[:=]|\bcosts\s+us\b|\bto\s+(?:make|produce|manufacture|build|procure)\b|\bmaterials?\b/i;

/**
 * 매출원가 약어 COGS (#17 I-1) — 대소문자를 구분하는 별도 정규식. 소문자 `cogs`(톱니)는 오탐 방지를 위해 제외한다.
 * `cost of goods sold` 는 COST_WORD 의 `\bcost\b` 로 이미 잡힌다.
 */
const COGS_WORD = /\bCOGS\b/;

function hasCostWord(sentence: string): boolean {
  if (COST_WORD.test(sentence) || COGS_WORD.test(sentence)) return true;
  if (!COSTS_WORD.test(sentence)) return false;
  const saleSentence = COSTS_AS_PRICE_VERB.test(sentence) && SALE_PRICE_SIGNAL.test(sentence);
  return !saleSentence || COST_CONTEXT.test(sentence);
}

/**
 * 금액 (#17 L-A·L-B) — 세 갈래 중 하나라도 맞으면 금액이다 (isAmount).
 * 1. 아라비아 숫자 + (한글 단위) + 통화 (AMOUNT_DIGIT_WON·AMOUNT_DIGIT_CURRENCY). won·yen·dollars·euros 는 뒤에 영문자가
 *    없을 때만 ("1,000 wonderful" 제외). '원'은 바로 앞에 공백이 있으면 (b)의 일반 명사 제외를 거친다 ("3 원칙" 제외).
 * 2. 통화 코드·기호 + 숫자 ("KRW 1,000", "JPY500", "€500"; ￦ 는 NFKC 로 ₩).
 * 3. 한글 수사 + 단위 + 원·달러 (KOREAN_NUMERAL_AMOUNT).
 * 출력 가드 2차(스펙 output-guard-coverage-2 G1–G6·G10): 엔·円(AMOUNT_DIGIT_YEN·KOREAN_NUMERAL_YEN), 배수 접미 + 통화
 * (hasScaleCurrency), 영어 수사 + 통화(AMOUNT_WORD_CURRENCY), '원' 없는 억·천·만(AMOUNT_SCALE_ONLY). 아래 각 정의 참고.
 *
 * 한글 수사 갈래 (#17 L-B). 한글은 \w 밖이라 `\b` 가 경계로 동작하지 않으므로 경계를 lookahead 로 명시한다.
 * (a) 수사 표현은 단위를 하나 이상 포함한다("사원"·"이원화" 제외, QA L-5). 마지막 단위가 조·억이면 앞에 수사나 다른 단위,
 *     또는 어림 수사(수·몇·십수·수십·수백·수천)가 있어야 한다 — `조원`(구성원)·`강조 원칙` 의 단독 '조' 는 금액이 아니고,
 *     "수억원"·"몇억원"·"십수억원"은 금액이다. 십·백·천·만은 단독으로도 금액("천원", "만원").
 * (b) 단위(또는 숫자)와 '원' 사이에 공백이 있어도 기본은 금액이다(누설 방지 우선, 거부 목록 — 스펙 '규칙 (b) 정정').
 *     '원' 뒤가 일반 명사 원칙·원리·원본·원장·원인에 조사가 붙은 형태이거나 '원만하게'·'원만히' 일 때만 제외한다.
 *     main 이 막던 문장을 새로 통과시키지 않는다(Plan '새 누설 0 원칙') — 문장 끝·구두점 앞 명사("1,000 원리"),
 *     원리금·원래·원장부가·원칙적으로 등은 금액이다. 목록에 없는 일반 명사("3 원소")와 조사 없는 명사("3 원칙")는
 *     금액으로 남는다(main 과 같은 동작).
 * (c) 공백 없이 붙은 '원'("삼천원", "오천만원", "1,000원")은 뒤와 상관없이 금액. '달러'는 공백과 상관없이 금액("이백 달러").
 * 예외: 공백 없는 단독 '억원대'·'조원대'는 금액대 표현이라 (a)와 별개로 금액이다. 단 뒤에 '표'가 오면(조원대표) 제외.
 */
/**
 * (b) 공백 뒤 '원'이 일반 명사로 이어지는 경우 — 이때만 금액이 아니다.
 * - 원칙·원본·원장(받침): 뒤에 조사(을·이·은·과·으로·의·에·도·만) 또는 공백
 * - 원리(받침 없음): 뒤에 조사(를·가·는·와·로·의·에·도·만) 또는 공백 — 원리금 제외
 * - 원인: 뒤에 조사 을·이·은·의·과·에·으 만 (원인데·원인지·원인가·원인 경우·문장 끝 원인은 금액)
 * - 원만: '원만하게'·'원만히' 만 (Q2 K행). 원래·원대는 제외하지 않는다
 */
const WON_COMMON_NOUN =
  '(?!(?:칙|본|장)(?=[을이은과으의에도만]|\\s)|리(?=[를가는와로의에도만]|\\s)|인(?=[을이은의과에으])|만(?=하게|히))';
/**
 * G10 (스펙 output-guard-coverage-2 §7): **당사 제품 모델 접두**(허용 목록) + 숫자 + 공백 + '원가'는 원가 단어다
 * ("WAPPLES-500 원가", "SA-200 원가는", "H500 원가", "SG-KMS-1700 원가") — 금액 아님.
 * - 허용 목록(대소문자 무관): WAPPLES(·-CC·-MS), SA, H(하드웨어 코드), SG-KMS·KMS, SG-WCA·SG-WVA·SS-ATH·SS-IAT, iSIGN(+).
 *   접두 앞은 토큰 경계 — 라틴 문자(Ü·é 포함)·숫자·'-'·'_'·'.'·'/' 뒤면 아님("USA-500"·"WH500"·"xSA-200"·"ÜSA-500"·
 *   "USD-SA-200"·"SG--KMS-500" 은 금액). 접두와 숫자 사이 구분자는 '-'·'_'·공백 0~1개, 한 글자 접두 H 는 붙여 쓰거나
 *   하이픈만("H500"·"H-500" — "H 1,000" 은 금액). Plan 결정 msg_335fbc44273e·#50 3차 경계 1·2 (가).
 * - 뒤가 량·까·치·격이면 '원 + 가량/가까이/가치/가격'이라 금액으로 둔다("WAPPLES-500 원가량").
 * - 그 밖의 모든 숫자(일반 숫자, 통화 코드·ISO 코드·W·WON·라벨 접두 등 허용 목록 밖 라틴 접두)는 + 공백 + '원가'가
 *   main 과 같이 금액이다 — 차단 목록 대신 허용 목록이라 표기 변형(대소문자·밑줄·연속 하이픈)으로 새 누설이 생기지 않는다.
 */
const PRODUCT_PREFIX =
  '(?<![\\p{Script=Latin}\\p{N}\\-_./])(?:(?:WAPPLES(?:-CC|-MS)?|SA|SG-KMS|KMS|SG-WCA|SG-WVA|SS-ATH|SS-IAT|ISIGN\\+|ISIGN)[-_ ]?|H-?)';
/**
 * 일반 숫자 갈래에서 빼는 것은 **접두 바로 뒤에서 시작한 숫자**(와 그 숫자의 중간 자리)뿐이다. 접두와 숫자 사이에 '.'·','
 * 같은 다른 문자가 끼면("H.500원", "SA,1,000원") 제품코드가 아니므로 main 과 같이 일반 숫자로 판정한다(QA #50 3차).
 */
const AMOUNT_DIGIT_WON = new RegExp(
  `(?<!${PRODUCT_PREFIX})(?<!${PRODUCT_PREFIX}\\d[\\d,.]*)\\d[\\d,.]*(?:원|\\s+원${WON_COMMON_NOUN})|(?<=${PRODUCT_PREFIX})\\d[\\d,.]*(?:원|\\s+원${WON_COMMON_NOUN}(?!가(?![량까치격])))|\\d[\\d,.]*\\s*[십백천만억조]+(?:원|\\s+원${WON_COMMON_NOUN})`,
  'iu',
);
const AMOUNT_DIGIT_CURRENCY =
  /\d[\d,.]*\s*[십백천만억조]*\s*(달러|[$₩€£¥]|(KRW|USD|JPY|EUR|CNY|GBP|dollars?|won|yen|euros?)(?![a-z]))/i;
const AMOUNT_CURRENCY_DIGIT = /(\b(KRW|USD|JPY|EUR|CNY|GBP)|[$₩￦€£¥])\s*\d/i;
const DIGIT = '[일이삼사오육칠팔구]';
const UNIT = '[십백천만억조]';
/**
 * (a) 어림 수사 — 억·조 앞에서만 수사로 인정 (Plan 결정 ③). 띄어 쓴 "몇 억 원"·"수십 억 원"·"몇 조 원"도 금액이다(QA 재검증).
 * 띄어 쓴 어림 수사 뒤 붙여 쓴 '조원'도 금액이다("몇 조원입니다", "수십 조원 규모" — 규모 노출도 누설, Plan 결정 (나)).
 * 바로 뒤가 사람에게만 붙는 조사 에게·한테·들·끼리일 때만 구성원으로 본다("조원들에게"). '몇 조원으로 나눠'는 금액(main 과 같음).
 */
const ESTIMATE = '(?:십수|수십|수백|수천|수|몇)';
/** (a) 수사 표현: 단위 둘 이상(마지막 조·억 허용) | 십·백·천·만으로 끝남 | 수사 또는 어림 수사 + 조·억 */
const NUMERAL_EXPR = `(?:(?:${DIGIT}?${UNIT})+[억조]|(?:${DIGIT}?${UNIT})*(?:${DIGIT}?[십백천만]|${DIGIT}[억조])|${ESTIMATE}(?:[억조]|\\s+억|\\s+조(?=\\s|원(?!에게|한테|들|끼리))))`;
const KOREAN_NUMERAL_AMOUNT = new RegExp(
  `${NUMERAL_EXPR}(?:원|\\s+원${WON_COMMON_NOUN}|\\s*달러)|[억조]원대(?!표)`,
  'u',
);

/**
 * 엔·円 (스펙 output-guard-coverage-2 G1·G2). 숫자 또는 한글 수사(+단위) 바로 뒤(공백 허용) '円'·'엔'.
 * - '엔' 뒤가 진·지니어·드·터·트(엔진·엔지니어·엔드포인트·엔터·엔트리)면 일반어라 제외. '엔화'는 금액.
 * - 숫자 바로 앞이 라틴 문자(버전·모델 토큰 "v2엔")면 제외. 숫자 중간에서 시작하지 않게 숫자·소수점·콤마 뒤도 제외.
 * - 한글 수사는 앞이 한글 음절이면 제외(단어 중간·조사 '만' + "엔화" 오탐 방지).
 */
const YEN = '(?:円|엔(?!진|지니어|드|터|트))';
const AMOUNT_DIGIT_YEN = new RegExp(`(?<![A-Za-z\\d.,])\\d[\\d,.]*\\s*${UNIT}*\\s*${YEN}`, 'u');
const KOREAN_NUMERAL_YEN = new RegExp(
  `(?<![가-힣])(?:(?:${DIGIT}?${UNIT})+|${ESTIMATE}\\s*[억조])\\s*${YEN}`,
  'u',
);

/**
 * 숫자 + 배수 접미(k·K·M·thousand·million·billion·bn) + 통화 (G3). 통화가 반드시 붙어야 한다("5k rows"·"4K video"·
 * "1.5M users" 제외). 소문자 m(미터 등)은 배수로 보지 않는다. 통화 기호·코드가 앞에 오는 "$5k" 는 AMOUNT_CURRENCY_DIGIT.
 */
const CURRENCY_AFTER = `(?:원${WON_COMMON_NOUN}|달러|${YEN}|[$₩€£¥]|(?:KRW|USD|JPY|EUR|CNY|GBP|dollars?|won|yen|euros?)(?![a-z]))`;
const AMOUNT_SCALE_CURRENCY = new RegExp(
  `(?<![a-z\\d.,])\\d[\\d,.]*\\s*(k|m|thousand|million|billion|bn)(?![a-z])\\s*${CURRENCY_AFTER}`,
  'giu',
);

function hasScaleCurrency(sentence: string): boolean {
  for (const match of sentence.matchAll(AMOUNT_SCALE_CURRENCY)) if (match[1] !== 'm') return true;
  return false;
}

/**
 * 영어 수사 + 통화 (G4): 고정 단어 one–nineteen·twenty–ninety·hundred·thousand·million·billion(하이픈·공백·and 조합) +
 * won·dollars·yen·euros·통화 코드. several·few 는 뒤에 hundred·thousand·million·billion 이 올 때만. a·some 은 수사가 아니다.
 */
const EN_NUMBER =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\\b';
const EN_SCALE = '(?:hundred|thousand|million|billion)\\b';
const AMOUNT_WORD_CURRENCY = new RegExp(
  `\\b(?:${EN_NUMBER}|(?:several|few)[-\\s]+${EN_SCALE})(?:(?:[-\\s]+(?:and\\s+)?)${EN_NUMBER})*\\s+(?:KRW|USD|JPY|EUR|CNY|GBP|dollars?|won|yen|euros?)(?![a-z])`,
  'i',
);

/**
 * '원' 없는 억·천·만·백만·천만 (G5·G6). 숫자·한글 수사·어림 수사(억 앞만) + 단위가 억·천·만으로 끝나고, 뒤가
 * 문장 끝·구두점, 조사·서술어(붙여 씀), 어림(정도·가량·쯤·수준·내외, 붙여 쓰거나 띄어 씀, '대'는 억 뒤 붙여 쓴 것만)일 때 금액.
 * - 뒤가 단위 명사(년·명·건·개·회·대수·종·번·가지·배·GB …)면 위 목록에 없으므로 금액이 아니다(가지·이상·이하·이내·에요 제외).
 * - 조(G7)·백·십으로 끝나면 해당 없음("제3조"·"1조"). 수 표현은 끝까지 다 읽는다("3천만 명"의 '3천'+조사 '만' 로 끊지 않음).
 * - 숫자 앞이 라틴 문자·숫자면 제외(모델·버전 토큰). 한글 수사·어림 수사는 앞이 한글 음절이면 제외(단어 중간 "…구억…").
 * - 어림 수사(수·몇·수십·십수…)는 억뿐 아니라 천·만에도 붙는다("수천만입니다", "몇만 정도" — Plan Q3 B).
 * - 한글 수사는 수사 글자로 시작하거나 단위가 둘 이상일 때만("만이 아니라"·"천 정도"의 단독 단위 제외).
 * - 아라비아 숫자 바로 뒤의 한글 수사 글자는 수사로 시작하지 않는다("3일만에"·"10일만이면"의 '일만' 제외, Plan 결정).
 *   숫자 + 단위 조합("1억2천만")은 첫 갈래가 읽는다. 숫자에 붙지 않은 "일만 원"·"약 일만 원"은 그대로 금액.
 */
const SCALE_NUMBER = `(?:(?<![A-Za-z\\d.,])\\d[\\d,.]*\\s?${UNIT}(?:(?:\\d[\\d,.]*|${DIGIT})?${UNIT})*|(?<![가-힣\\d])(?=${DIGIT}|${UNIT}${DIGIT}?${UNIT})(?:${DIGIT}?${UNIT})+|(?<![가-힣])${ESTIMATE}\\s*${UNIT}+)`;
const SCALE_APPROX = '(?:정도|가량|쯤|수준|내외)';
const SCALE_FOLLOW = `(?:\\s*(?:$|[.!?。,)|/~])|이(?!상|하|내)|가(?!지)|[은는을를의도와과]|에(?!요)|으로|로|부터|까지|보다|씩|짜리|어치|임|인|입니|${SCALE_APPROX}|(?<=억)대(?![수표])|\\s+(?:입니다|이다|이에요|${SCALE_APPROX}))`;
const AMOUNT_SCALE_ONLY = new RegExp(
  `${SCALE_NUMBER}(?![십백천만억조\\d])(?<=[억천만])${SCALE_FOLLOW}`,
  'u',
);

function isAmount(sentence: string): boolean {
  return (
    AMOUNT_DIGIT_WON.test(sentence) ||
    AMOUNT_DIGIT_CURRENCY.test(sentence) ||
    AMOUNT_CURRENCY_DIGIT.test(sentence) ||
    KOREAN_NUMERAL_AMOUNT.test(sentence) ||
    AMOUNT_DIGIT_YEN.test(sentence) ||
    KOREAN_NUMERAL_YEN.test(sentence) ||
    hasScaleCurrency(sentence) ||
    AMOUNT_WORD_CURRENCY.test(sentence) ||
    AMOUNT_SCALE_ONLY.test(sentence)
  );
}

/** 비율: 마진·이익률 같은 단어와 함께면 금액과 같게 본다 ("margin 35%") */
const PERCENT = /\d[\d.]*\s*(%|퍼센트|percent)/i;
/** 텍스트 속 원가 키 JSON (모델이 {"unit_cost":…} 를 글로 쓰는 경우) */
const COST_KEY_TEXT =
  /["']?(unit_cost|unitCost|material_code|materialCode|purchase_price|material_cost)["']?\s*[:=]/i;
/** 판정 전 정규화: NFKC(전각 숫자·호환 문자) + 제로폭·서식 문자 제거 (예: '원' + U+200B + '가' 우회 방지) */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export function normalizeForGuard(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}

/** 판정용 사본에서 품명·품번을 가리는 자리표시자 (원가 단어·숫자 없음) */
const TERM_PLACEHOLDER = '[품목]';
const TERM_KEYS = new Set(['itemName', 'itemCode']);

function collectTerms(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTerms(entry, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (TERM_KEYS.has(key) && typeof entry === 'string' && entry.trim()) out.add(entry);
    else collectTerms(entry, out);
  }
}

function parsedContent(message: ToolMessage): unknown {
  if (typeof message.content !== 'string') return null;
  try {
    return JSON.parse(message.content);
  } catch {
    return null;
  }
}

/**
 * 이번 요청 도구 결과의 품명·품번 (r4 §4.4.3, AC-247 ⑧) — 아티팩트 후보 + 모델이 본 검증된 도구 출력.
 * 품명 속 "원가"·"cost" 가 원가 단어로 오인되지 않게 판정용 사본에서만 가린다.
 */
export function productTermsOf(messages: readonly ToolMessage[]): string[] {
  const terms = new Set<string>();
  for (const message of messages) {
    collectTerms(message.artifact, terms);
    collectTerms(parsedContent(message), terms);
  }
  return [...terms];
}

function maskTerms(text: string, terms: readonly string[]): string {
  return terms
    .map(normalizeForGuard)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, term) => masked.split(term).join(TERM_PLACEHOLDER), text);
}
export const REPLY_MAX_LENGTH = 1500;
export const REPLY_TRUNCATED_SUFFIX = '… (답변이 길어 일부만 표시합니다)';

type GuardInput = {
  text: string;
  /** 도구 결과 품명·품번 (판정용 사본에서만 가림) */
  terms?: readonly string[];
  role: 'USER' | 'ADMIN';
  vendor: string | null;
  model: string | null;
};

/** 문장 단위로 원가 단어 + (금액 또는 비율)이 함께 있는지, 또는 원가 키 JSON 이 텍스트로 있는지 (정규화 후 판정) */
export function mentionsCostAmount(raw: string, terms: readonly string[] = []): boolean {
  const text = maskTerms(normalizeForGuard(raw), terms);
  if (COST_KEY_TEXT.test(text)) return true;
  return (
    text
      // 문장 끝 부호 뒤 공백 또는 줄바꿈에서만 나눈다 ("1.2억원" 같은 소수점에서 나누지 않음)
      .split(/(?<=[.!?。])\s+|\n/)
      .some((sentence) => hasCostWord(sentence) && (isAmount(sentence) || PERCENT.test(sentence)))
  );
}

export function guardReplyText({ text, terms = [], role, vendor, model }: GuardInput): string {
  if (mentionsCostAmount(text, terms)) {
    // 내용은 남기지 않는다 — 벤더·모델만
    logger.warn('chat.guard.cost_text', { vendor, model });
    return role === 'ADMIN' ? COST_REPLY : COST_REPLY_USER;
  }
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return clean.length > REPLY_MAX_LENGTH
    ? `${clean.slice(0, REPLY_MAX_LENGTH)}${REPLY_TRUNCATED_SUFFIX}`
    : clean;
}

/**
 * 스트리밍 토큰 가드 (PR-C 자체 보안 리뷰 반영): SSE `token` 은 compose 가드보다 먼저 나가므로, 문장 단위로 모아
 * 완성된 문장마다 같은 판정(mentionsCostAmount)을 거친 뒤에만 내보낸다. 한 번이라도 걸리면 이 요청의 토큰은 더 내보내지 않는다
 * (정본 final 이 역할별 거부 문구로 교체된다). 끝나지 않은 마지막 조각은 agent 턴이 끝날 때 flush 로 같은 판정 후 내보낸다.
 */
export function createTokenGuard() {
  let pending = '';
  let seen = '';
  let blocked = false;
  let terms: string[] = [];
  return {
    get blocked() {
      return blocked;
    },
    /** 도구 결과 품명·품번을 판정 마스킹에 더한다 (tools 노드가 끝날 때) */
    addTerms(next: readonly string[]) {
      terms = [...new Set([...terms, ...next])];
    },
    /** 청크를 받아 지금 안전하게 내보낼 텍스트를 돌려준다 (없으면 빈 문자열) */
    push(chunk: string): string {
      if (blocked) return '';
      pending += chunk;
      // 끝난 문장 = 끝 부호 뒤에 공백이 온 곳 또는 줄바꿈까지 ("1.2억원" 의 소수점·청크 끝의 부호는 다음 청크까지 보류)
      const sentences = pending.match(/[\s\S]*?(?:[.!?。](?=\s)|\n)/g) ?? [];
      pending = pending.slice(sentences.join('').length);
      let out = '';
      for (const sentence of sentences) {
        if (mentionsCostAmount(seen + sentence, terms)) {
          blocked = true;
          pending = '';
          break;
        }
        seen += sentence;
        out += sentence;
      }
      return out;
    },
    /** 벤더 거부(refusal) — 보류분을 버리고 이 요청의 토큰을 더 내보내지 않는다 (final 이 거부 안내로 교체) */
    discard() {
      blocked = true;
      pending = '';
    },
    /** agent 턴이 끝나면 남은 조각을 같은 판정으로 내보낸다 (끝 부호 뒤 공백이 없는 마지막 문장) */
    flush(): string {
      if (blocked || !pending) return '';
      const rest = pending;
      pending = '';
      if (mentionsCostAmount(seen + rest, terms)) {
        blocked = true;
        return '';
      }
      seen += rest;
      return rest;
    },
  };
}
