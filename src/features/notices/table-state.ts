import type { ColumnFilterDef } from '@/lib/table/filter';

/**
 * 공지 관리 표 URL 상태 화이트리스트 (page-state-memory §2.2) — 표(클라이언트)와 저장·복원 정규화(서버) 공용.
 * 키 순서 = 열 순서 = URL·칩 순서.
 */
export const NOTICES_ADMIN_FILTER_DEFS = {
  title: { kind: 'text' },
  publishedAt: { kind: 'date' },
  authorName: { kind: 'text' },
  isImportant: {
    kind: 'enum',
    options: [
      { value: 'important', label: '중요' },
      { value: 'normal', label: '일반' },
    ],
  },
} as const satisfies Record<string, ColumnFilterDef>;

/** 정렬 가능한 열 (관리 열 제외) */
export const NOTICES_ADMIN_SORT_IDS = [
  'title',
  'publishedAt',
  'authorName',
  'isImportant',
] as const;
