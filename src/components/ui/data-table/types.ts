import type { ReactNode } from 'react';

import type { SortDir, SortType, SortValue } from '@/lib/table/compare';

export type { SortDir, SortType, SortValue } from '@/lib/table/compare';

/** 현재 정렬 — 단일 열만 (#32 스펙 §2). null 이면 기본 순서 */
export type DataTableSort = { id: string; dir: SortDir } | null;

export type DataTableAlign = 'left' | 'center' | 'right';

/**
 * 열 정의 (#32 스펙 §4). 헤더와 본문은 같은 (정렬된) 열 배열로 렌더해 어긋남을 구조적으로 막는다.
 * 관리·액션 열은 `type: 'none', pinned: 'end'` — 정렬·재배치하지 않고 아이콘·aria-sort 도 없다.
 */
export type DataTableColumn<T> = {
  /** 저장 키·정렬 키 (서버 모드에서는 URL sort 값) */
  id: string;
  header: ReactNode;
  /** 라이브 영역 안내용 이름. 없으면 header 가 문자열일 때 그 값, 아니면 id */
  label?: string;
  type: SortType;
  /** 기본값: type !== 'none' 이고 (서버 모드이거나 sortValue 가 있음) */
  sortable?: boolean;
  /** 클라이언트 정렬 값. 빈 값(null·''·'—')은 방향과 관계없이 맨 뒤 */
  sortValue?: (row: T) => SortValue;
  /** type 'status' 의 정의 순서 (STATUS_ORDERS) */
  statusOrder?: readonly string[];
  /** 기본 true. 터치에서는 항상 꺼진다 */
  resizable?: boolean;
  /** 기본 true. pinned 열은 항상 이동 불가 */
  reorderable?: boolean;
  pinned?: 'start' | 'end';
  /** 기본 60 (MIN_COL_WIDTH) */
  minWidth?: number;
  /** 기본 600 (MAX_COL_WIDTH) */
  maxWidth?: number;
  align?: DataTableAlign;
  cell: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};
