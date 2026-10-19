import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataTable, filterFieldsOf, type DataTableColumn } from '@/components/ui/data-table';
import { STATUS_ORDERS } from '@/lib/table/compare';
import type { FilterCondition } from '@/lib/table/filter';

/** 공용 DataTable 의 열 필터 API (표 열 필터 스펙 §2.1·§2.5-3·6) — 정렬 전 필터·헤더 점·라이브 영역 알림 */
type Row = { id: string; name: string; code: string; price: number | null; role: 'ADMIN' | 'USER' };

const ROWS: Row[] = [
  { id: '1', name: 'charlie', code: 'C-1', price: 300, role: 'USER' },
  { id: '2', name: 'Alpha', code: 'A-9', price: null, role: 'ADMIN' },
  { id: '3', name: 'bravo', code: 'B-1', price: 100, role: 'USER' },
  { id: '4', name: 'alpine', code: 'A-2', price: 200, role: 'ADMIN' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: '이름',
    type: 'text',
    sortValue: (r) => r.name,
    // 필터는 이름·코드 둘 다 본다 (filterValue 가 sortValue 보다 우선)
    filterValue: (r) => [r.name, r.code],
    filter: { kind: 'text' },
    cell: (r) => r.name,
  },
  {
    id: 'price',
    header: '판매가',
    type: 'number',
    sortValue: (r) => r.price,
    filter: { kind: 'number' },
    cell: (r) => (r.price === null ? '—' : String(r.price)),
  },
  {
    id: 'role',
    header: '역할',
    type: 'status',
    statusOrder: STATUS_ORDERS.role,
    sortValue: (r) => r.role,
    filter: {
      kind: 'enum',
      options: [
        { value: 'ADMIN', label: 'ADMIN' },
        { value: 'USER', label: 'USER' },
      ],
    },
    cell: (r) => r.role,
  },
  { id: 'actions', header: '관리', type: 'none', pinned: 'end', cell: () => '…' },
];

const table = () => screen.getByRole('table', { name: '표' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const liveRegion = () => document.querySelector('[aria-live="polite"]');

function renderTable(filters: readonly FilterCondition[], mode: 'client' | 'server' = 'client') {
  const props = {
    tableId: 't',
    userId: 'u1',
    columns: COLUMNS,
    rows: ROWS,
    getRowKey: (r: Row) => r.id,
    'aria-label': '표',
    sortMode: mode,
    ...(mode === 'server' ? { sort: null } : {}),
    empty: <span>비어 있음</span>,
  } as const;
  const view = render(<DataTable {...props} filters={filters} />);
  return {
    ...view,
    update: (next: readonly FilterCondition[], filteredTotal?: number) =>
      view.rerender(<DataTable {...props} filters={next} filteredTotal={filteredTotal} />),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('DataTable 열 필터', () => {
  it('client 모드: 정렬 전에 거른다 — 2개 조건 AND, filterValue 우선', async () => {
    renderTable([
      { col: 'name', op: 'has', value: 'a-' }, // 코드 'A-9'·'A-2' (대소문자 무시)
      { col: 'role', op: 'in', values: ['ADMIN'] },
    ]);
    expect(names()).toEqual(['Alpha', 'alpine']);
    await userEvent.click(within(th('이름')).getByRole('button'));
    await userEvent.click(within(th('이름')).getByRole('button'));
    expect(names()).toEqual(['alpine', 'Alpha']);
  });

  it('숫자 범위 gte+lte 를 함께 쓰고, 빈 값은 맞지 않는다', () => {
    renderTable([
      { col: 'price', op: 'gte', value: '150' },
      { col: 'price', op: 'lte', value: '300' },
    ]);
    expect(names()).toEqual(['charlie', 'alpine']);
  });

  it('조건이 걸린 열 헤더에만 aria-hidden 점 — 헤더 이름·버튼 수는 그대로', () => {
    renderTable([{ col: 'role', op: 'in', values: ['USER'] }]);
    expect(th('역할')).toHaveAttribute('data-filtered', 'true');
    const dot = within(th('역할')).getByTestId('data-table-filter-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(within(th('역할')).getAllByRole('button')).toHaveLength(1);
    expect(th('이름')).not.toHaveAttribute('data-filtered');
    expect(within(th('이름')).queryByTestId('data-table-filter-dot')).toBeNull();
  });

  it('결과가 없으면 empty 를 보인다', () => {
    renderTable([{ col: 'name', op: 'eq', value: 'zulu' }]);
    expect(within(table()).getByText('비어 있음')).toBeInTheDocument();
  });

  it('조건이 바뀌면 라이브 영역에 "필터 적용 · M건", 모두 풀리면 "필터 해제 · N건". 첫 렌더는 알리지 않는다', () => {
    const { update } = renderTable([{ col: 'role', op: 'in', values: ['ADMIN'] }]);
    expect(liveRegion()).toHaveTextContent('');
    update([{ col: 'role', op: 'in', values: ['USER'] }]);
    expect(liveRegion()).toHaveTextContent('필터 적용 · 2건');
    // 같은 조건(새 배열)으로 다시 렌더해도 다시 알리지 않는다
    update([{ col: 'role', op: 'in', values: ['USER'] }]);
    expect(liveRegion()).toHaveTextContent('필터 적용 · 2건');
    update([]);
    expect(liveRegion()).toHaveTextContent('필터 해제 · 4건');
  });

  it('server 모드: 행을 그대로 쓰고(서버가 이미 거름) 점·알림은 같다 — 알림 건수는 filteredTotal', () => {
    const { update } = renderTable([], 'server');
    update([{ col: 'name', op: 'has', value: 'zzz' }], 57);
    expect(names()).toEqual(['charlie', 'Alpha', 'bravo', 'alpine']);
    expect(th('이름')).toHaveAttribute('data-filtered', 'true');
    expect(liveRegion()).toHaveTextContent('필터 적용 · 57건');
  });

  it('filterFieldsOf: filter 있는 열만(열 순서), 접근자 기본값은 sortValue', () => {
    const fields = filterFieldsOf(COLUMNS);
    expect(fields.map((field) => [field.id, field.label])).toEqual([
      ['name', '이름'],
      ['price', '판매가'],
      ['role', '역할'],
    ]);
    expect(fields[1]?.value(ROWS[0] as Row)).toBe(300);
  });
});
