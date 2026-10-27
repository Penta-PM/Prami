/**
 * 입찰 공고 분류 키워드 (조달이 통합 UI-8 — procurement.bid_keywords). 순수 모듈 — 화면 입력 검사와 서버 검증이 같은 규칙을 쓴다.
 * 그룹 = 제품 3개 + '제외'(이 단어가 들어간 공고는 버림). 값은 DB CHECK(bid_keywords_product_check)와 같다.
 */
export const BID_KEYWORD_GROUPS = [
  { key: 'WAPPLES', label: 'WAPPLES', placeholder: '키워드 추가', note: null },
  { key: 'D.AMO', label: 'D.AMO', placeholder: '키워드 추가', note: null },
  { key: 'iSIGN', label: 'iSIGN', placeholder: '키워드 추가', note: null },
  {
    key: '제외',
    label: '제외 단어',
    placeholder: '제외할 단어',
    note: '이 단어가 들어간 공고는 버립니다',
  },
] as const;

export type BidKeywordGroup = (typeof BID_KEYWORD_GROUPS)[number]['key'];

export const BID_KEYWORD_GROUP_KEYS = BID_KEYWORD_GROUPS.map(
  (group) => group.key,
) as readonly BidKeywordGroup[];

/** 키워드 최대 길이 (글자 = 코드 포인트). 원본에는 상한이 없다 — 공고명 한 단어·구 수준으로 제한 */
export const BID_KEYWORD_MAX_LENGTH = 50;

export function isBidKeywordGroup(value: unknown): value is BidKeywordGroup {
  return BID_KEYWORD_GROUP_KEYS.some((key) => key === value);
}

export type BidKeywordCheck = { ok: true; keyword: string } | { ok: false; message: string };

/** 제어 문자(Cc)·서식 문자(Cf — 폭 없는 공백·방향 제어·BOM 등 보이지 않는 문자) */
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/u;

/**
 * 입력 정규화·검사: 앞뒤 공백 제거 + 연속 공백 1칸(원본 KeywordPanel 과 같은 규칙), 빈 값·길이 초과·제어/보이지 않는 문자 거부.
 * 공백 정리 전에 제어 문자를 본다 — 탭·줄바꿈도 거부한다(입력창에는 들어오지 않는 값).
 */
export function normalizeBidKeyword(raw: unknown): BidKeywordCheck {
  if (typeof raw !== 'string') return { ok: false, message: '키워드를 입력하세요' };
  if (INVISIBLE_RE.test(raw)) {
    return { ok: false, message: '제어 문자나 보이지 않는 문자는 넣을 수 없습니다' };
  }
  const keyword = raw.trim().replace(/\s+/g, ' ');
  if (!keyword) return { ok: false, message: '키워드를 입력하세요' };
  if ([...keyword].length > BID_KEYWORD_MAX_LENGTH) {
    return { ok: false, message: `키워드는 ${BID_KEYWORD_MAX_LENGTH}자 이하로 입력하세요` };
  }
  return { ok: true, keyword };
}

/**
 * 중복 비교 키 (Plan msg_304e23427228): 정규화한 값에서 라틴 문자(A–Z)만 소문자로 — 'WAF' 와 'waf' 는 같은 키워드.
 * 한글 등 그 밖의 문자는 그대로. 서버 SQL 의 `lower(keyword collate "C")`(ASCII 만 소문자)와 같은 규칙.
 */
export function bidKeywordKey(keyword: string): string {
  return keyword.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** 정규화 + 같은 그룹 안 중복 검사 (공백 정리 후, 라틴 문자 대소문자 무시 — bidKeywordKey) */
export function checkBidKeyword(raw: unknown, existing: readonly string[]): BidKeywordCheck {
  const checked = normalizeBidKeyword(raw);
  if (!checked.ok) return checked;
  const key = bidKeywordKey(checked.keyword);
  const duplicate = existing.find((keyword) => bidKeywordKey(keyword) === key);
  if (duplicate !== undefined) {
    return { ok: false, message: `이미 있는 키워드입니다: ${duplicate}` };
  }
  return checked;
}
