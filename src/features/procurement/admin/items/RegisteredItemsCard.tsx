'use client';

import { useId, useState, type FormEvent } from 'react';

import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Input,
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
import type { AdminItemSortId, AdminItemsFilter } from '@/lib/procurement/admin-items-filter';
import type { Paged } from '@/server/procurement/shared';

import { IsignCategorySelect } from './DetailCategoryField';
import { ItemAddForm, type ItemAddValues } from './ItemAddForm';
import { ItemPager } from './ItemPager';
import { ItemTrashPanel } from './ItemTrashPanel';
import type { AdminItemRow, ItemTrashRow } from './types';

export type RegisteredFilter = { q: string; product: string | null };
export type BulkPatch = { product?: string; detailCategory?: string };

type RegisteredItemsCardProps = {
  registered: Paged<AdminItemRow>;
  trash: Paged<ItemTrashRow>;
  detailOptions: Record<string, string[]>;
  filter: AdminItemsFilter;
  busy: boolean;
  onFilter: (filter: RegisteredFilter) => void;
  onSort: (id: AdminItemSortId) => void;
  onPage: (page: number) => void;
  onTrashPage: (page: number) => void;
  onAdd: (values: ItemAddValues) => Promise<string | null>;
  onEdit: (row: AdminItemRow) => void;
  /** onDone: 실제로 처리된 뒤(확인 모달에서 취소하지 않았을 때) 선택을 비운다 */
  onExclude: (rows: AdminItemRow[], onDone?: () => void) => void;
  onBulkEdit: (rows: AdminItemRow[], patch: BulkPatch, onDone: () => void) => void;
  onRestore: (row: ItemTrashRow) => void;
};

const COLUMNS: readonly { id: AdminItemSortId; label: string }[] = [
  { id: 'registeredOn', label: '등록일자' },
  { id: 'product', label: '제품명' },
  { id: 'detailCategory', label: '세부분류' },
  { id: 'manufacturer', label: '제조사명' },
  { id: 'itemId', label: '물품식별번호' },
  { id: 'itemName', label: '품목' },
];

/**
 * 등록 품목 관리 (원본 ItemManager 2번 카드): 검색·제품 필터(서버), 체크박스 일괄 변경(제품명·세부분류)·선택 삭제,
 * 단건 직접 추가, 행 수정·삭제, 휴지통(되살리기).
 */
