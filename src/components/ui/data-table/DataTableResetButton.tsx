'use client';

import type { LayoutColumn } from '@/lib/table/layout-storage';

import { Button } from '../button';
import { useTableLayout } from './useTableLayout';

export type DataTableResetButtonProps = {
  tableId: string;
  userId: string;
  /** DataTable 에 넘긴 것과 같은 열 배열 */
  columns: readonly LayoutColumn[];
  className?: string;
};

/**
 * '열 초기화' (#32 스펙 §5) — 표 툴바에 따로 두는 텍스트 버튼. 필터 초기화와 별개이고 정렬은 건드리지 않는다.
 * 같은 저장 키를 구독하므로 DataTable 과 어디에 놓든 함께 갱신된다. 기본 레이아웃이면 비활성.
 */
export function DataTableResetButton({
  tableId,
  userId,
  columns,
  className,
}: DataTableResetButtonProps) {
  const { isDefault, reset } = useTableLayout(tableId, userId, columns);
  return (
    <Button variant="ghost" size="sm" disabled={isDefault} onClick={reset} className={className}>
      열 초기화
    </Button>
  );
}
