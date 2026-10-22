import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import {
  DataTable,
  DataTableFilterBar,
  DataTableFilterEmpty,
  DataTableResetButton,
  filterFieldsOf,
  useStateFilters,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';
import { STATUS_ORDERS } from '@/lib/table/compare';

import { addFilter, check, chips, range, typeText } from './helpers';

/** 열 필터 툴바 (표 열 필터 스펙 §2.5) — 팝오버 흐름·칩·초기화·통화 규칙·빈 상태·'열 초기화' 독립 */
type Row = {
  id: string;
  name: string;
  amount: number | null;
  currency: 'KRW' | 'USD';
  role: 'ADMIN' | 'USER';
  created: string;
};

const ROWS: Row[] = [
  { id: '1', name: 'charlie', amount: 3000, currency: 'KRW', role: 'USER', created: '2026-03-01' },
  { id: '2', name: 'Alpha', amount: 50, currency: 'USD', role: 'ADMIN', created: '2026-01-15' },
  { id: '3', name: 'bravo', amount: 1000, currency: 'KRW', role: 'USER', created: '2026-01-01' },
  { id: '4', name: 'delta', amount: 2000, currency: 'KRW', role: 'ADMIN', created: '2026-02-01' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: '이름',
    type: 'text',
    sortValue: (r) => r.name,
    filter: { kind: 'text' },
    cell: (r) => r.name,
  },
  {
    id: 'amount',
    header: '금액',
    type: 'number',
    sortValue: (r) => (r.amount === null ? null : { amount: r.amount, currency: r.currency }),
    filter: { kind: 'money', currencyCol: 'currency' },
    cell: (r) => `${r.amount} ${r.currency}`,
  },
  {
    id: 'currency',
    header: '통화',
    type: 'status',
    sortValue: (r) => r.currency,
    filter: {
      kind: 'enum',
      options: [
        { value: 'KRW', label: 'KRW' },
        { value: 'USD', label: 'USD' },
      ],
    },
    cell: (r) => r.currency,
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
        { value: 'ADMIN', label: '관리자' },
        { value: 'USER', label: '사용자' },
      ],
    },
    cell: (r) => r.role,
  },
  {
    id: 'created',
    header: '등록일',
    type: 'date',
    sortValue: (r) => r.created,
    filter: { kind: 'date' },
    cell: (r) => r.created,
  },
];

function Harness() {
  const { filters, setFilters } = useStateFilters();
  const [sort, setSort] = useState<DataTableSort>(null);
  const fields = useMemo(() => filterFieldsOf(COLUMNS), []);
  const reset = () => {
    setFilters([]);
    setSort(null);
  };
  return (
    <>
      <DataTableFilterBar
        fields={fields}
        filters={filters}
        onFiltersChange={setFilters}
        onReset={reset}
        sorted={sort !== null}
        rows={ROWS}
      />
      <DataTableResetButton tableId="t" userId="u1" columns={COLUMNS} />
      <DataTable
        tableId="t"
        userId="u1"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        aria-label="표"
        sort={sort}
        onSortChange={setSort}
        filters={filters}
        filterFields={fields}
        empty={<DataTableFilterEmpty onReset={reset} />}
      />
    </>
  );
}

