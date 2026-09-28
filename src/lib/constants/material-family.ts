/**
 * 원가 제품군 파생 (§4.3.4 product_family, §11 Q-03 가정 채택).
 * 자재번호 접두 2자로 정하고, 매핑에 없는 접두(W3·W8 등)는 `기타`. 라인업 칩은 매핑 확정 전까지 숨긴다.
 */
export const MATERIAL_FAMILY_PREFIXES: Readonly<Record<string, string>> = {
  W1: 'WAPPLES',
  W2: 'D.AMO',
  W4: 'iSIGN',
};

export const MATERIAL_FAMILY_OTHER = '기타';

/** 탭 순서: 매핑된 제품군 → 기타 */
export const MATERIAL_FAMILIES: readonly string[] = [
  ...new Set(Object.values(MATERIAL_FAMILY_PREFIXES)),
  MATERIAL_FAMILY_OTHER,
];

export function deriveMaterialFamily(materialCode: string): string {
  return (
    MATERIAL_FAMILY_PREFIXES[materialCode.trim().slice(0, 2).toUpperCase()] ?? MATERIAL_FAMILY_OTHER
  );
}
