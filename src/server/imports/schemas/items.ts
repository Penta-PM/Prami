import { mapItemStatus } from '@/lib/constants/item-status';

import { optionalText, requiredText } from '../cells';

import type { SheetColumn, SheetSpec } from './types';

/**
 * ERP 품목조회 파일 (§4.3.2) — 포맷 미확인(Q-02). 최소 계약 헤더만 정의하고 나머지 컬럼은 raw 로 보존한다.
 * 실제 파일이 오면 이 헤더 상수(원문 헤더명)와 ITEM_STATUS_MAP 만 고친다 (스키마 변경 없음이 목표).
 */
export const ITEM_COLUMNS = [
  { key: 'itemCode', header: '품번', schema: requiredText, required: true },
  { key: 'itemName', header: '품명', schema: requiredText, required: true },
  { key: 'categoryMajor', header: '대분류', schema: optionalText, required: false },
  { key: 'categoryMid', header: '중분류', schema: optionalText, required: false },
  { key: 'categoryMinor', header: '소분류', schema: optionalText, required: false },
  { key: 'itemStatusRaw', header: '품목상태', schema: optionalText, required: true },
] as const satisfies readonly SheetColumn[];

export type ItemRow = {
  itemCode: string;
  itemName: string;
  categoryMajor: string | null;
  categoryMid: string | null;
  categoryMinor: string | null;
  itemStatusRaw: string | null;
  raw: Record<string, unknown>;
};

export const ITEM_SPEC: SheetSpec<ItemRow> = {
  label: '품목조회',
  preferredSheets: [],
  columns: ITEM_COLUMNS,
  build: (values, extras) => ({ ...(values as Omit<ItemRow, 'raw'>), raw: extras }),
  uniqueKey: { describe: '같은 품번이 이미 있습니다', of: (row) => row.itemCode },
};

/** 매핑되지 않는 상태 라벨 (경고용) */
export function isUnmappedStatus(raw: string | null): boolean {
  return raw !== null && mapItemStatus(raw) === null;
}
