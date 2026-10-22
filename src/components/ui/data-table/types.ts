import type { ReactNode } from 'react';

import type { SortDir, SortType, SortValue } from '@/lib/table/compare';
import type { ColumnFilterDef, FilterAccessorValue } from '@/lib/table/filter';

export type { SortDir, SortType, SortValue } from '@/lib/table/compare';

/** 현재 정렬 — 단일 열만 (#32 스펙 §2). null 이면 기본 순서 */
export type DataTableSort = { id: string; dir: SortDir } | null;

export type DataTableAlign = 'left' | 'center' | 'right';

/**
 * 열 정의의 필터 설정 = 서버 화이트리스트 타입(ColumnFilterDef) + 화면 전용 플래그.
 * `quick: true` 면 빠른 필터 바에 필드 버튼이 항상 보인다(표 열 필터 빠른 필터 바 §2.2 — 고정 필드). 아니면 "＋ N개 더" 안.
 * `pinned`(열 고정)와 다른 이름을 쓰고, ColumnFilterDef(서버·URL 화이트리스트)에는 넣지 않는다 — filterFieldsOf 가 떼어 낸다.
 */
export type DataTableColumnFilter = ColumnFilterDef & { quick?: boolean };

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
  /**
   * 열 필터 (표 열 필터 스펙 §2.1). 없으면 이 열은 필터할 수 없다(관리·목록·JSON 열).
   * id 는 URL 키 `f.<id>.<op>` 에 들어가므로 영문자만(`^[A-Za-z]+$`). `quick` 은 빠른 필터 바 고정 필드(DataTableColumnFilter).
   */
  filter?: DataTableColumnFilter;
  /** 클라이언트 필터 값. 기본은 sortValue (배열이면 원소 중 하나라도 맞으면 통과) */
  filterValue?: (row: T) => FilterAccessorValue;
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
