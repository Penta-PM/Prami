/**
 * 자사 제조사 판정 (조달이 통합 — Plan msg_a06f54d8bd3e). 자사 점유율·`--accent-ours` 강조가 모두 이 목록 하나를 쓴다
 * (SQL 쪽은 server/procurement/shared.ts isOursSql 이 같은 목록·같은 정규화로 조건을 만든다).
 *
 * 규칙: 제조사명과 목록 항목을 똑같이 정규화(공백 전부 제거 + 라틴 대문자 A-Z → 소문자)한 뒤, 제조사명이 항목 하나라도 **포함**하면 자사.
 * 표기 변형(㈜·(주)·띄어쓰기·영문 대소문자)을 넘기기 위함. 회사명 표기가 늘면 이 목록에만 더한다.
 */
export const OUR_COMPANY_NAMES = ['펜타시큐리티', 'PENTASECURITY'] as const;

/** 공백 제거 + ASCII 대문자만 소문자 (SQL `lower(... collate "C")` 와 같은 범위 — 한글 등은 그대로) */
export function normalizeCompanyName(name: string): string {
  return name.replace(/\s+/g, '').replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** 정규화된 목록 (빈 항목 제외) — SQL 조건도 이 값을 파라미터로 쓴다 */
export const NORMALIZED_OUR_COMPANY_NAMES: readonly string[] = OUR_COMPANY_NAMES.map(
  normalizeCompanyName,
).filter((name) => name.length > 0);

export function isOurManufacturer(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalizeCompanyName(name);
  return NORMALIZED_OUR_COMPANY_NAMES.some((entry) => normalized.includes(entry));
}
