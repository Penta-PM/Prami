/**
 * 챗봇 품명 매칭 (§4.5.9 r6, AC-80 — Main 판정). 순수 함수.
 * 품명·검색어를 `[\s\-_/()]` 로 토큰화(대소문자 무시)해 **토큰 단위**로만 대조한다. 부분 문자열 매칭은 하지 않는다.
 * - 모델명 단위(검색어에 `Wapples-500` 같은 하이픈 모델명이 있을 때만): 하이픈을 살린 토큰으로 첫 토큰이 품명 첫 토큰과 같고
 *   나머지 검색어 토큰이 품명에 있다 → `Wapples 500 T2 S/W 업그레이드` 같은 별개 제품이 섞이지 않는다 (실데이터 기준 AC-80 "후보 2")
 * - 엄격: 검색어 앞 토큰(최대 2개)이 품명 앞 토큰과 같고, 나머지 검색어 토큰이 품명 토큰에 모두 있다
 *   → "Wapples-500" 은 `Wapples-500 (H500 T2)`·`(H500 T3)` 만, `Wapples-5000`·`Wapples-MS-Std-(WAPPLES-500 T2)` 는 제외
 * - 느슨(엄격 결과가 없을 때만): 검색어 토큰이 품명 토큰에 모두 있다 (예: 모델 번호만 입력)
 * 품번은 정확 일치(대소문자 무시)만 따로 본다.
 */
export const TOKEN_SPLIT = /[\s\-_/()]+/;

export function tokenize(value: string): string[] {
  return value
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter(Boolean);
}

const PREFIX_TOKENS = 2;

export function strictTokenMatch(nameTokens: readonly string[], queryTokens: readonly string[]) {
  if (queryTokens.length === 0) return false;
  const head = Math.min(PREFIX_TOKENS, queryTokens.length);
  for (let index = 0; index < head; index += 1) {
    if (nameTokens[index] !== queryTokens[index]) return false;
  }
  return queryTokens.slice(head).every((token) => nameTokens.includes(token));
}

export function looseTokenMatch(nameTokens: readonly string[], queryTokens: readonly string[]) {
  return queryTokens.length > 0 && queryTokens.every((token) => nameTokens.includes(token));
}

export type Named = { itemCode: string; itemName: string };

/** 하이픈을 살린 모델명 토큰 (`wapples-500`, `h500`, `t2`) */
export const MODEL_SPLIT = /[\s_/()]+/;

export function modelTokens(value: string): string[] {
  return value
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .split(MODEL_SPLIT)
    .filter(Boolean);
}

export function modelNameMatch(nameModels: readonly string[], queryModels: readonly string[]) {
  const [head, ...rest] = queryModels;
  if (!head || nameModels[0] !== head) return false;
  return rest.every(
    (token) => nameModels.includes(token) || tokenize(nameModels.join(' ')).includes(token),
  );
}

/** 후보 목록에서 토큰 규칙으로 거른다 (모델명 단위 → 엄격 → 느슨, 앞 단계에 결과가 있으면 거기서 멈춘다) */
export function matchByTokens<T extends Named>(rows: readonly T[], query: string): T[] {
  const queryModels = modelTokens(query);
  if (queryModels.some((token) => token.includes('-'))) {
    const byModel = rows.filter((row) => modelNameMatch(modelTokens(row.itemName), queryModels));
    if (byModel.length > 0) return byModel;
  }
  const queryTokens = tokenize(query);
  const withTokens = rows.map((row) => ({ row, tokens: tokenize(row.itemName) }));
  const strict = withTokens.filter(({ tokens }) => strictTokenMatch(tokens, queryTokens));
  const chosen =
    strict.length > 0
      ? strict
      : withTokens.filter(({ tokens }) => looseTokenMatch(tokens, queryTokens));
  return chosen.map(({ row }) => row);
}

/** SQL 1차 거르기에 쓸 가장 긴 검색어 토큰 (ILIKE 로 좁힌 뒤 토큰 규칙을 적용) */
export function anchorToken(query: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
}
