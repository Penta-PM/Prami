/**
 * 원가 표 서버 정렬 화이트리스트 (#32 스펙 §3) — 클라이언트·서버 공용(서버 모듈을 import 하지 않는다).
 * '단위' 열(스펙 Q3 A, 셀 = row.unit)의 정렬 id 는 'unit'. 관리(actions) 열은 정렬하지 않는다.
 */
export const COST_SORT_IDS = [
  'code',
  'name',
  'unit',
  'cost',
  'effectiveFrom',
  'period',
  'status',
] as const;
export type CostSortId = (typeof COST_SORT_IDS)[number];
