'use client';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { formatDateTime } from '@/lib/date-format';
import { EMPTY_VALUE } from '@/lib/procurement/format';
import type { Paged } from '@/server/procurement/shared';

import { ItemPager } from './ItemPager';
import type { ItemTrashRow } from './types';

const COLUMNS = ['삭제 시각', '삭제한 사람', '제품명', '제조사명', '물품식별번호', '품목'] as const;

/**
 * 휴지통 — 삭제한 물품(지우지 않고 status excluded 로 남겨 두므로 되살릴 수 있다, 원본 TrashPanel).
 * 삭제자 = 그 물품의 마지막 exclude 이력(item_changes).
 */
export function ItemTrashPanel({
  trash,
  busy,
  onRestore,
  onPage,
}: {
  trash: Paged<ItemTrashRow>;
  busy: boolean;
  onRestore: (row: ItemTrashRow) => void;
  onPage: (page: number) => void;
}) {
  if (trash.total === 0) {
    return (
      <p
        role="region"
        aria-label="휴지통"
        className="m-0 border-t border-border-subtle bg-gray-75/60 px-5 py-6 text-center text-[13px] text-text-tertiary"
      >
        휴지통이 비어 있어요. 삭제한 물품은 여기로 옮겨지고, 언제든 되살릴 수 있어요.
      </p>
    );
  }
  return (
    <div
      role="region"
      aria-label="휴지통"
      className="flex flex-col gap-2 border-t border-border-subtle bg-gray-75/60 px-5 py-3"
    >
      <p className="m-0 text-[12px] text-text-tertiary">
        삭제한 물품 {trash.total.toLocaleString('ko-KR')}건 · 되살리면 원래 자리(등록 품목, 제품
        미정이면 일일 신규 품목)로 돌아가요.
      </p>
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="휴지통 품목" className="min-w-[760px]">
          <TableHead>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHeaderCell key={column}>{column}</TableHeaderCell>
              ))}
              <TableHeaderCell className="text-center">복원</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {trash.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-text-secondary tabular-nums">
                  {row.deletedAt ? formatDateTime(row.deletedAt) : EMPTY_VALUE}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {row.deletedBy ?? EMPTY_VALUE}
                </TableCell>
                <TableCell className="font-semibold whitespace-nowrap">{row.product}</TableCell>
                <TableCell className="max-w-[160px] truncate" title={row.manufacturer ?? undefined}>
                  {row.manufacturer || EMPTY_VALUE}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{row.itemId}</TableCell>
                <TableCell className="min-w-[180px]">{row.itemName || EMPTY_VALUE}</TableCell>
                <TableCell className="py-2 text-center">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    aria-label={`${row.itemId} ${row.product} 되살리기`}
                    onClick={() => onRestore(row)}
                  >
                    되살리기
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ItemPager
        page={trash.page}
        pageCount={trash.pageCount}
        total={trash.total}
        label="휴지통 페이지"
        onPage={onPage}
      />
    </div>
  );
}