export function RegisteredItemsCard({
  registered,
  trash,
  detailOptions,
  filter,
  busy,
  onFilter,
  onSort,
  onPage,
  onTrashPage,
  onAdd,
  onEdit,
  onExclude,
  onBulkEdit,
  onRestore,
}: RegisteredItemsCardProps) {
  const [showAdd, setShowAdd] = useState(false);
  // 휴지통 페이지가 URL 에 있으면(딥링크·뒤로 가기) 펼친 채로
  const [showTrash, setShowTrash] = useState(filter.trashPage > 1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [bulk, setBulk] = useState({ product: '', category: '' });
  const [query, setQuery] = useState(filter.q);
  const [baseQuery, setBaseQuery] = useState(filter.q);
  // URL 의 검색어가 바뀌면(뒤로 가기·복원) 입력도 맞춘다 — 렌더 중 비교 (React 권장 패턴)
  if (baseQuery !== filter.q) {
    setBaseQuery(filter.q);
    setQuery(filter.q);
  }
  const categoryListId = useId();

  const rows = registered.rows;
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const toggle = (id: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));

  // 일괄 변경 대상이 iSIGN 이면(제품을 iSIGN 으로 바꾸거나, 고른 품목이 모두 iSIGN) 세부분류를 목록에서 고른다
  const bulkIsIsign =
    bulk.product === 'iSIGN' ||
    (!bulk.product &&
      selectedRows.length > 0 &&
      selectedRows.every((row) => row.product === 'iSIGN'));
  const bulkReady = Boolean(bulk.product || bulk.category.trim());
  const allCategories = [...new Set(Object.values(detailOptions).flat())].sort((a, b) =>
    a.localeCompare(b, 'ko'),
  );

  const applyBulk = () => {
    const patch: BulkPatch = {};
    if (bulk.product) patch.product = bulk.product;
    if (bulk.category.trim()) patch.detailCategory = bulk.category.trim();
    onBulkEdit(selectedRows, patch, () => {
      setBulk({ product: '', category: '' });
      setSelected(new Set());
    });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    setSelected(new Set());
    onFilter({ q: query, product: filter.product });
  };

  const filtered = Boolean(filter.q.trim() || filter.product);

  return (
    <Card role="region" aria-labelledby="item-registered-title" className="flex flex-col gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-baseline gap-2.5">
          <CardTitle id="item-registered-title">등록 품목</CardTitle>
          <span className="text-[13px] text-text-tertiary tabular-nums">
            {registered.total.toLocaleString('ko-KR')}건{filtered ? ' (필터 적용)' : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={showTrash ? 'primary' : 'secondary'}
            aria-expanded={showTrash}
            title="삭제한 물품을 보고 되살리기"
            onClick={() => setShowTrash((value) => !value)}
          >
            휴지통{trash.total ? ` ${trash.total.toLocaleString('ko-KR')}` : ''}
          </Button>
          <Button
            size="sm"
            variant={showAdd ? 'secondary' : 'primary'}
            aria-expanded={showAdd}
            onClick={() => setShowAdd((value) => !value)}
          >
            {showAdd ? '닫기' : '+ 직접 추가'}
          </Button>
        </div>
      </div>

      {showTrash ? (
        <ItemTrashPanel trash={trash} busy={busy} onRestore={onRestore} onPage={onTrashPage} />
      ) : null}

      {showAdd ? <ItemAddForm onSubmit={onAdd} /> : null}

      <form
        role="search"
        aria-label="등록 품목 검색"
        onSubmit={search}
        className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-5 py-3"
      >
        <Select
          aria-label="제품명 필터"
          value={filter.product ?? ''}
          onChange={(event) => {
            setSelected(new Set());
            onFilter({ q: query, product: event.target.value || null });
          }}
          className="w-[140px]"
        >
          <option value="">제품 전체</option>
          {PROCUREMENT_PRODUCTS.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
          <option value="기타">기타</option>
        </Select>
        <Input
          aria-label="물품식별번호·품목·제조사 검색"
          placeholder="물품식별번호·품목·제조사"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          wrapperClassName="w-auto min-w-[180px] flex-1"
        />
        <Button type="submit" size="sm">
          검색
        </Button>
      </form>

      {selectedRows.length > 0 ? (
        <div
          role="group"
          aria-label="선택한 품목 일괄 변경"
          className="flex flex-wrap items-center gap-2 border-t border-border-subtle bg-purple-500/5 px-5 py-3"
        >
          <span className="mr-1 text-[14px] font-bold text-purple-600 tabular-nums">
            {selectedRows.length}건 선택
          </span>
          <Select
            aria-label="제품명 일괄 변경"
            value={bulk.product}
            onChange={(event) => setBulk({ ...bulk, product: event.target.value })}
            className="w-auto"
          >
            <option value="">제품명 변경 안 함</option>
            {PROCUREMENT_PRODUCTS.map((product) => (
              <option key={product} value={product}>
                제품명 → {product}
              </option>
            ))}
          </Select>
          {bulkIsIsign ? (
            <IsignCategorySelect
              label="세부분류 일괄 변경"
              allowEmpty
              emptyLabel="iSIGN 세부분류 변경 안 함"
              value={bulk.category}
              onChange={(category) => setBulk({ ...bulk, category })}
              className="w-[220px] py-2.5"
            />
          ) : (
            <>
              <Input
                aria-label="세부분류 일괄 입력"
                placeholder="세부분류 일괄 입력"
                list={categoryListId}
                value={bulk.category}
                onChange={(event) => setBulk({ ...bulk, category: event.target.value })}
                wrapperClassName="w-[200px]"
              />
              <datalist id={categoryListId}>
                {allCategories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </>
          )}
          <Button size="sm" variant="primary" disabled={busy || !bulkReady} onClick={applyBulk}>
            적용
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => onExclude(selectedRows, () => setSelected(new Set()))}
          >
            선택 삭제
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            선택 해제
          </Button>
        </div>
      ) : null}

      <div className="border-t border-border-subtle">
        {rows.length === 0 ? (
          <p className="m-0 px-5 py-7 text-center text-[13px] text-text-tertiary">
            {filtered ? '조건에 맞는 등록 품목이 없습니다.' : '등록된 품목이 없습니다.'}
          </p>
        ) : (
          <Table aria-label="등록 품목" className="min-w-[860px]">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    size="sm"
                    aria-label="보이는 품목 전체 선택"
                    checked={allSelected}
                    indeterminate={selectedRows.length > 0 && !allSelected}
                    onChange={toggleAll}
                  />
                </TableHeaderCell>
                {COLUMNS.map((column) => {
                  const active = filter.sort?.id === column.id ? filter.sort.dir : null;
                  return (
                    <TableHeaderCell
                      key={column.id}
                      aria-sort={
                        active === 'asc'
                          ? 'ascending'
                          : active === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      <button
                        type="button"
                        onClick={() => onSort(column.id)}
                        className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-semibold text-inherit"
                      >
                        {column.label}
                        <span aria-hidden="true">
                          {active === 'asc' ? '▲' : active === 'desc' ? '▼' : ''}
                        </span>
                      </button>
                    </TableHeaderCell>
                  );
                })}
                <TableHeaderCell className="text-center">관리</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const label = `${row.itemId} ${row.product}`;
                return (
                  <TableRow key={row.id} className={cn(selected.has(row.id) && 'bg-purple-500/5')}>
                    <TableCell className="py-2">
                      <Checkbox
                        size="sm"
                        aria-label={`${label} 선택`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary tabular-nums">
                      {row.registeredOn ?? EMPTY_VALUE}
                    </TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {row.product}
                      {row.source === 'manual' ? (
                        <span className="ml-1.5 rounded-pill bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                          직접
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.detailCategory || EMPTY_VALUE}
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
                          disabled={busy}
                          aria-label={`${label} 수정`}
                          onClick={() => onEdit(row)}
                        >
                          수정
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`${label} 삭제`}
                          onClick={() => onExclude([row])}
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
        )}
      </div>
      <div className="border-t border-border-subtle px-5 py-3">
        <ItemPager
          page={registered.page}
          pageCount={registered.pageCount}
          total={registered.total}
          label="등록 품목 페이지"
          onPage={(page) => {
            setSelected(new Set());
            onPage(page);
          }}
        />
      </div>
    </Card>
  );
}
