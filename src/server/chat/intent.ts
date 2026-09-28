/**
 * 챗봇 의도 분류 (§4.5.9, 규칙 기반 MVP — LLM 호출 없음, Q-04b). 순수 함수라 단위 테스트가 쉽다.
 * 우선순위: 원가 → 연도 비교 → 견적 시작 → 가격 조회 → 도움말 (디자인 chatReply 의 분기 순서).
 * 검색어 추출: 의도 키워드·조사·서술어를 걷어낸 나머지가 품명/품번 후보. 디자인의 "SA-500" 표기는 Wapples-500 / H500 별칭으로 넓힌다.
 */
export type ChatIntentKind = 'cost' | 'compare' | 'quote' | 'price' | 'help';

export type ChatIntent = {
  kind: ChatIntentKind;
  /** 품명·품번 검색어 (없으면 null) */
  query: string | null;
  /** 검색에 쓸 후보 문자열 (별칭 확장 포함, 원문 우선) */
  terms: string[];
  /** 문장에 제품군(WAPPLES 등)이 독립된 단어로 언급됐으면 그 제품군 */
  family: string | null;
};

export const CHAT_MAX_LENGTH = 200;

export const PRODUCT_FAMILIES = ['WAPPLES', 'D.AMO', 'iSIGN', 'Cloudbric'] as const;

const COST_RE = /원가|매입가|마진|이익률|이익금|순이익/i;
const COMPARE_RE =
  /작년|전년|올랐|내렸|올라|내려|인상|인하|비교|변경|달라졌|바뀌었|추이|얼마나 (?:올|내)/i;
const QUOTE_RE = /견적|quote/i;
const PRICE_RE = /가격|단가|얼마|판매가|정가|price/i;

/** 의도·서술어·조사 — 검색어에서 제거 (긴 것부터) */
const STOP_WORDS = [
  '작년보다',
  '전년보다',
  '얼마인가요',
  '알려주세요',
  '올랐나요',
  '올랐어요',
  '내렸어요',
  '얼마예요',
  '해주세요',
  '얼마나',
  '올랐어',
  '내렸어',
  '알려줘',
  '얼마야',
  '뽑아줘',
  '견적서',
  '견적을',
  '주세요',
  '가격이',
  '가격은',
  '가격을',
  '판매가',
  '인가요',
  '작년',
  '전년',
  '보다',
  '올랐',
  '내렸',
  '올라',
  '내려',
  '인상',
  '인하',
  '비교',
  '대비',
  '변경',
  '견적',
  '뽑아',
  '시작',
  '계산',
  '가격',
  '단가',
  '정가',
  '얼마',
  '알려',
  '해줘',
  '이야',
  '인지',
  '제품',
  '모델',
  '정보',
  '부탁',
  '궁금',
  '좀요',
  'price',
  'quote',
  '줘',
  '좀',
  '요',
  '의',
  '이',
  '가',
  '은',
  '는',
  '을',
  '를',
  '에',
  '와',
  '과',
  '도',
];

const ALIASES: readonly { pattern: RegExp; expand: (match: RegExpExecArray) => string[] }[] = [
  // 디자인 예시 "SA-500" → Wapples-500, H500
  { pattern: /\bSA-?(\d{2,5})\b/i, expand: (m) => [`Wapples-${m[1]}`, `H${m[1]}`] },
  // "H500" → Wapples-500
  { pattern: /\bH(\d{2,5})\b/i, expand: (m) => [`Wapples-${m[1]}`] },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 제품군은 독립된 단어일 때만 (모델명 "Wapples-500" 안의 wapples 는 제품군 언급이 아니다) */
function familyPattern(family: string): RegExp {
  return new RegExp(`(^|[\\s,])${escapeRegExp(family)}(?=$|[\\s,?!.])`, 'i');
}

const KOREAN_FAMILY: readonly [RegExp, string][] = [
  [/와플즈|와플/, 'WAPPLES'],
  [/다모/, 'D.AMO'],
  [/아이사인/, 'iSIGN'],
  [/클라우드브릭/, 'Cloudbric'],
];

function detectFamily(text: string): string | null {
  for (const family of PRODUCT_FAMILIES) {
    if (familyPattern(family).test(text)) return family;
  }
  for (const [pattern, family] of KOREAN_FAMILY) {
    if (pattern.test(text)) return family;
  }
  return null;
}

/** 공백 정리·길이 제한 (검색과 같은 규칙). 제어 문자는 버린다 */
export function normalizeMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function stripStopWords(text: string): string {
  let out = text;
  // "시작해줘" 처럼 서술어가 겹쳐 붙은 경우를 위해 두 번 훑는다
  for (let pass = 0; pass < 2; pass += 1) {
    for (const word of STOP_WORDS) {
      const w = escapeRegExp(word);
      // 독립 단어
      out = out.replace(new RegExp(`(^|\\s)${w}(?=\\s|$|[?!.,])`, 'g'), '$1');
      // 영문·숫자·괄호 토큰 뒤에 바로 붙은 조사·서술어 (예: "Wapples-500의", "T2)은")
      out = out.replace(new RegExp(`(?<=[A-Za-z0-9)\\]])${w}(?=\\s|$|[?!.,])`, 'g'), '');
      // 문장 끝에 붙은 서술어 (예: "시작해줘")
      out = out.replace(new RegExp(`${w}(?=[?!.,]|$)`, 'g'), '');
    }
  }
  return out
    .replace(/[?!,~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuery(text: string, family: string | null): string | null {
  let candidate = stripStopWords(text);
  if (family) {
    candidate = candidate.replace(familyPattern(family), ' ');
    for (const [pattern] of KOREAN_FAMILY) candidate = candidate.replace(pattern, ' ');
    candidate = candidate.replace(/\s+/g, ' ').trim();
  }
  return candidate.length >= 2 ? candidate : null;
}

function expandTerms(query: string | null): string[] {
  if (!query) return [];
  const terms = [query];
  for (const alias of ALIASES) {
    const match = alias.pattern.exec(query);
    if (match) terms.push(...alias.expand(match));
  }
  return [...new Set(terms)];
}

export function classifyIntent(rawMessage: string): ChatIntent {
  const text = normalizeMessage(rawMessage);
  const family = detectFamily(text);
  const query = extractQuery(text, family);
  const base = { query, terms: expandTerms(query), family };
  if (COST_RE.test(text)) return { kind: 'cost', ...base };
  if (COMPARE_RE.test(text)) return { kind: 'compare', ...base };
  if (QUOTE_RE.test(text)) return { kind: 'quote', ...base };
  if (PRICE_RE.test(text)) return { kind: 'price', ...base };
  // 의도 키워드 없이 품번·모델만 보낸 경우(후보 칩 클릭 등)는 가격 조회로 본다
  if (query && /[A-Za-z]\S*\d|\d{3,}/.test(query)) return { kind: 'price', ...base };
  return { kind: 'help', ...base };
}
