'use client';

import { useState } from 'react';

import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { PROCUREMENT_PRODUCTS } from '@/lib/procurement/constants';
import { EMPTY_VALUE } from '@/lib/procurement/format';
import { isOurManufacturer } from '@/lib/procurement/our-company';

import { DetailCategoryCell } from './DetailCategoryField';
import type { AdminItemRow } from './types';

type ReviewQueueCardProps = {
  rows: AdminItemRow[];
  total: number;
  detailOptions: Record<string, string[]>;
  busy: boolean;
  /** onDone: 실제로 처리된 뒤 체크를 비운다 */
  onInclude: (rows: AdminItemRow[], options: { all: boolean }, onDone: () => void) => void;
  onExclude: (rows: AdminItemRow[], onDone: () => void) => void;
  onEdit: (row: AdminItemRow, patch: { product?: string; detailCategory?: string | null }) => void;
};

const COLUMNS = ['등록일자', '제품명', '세부분류', '제조사명', '물품식별번호', '품목'] as const;

/**
 * 일일 신규 품목 (검토 대기) — 매일 수집된 신규 물품식별번호를 데이터에 넣을지 관리자가 정한다 (원본 ItemManager 1번 카드).
 * 선택 추가·일괄 추가·선택 삭제, 행 내 제품명·세부분류 편집(바로 저장). 제품 미정('기타')은 제품을 고른 뒤 추가한다.
 */
export function ReviewQueueCard({
  rows,
  total,
  detailOptions,
  busy,
  onInclude,
  onExclude,
  onEdit,
}: ReviewQueueCardProps) {
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const ids = rows.map((row) => row.id);
  // 목록이 바뀌면(처리·새로고침) 사라진 행의 체크는 버린다
  const checkedRows = rows.filter((row) => checked.has(row.id));
  const allChecked = rows.length > 0 && checkedRows.length === rows.length;
  const someChecked = checkedRows.length > 0 && !allChecked;

  const toggle = (id: number) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(ids));
  const clear = (done: AdminItemRow[]) =>
    setChecked((previous) => {
      const next = new Set(previous);
      for (const row of done) next.delete(row.id);
      return next;
    });

  const include = (target: AdminItemRow[], all = false) =>
    onInclude(target, { all }, () => clear(target));
  const exclude = (target: AdminItemRow[]) => onExclude(target, () => clear(target));

  return (
    <Card
      aria-labelledby="item-review-title"
      role="region"
      className={cn(
        'flex flex-col gap-4 p-0',
        total > 0 && 'shadow-[inset_0_0_0_1.5px_var(--lime-500)]',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle id="item-review-title" className="flex items-center gap-2">
            일일 신규 품목
            <span
              className={cn(
                'rounded-pill px-2.5 py-0.5 text-[13px] font-bold tabular-nums',
                total > 0 ? 'bg-red-600 text-white' : 'bg-gray-100 text-text-tertiary',
              )}
            >
              {total.toLocaleString('ko-KR')}건
            </span>
          </CardTitle>
          <p className="m-0 text-[12px] text-text-tertiary">
            데이터에 넣을 품목은 추가, 뺄 품목은 삭제하세요 · 제품명과 세부분류는 표에서 바로 고칠
            수 있고, 분류되지 않은 품목은 제품을 고른 뒤 추가
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || checkedRows.length === 0}
            onClick={() => include(checkedRows)}
          >
            선택 추가{checkedRows.length ? ` (${checkedRows.length})` : ''}
          </Button>
          <Button
            size="sm"
            disabled={busy || rows.length === 0}
            onClick={() => include(rows, true)}
          >
            일괄 추가
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy || checkedRows.length === 0}
            onClick={() => exclude(checkedRows)}
          >
            선택 삭제
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 border-t border-border-subtle px-5 py-7 text-center text-[13px] text-text-tertiary">
          새로 들어온 품목이 없습니다. 매일 수집된 신규 물품식별번호가 여기에 올라옵니다.
        </p>
      ) : (
        <div className="border-t border-border-subtle pb-2">
          <Table aria-label="일일 신규 품목" className="min-w-[860px]">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    size="sm"
                    aria-label="일일 신규 품목 전체 선택"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onChange={toggleAll}
                  />
                </TableHeaderCell>
                {COLUMNS.map((column) => (
                  <TableHeaderCell key={column}>{column}</TableHeaderCell>
                ))}
                <TableHeaderCell className="text-center">관리</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const undecided = row.product === '기타';
                const label = `${row.itemId} ${row.itemName ?? ''}`.trim();
                return (
                  <TableRow key={row.id} className={cn(checked.has(row.id) && 'bg-purple-500/5')}>
                    <TableCell className="py-2">
                      <Checkbox
                        size="sm"
                        aria-label={`${label} 선택`}
                        checked={checked.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary tabular-nums">
                      {row.registeredOn ?? EMPTY_VALUE}
                    </TableCell>
                    <TableCell className="min-w-[132px] py-2">
                      <Select
                        aria-label={`${label} 제품명`}
                        title={
                          undecided
                            ? '제품을 골라야 추가할 수 있어요'
                            : '자동 분류된 제품 — 다르면 바꿔 주세요'
                        }
                        value={row.product}
                        disabled={busy}
                        onChange={(event) => onEdit(row, { product: event.target.value })}
                        className={cn('py-1.5 font-semibold', undecided && 'text-red-600')}
                      >
                        {undecided ? (
                          <option value="기타" disabled>
                            제품 선택
                          </option>
                        ) : null}
                        {PROCUREMENT_PRODUCTS.map((product) => (
                          <option key={product} value={product}>
                            {product}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="min-w-[150px] py-2">
                      <DetailCategoryCell
                        value={row.detailCategory}
                        product={row.product}
                        options={detailOptions[row.product] ?? []}
                        label={`${label} 세부분류`}
                        disabled={busy}
                        onCommit={(detailCategory) => onEdit(row, { detailCategory })}
                      />
                    </TableCell>
                    <TableCell
                      title={row.manufacturer ?? undefined}
                      className={cn(
                        'max-w-[160px] truncate',
                        isOurManufacturer(row.manufacturer) && 'font-bold text-accent-ours',
                      )}
                    >
                      {row.manufacturer || EMPTY_VALUE}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{row.itemId}</TableCell>
                    <TableCell className="min-w-[200px]">{row.itemName || EMPTY_VALUE}</TableCell>
                    <TableCell className="py-2">
                      <div className="flex justify-center gap-1.5">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy}
                          aria-label={`${label} 추가`}
                          onClick={() => include([row])}
                        >
                          추가
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`${label} 삭제`}
                          onClick={() => exclude([row])}
                          className="text-red-600"
                        >
                          삭제
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {total > rows.length ? (
            <p className="m-0 px-5 pt-2 text-[12px] text-text-tertiary">
              최근 {rows.length.toLocaleString('ko-KR')}건만 보입니다 (외{' '}
              {(total - rows.length).toLocaleString('ko-KR')}
              건) — 처리하면 다음 품목이 올라옵니다.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