const setup = () => {
  const user = userEvent.setup();
  render(<Harness />, { wrapper: MotionProvider });
  return user;
};
const table = () => screen.getByRole('table', { name: '표' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const trigger = () => screen.getByRole('button', { name: '＋ 필터' });
const liveRegion = () => document.querySelector('[aria-live="polite"]');

beforeEach(() => {
  localStorage.clear();
});

describe('DataTableFilterBar', () => {
  it('키보드만으로: 열기 → 열 선택 → 첫 입력 포커스 → Enter 적용 → 칩·점·건수·알림, 포커스는 트리거로', async () => {
    const user = setup();
    trigger().focus();
    await user.keyboard('{Enter}');
    const picker = await screen.findByRole('dialog', { name: '필터할 열 선택' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    // 열 목록의 첫 버튼으로 포커스
    await waitFor(() => expect(within(picker).getByRole('button', { name: '이름' })).toHaveFocus());
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    const op = within(dialog).getByRole('combobox', { name: '조건' });
    await waitFor(() => expect(op).toHaveFocus());
    expect(op).toHaveValue('has'); // 기본 연산자 = OPS_BY_KIND 첫 항목
    await user.tab();
    await user.keyboard('A');
    // 키 입력만으로는 적용되지 않는다
    expect(chips()).toEqual([]);
    expect(names()).toHaveLength(4);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
    expect(chips()).toEqual(['이름: "A" 포함']);
    expect(names()).toEqual(['charlie', 'Alpha', 'bravo', 'delta']);
    expect(th('이름')).toHaveAttribute('data-filtered', 'true');
    expect(screen.getByText('전체 4건 중 4건')).toBeInTheDocument();
    await waitFor(() => expect(liveRegion()).toHaveTextContent('필터 적용 · 4건'));
  });

  it('같음(eq) 연산자와 enum 다중 선택 — 2개 조건 AND, × 로 그 열만 해제', async () => {
    const user = setup();
    await addFilter(user, '역할', check(user, '관리자'));
    await addFilter(user, '등록일', range(user, '2026-01-10', null, 'date'));
    expect(names()).toEqual(['Alpha', 'delta']);
    expect(chips()).toEqual(['역할: 관리자', '등록일: 2026-01-10 ~']);
    expect(screen.getByText('전체 4건 중 2건')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '역할 필터 해제' }));
    expect(chips()).toEqual(['등록일: 2026-01-10 ~']);
    expect(names()).toEqual(['charlie', 'Alpha', 'delta']);
    expect(trigger()).toHaveFocus();

    await addFilter(user, '이름', typeText(user, 'DELTA', '같음'));
    expect(names()).toEqual(['delta']);
  });

  it('이미 걸린 열을 다시 고르면 현재 값으로 채워지고, 바꾸면 그 열 조건만 교체', async () => {
    const user = setup();
    await addFilter(user, '역할', check(user, '관리자'));
    await addFilter(user, '역할', check(user, '관리자', '사용자')); // 관리자 해제 + 사용자 선택
    expect(chips()).toEqual(['역할: 사용자']);
    expect(names()).toEqual(['charlie', 'bravo']);
  });

  it('enum 체크박스에서 Enter 로 적용', async () => {
    const user = setup();
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '역할',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '역할 필터' });
    const admin = within(dialog).getByRole('checkbox', { name: '관리자' });
    await waitFor(() => expect(admin).toHaveFocus());
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(chips()).toEqual(['역할: 관리자']));
  });

  it('Esc 는 팝오버만 닫고(적용 없음) 트리거로 포커스', async () => {
    const user = setup();
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '이름',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), 'x');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
    expect(chips()).toEqual([]);
  });

  it('필터 초기화: 정렬만 바뀌어도 보이고(Plan Q1 B), 열 필터 + 정렬 해제 후 사라지고 포커스는 트리거로', async () => {
    const user = setup();
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
    await user.click(within(th('이름')).getByRole('button'));
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    // 정렬만 기본값이 아니어도 노출
    expect(screen.getByRole('button', { name: '필터 초기화' })).toBeInTheDocument();
    await addFilter(user, '역할', check(user, '사용자'));
    await user.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(chips()).toEqual([]);
    expect(th('이름')).not.toHaveAttribute('aria-sort');
    expect(names()).toEqual(['charlie', 'Alpha', 'bravo', 'delta']);
    expect(screen.queryByText(/전체 \d+건 중/)).toBeNull();
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("'열 초기화' 는 필터·정렬에 영향 없음", async () => {
    const user = setup();
    await addFilter(user, '역할', check(user, '관리자'));
    await user.click(within(th('이름')).getByRole('button'));
    within(th('이름')).getByRole('button').focus();
    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    await user.click(screen.getByRole('button', { name: '열 초기화' }));
    expect(chips()).toEqual(['역할: 관리자']);
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['Alpha', 'delta']);
  });

  it('필터 결과 0건: "조건에 맞는 결과가 없습니다" + [필터 초기화]', async () => {
    const user = setup();
    await addFilter(user, '이름', typeText(user, 'zulu'));
    const empty = within(table()).getByText('조건에 맞는 결과가 없습니다');
    expect(empty).toBeInTheDocument();
    expect(screen.getByText('전체 4건 중 0건')).toBeInTheDocument();
    await user.click(within(table()).getByRole('button', { name: '필터 초기화' }));
    expect(chips()).toEqual([]);
    expect(names()).toHaveLength(4);
    // 눌린 버튼이 사라지므로 포커스는 툴바 '＋ 필터' 로 (body 에 남지 않음, A-1 QA 백로그)
    expect(screen.getByRole('button', { name: '＋ 필터' })).toHaveFocus();
  });

  it('통화가 섞인 금액 열: 통화 미선택이면 범위 비활성 + 안내, 통화를 하나 고르면 그 통화 안에서 범위', async () => {
    const user = setup();
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '금액',
      }),
    );
    let dialog = await screen.findByRole('dialog', { name: '금액 필터' });
    expect(within(dialog).getByText('통화를 먼저 선택하세요')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('최소')).toBeDisabled();
    expect(within(dialog).getByLabelText('최대')).toBeDisabled();
    expect(within(dialog).getByLabelText('최소')).toHaveAccessibleDescription(
      '통화를 먼저 선택하세요',
    );
    expect(within(dialog).getByRole('button', { name: '적용' })).toBeDisabled();
    await user.keyboard('{Escape}');

    await addFilter(user, '통화', check(user, 'KRW'));
    await addFilter(user, '금액', range(user, '1,500', null));
    expect(chips()).toEqual(['금액: ≥ 1,500', '통화: KRW']);
    expect(names()).toEqual(['charlie', 'delta']);

    // 통화를 둘 고르면 범위는 다시 비활성 — 칩에 안내, 결과는 통화 조건만
    await addFilter(user, '통화', check(user, 'USD'));
    expect(chips()).toEqual(['금액: ≥ 1,500 (통화 선택 시 적용)', '통화: KRW, USD']);
    expect(names()).toHaveLength(4);
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: /^금액/,
      }),
    );
    dialog = await screen.findByRole('dialog', { name: '금액 필터' });
    expect(within(dialog).getByLabelText('최소')).toBeDisabled();
  });

  it('형식 오류·역범위는 적용하지 않고 알린다', async () => {
    const user = setup();
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '등록일',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '등록일 필터' });
    await range(user, '2026-03-01', '2026-01-01', 'date')(dialog);
    await user.click(within(dialog).getByRole('button', { name: '적용' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦습니다');
    expect(chips()).toEqual([]);
  });

  it('숫자 아닌 값은 "숫자만 입력하세요"', async () => {
    const user = setup();
    await addFilter(user, '통화', check(user, 'KRW'));
    await user.click(trigger());
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '금액',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '금액 필터' });
    await user.type(within(dialog).getByLabelText('최소'), 'abc{Enter}');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('숫자만 입력하세요');
    expect(chips()).toEqual(['통화: KRW']);
  });
});
