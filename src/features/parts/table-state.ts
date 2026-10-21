import type { ColumnFilterDef } from '@/lib/table/filter';

/**
 * 파츠 "등록된 매핑" 표 URL 상태 화이트리스트 (page-state-memory §2.2) — 표(클라이언트)와 저장·복원 정규화(서버) 공용.
 * 파츠 목록 열은 정렬·필터하지 않는다(#32 §2, 열 필터 스펙 §2.1-2).
 */
export const PARTS_MAPPING_FILTER_DEFS = {
  model: { kind: 'text' },
} as const satisfies Record<string, ColumnFilterDef>;

export const PARTS_MAPPING_SORT_IDS = ['model'] as const;
