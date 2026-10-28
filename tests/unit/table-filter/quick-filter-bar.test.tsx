import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  filterFieldsOf,
  SERVER_ENUM_DEBOUNCE_MS,
  useStateFilters,
  type DataTableColumn,
  type DataTableQuickFilterBarProps,
} from '@/components/ui/data-table';
import { FILTER_ANNOUNCE_DELAY_MS } from '@/components/ui/data-table/DataTable';
import { STATUS_ORDERS } from '@/lib/table/compare';
import type { FilterCondition } from '@/lib/table/filter';

/**
 * 빠른 필터 바 (표 열 필터 빠른 필터 바 §2) — 필드 버튼 = 칩, "＋ N개 더", enum 즉시 적용(서버 400ms 디바운스),
 * text 포함/같음 + Enter/적용, 날짜 프리셋, 포커스 규칙, Esc·바깥 클릭, 마우스 이탈 무시,
 * aria-busy·진행 표시, 라이브 안내 1회, 대기 중 조건 기준(R1), 320px 줄바꿈.
 */
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

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: '관리자' },
  { value: 'USER', label: '사용자' },
  { value: 'GUEST', label: '손님' },
];

/** 고정: 이름·금액·역할·등록일 / ＋ 더: 통화 */
const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: '이름',
    type: 'text',
    sortValue: (r) => r.name,
    filter: { kind: 'text', quick: true },
    cell: (r) => r.name,
  },
  {
    id: 'amount',
    header: '금액',
    type: 'number',
    sortValue: (r) => (r.amount === null ? null : { amount: r.amount, currency: r.currency }),
    filter: { kind: 'money', currencyCol: 'currency', quick: true },
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
    filter: { kind: 'enum', options: ROLE_OPTIONS, quick: true },
    cell: (r) => r.role,
  },
  {
    id: 'created',
    header: '등록일',
    type: 'date',
    sortValue: (r) => r.created,
    filter: { kind: 'date', quick: true },
    cell: (r) => r.created,
  },
];

const FIELDS = filterFieldsOf(COLUMNS);

/** 클라이언트 표 — 조건은 컴포넌트 상태(바로 반영) */
function ClientHarness({ leading }: { leading?: ReactNode }) {
  const { filters, setFilters } = useStateFilters();
  const fields = useMemo(() => filterFieldsOf(COLUMNS), []);
  const reset = () => setFilters([]);
  return (
    <>
      <DataTableQuickFilterBar
        fields={fields}
        filters={filters}
        onFiltersChange={setFilters}
        onReset={reset}
        rows={ROWS}
        leading={leading}
      />
      <DataTable
        tableId="t"
        userId="u1"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        aria-label="표"
        filters={filters}
        filterFields={fields}
        empty={<DataTableFilterEmpty onReset={reset} />}
      />
    </>
  );
}

/** URL 반영이 늦는 표 — 요청을 기록하고 LAND_MS 뒤에 조건(=URL)이 바뀐다. 서버 표(RSC)·router.replace 지연 흉내 */
const LAND_MS = 1000;
let requests: FilterCondition[][] = [];

function LaggingHarness(props: Partial<DataTableQuickFilterBarProps<Row>>) {
  const [filters, setFilters] = useState<readonly FilterCondition[]>([]);
  const [inFlight, setInFlight] = useState(0);
  return (
    <DataTableQuickFilterBar
      fields={FIELDS}
      filters={filters}
      onFiltersChange={(next) => {
        requests.push([...next]);
        setInFlight((n) => n + 1);
        setTimeout(() => {
          setFilters(next);
          setInFlight((n) => n - 1);
        }, LAND_MS);
      }}
      onReset={() => setFilters([])}
      pending={inFlight > 0}
      total={57}
      {...props}
    />
  );
}

const setupClient = (leading?: ReactNode) => {
  const user = userEvent.setup();
  render(<ClientHarness leading={leading} />, { wrapper: MotionProvider });
  return user;
};

const table = () => screen.getByRole('table', { name: '표' });
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const fieldButton = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label} 필터(,|$)`) });
const liveRegion = () => document.querySelector('[aria-live="polite"]') as HTMLElement;
const group = () => screen.getByRole('group', { name: '필터' });
const closed = (name: string) =>
  waitFor(() => expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument());

beforeEach(() => {
  localStorage.clear();
  requests = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DataTableQuickFilterBar — 형태 (§2.1)', () => {
  it('고정 필드 버튼이 항상 보이고 나머지는 "＋ N개 더", 별도 적용된 필터 칩 줄은 없다. 건수는 오른쪽', () => {
    setupClient();
    for (const label of ['이름', '금액', '역할', '등록일'])
      expect(fieldButton(label)).toHaveAccessibleName(`${label} 필터`);
    expect(screen.queryByRole('button', { name: /^통화 필터/ })).toBeNull();
    expect(screen.getByRole('button', { name: '＋ 1개 더' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '적용된 필터' })).toBeNull();
    expect(fieldButton('역할')).toHaveTextContent('역할▾');
    expect(fieldButton('역할')).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByText('4건')).toBeInTheDocument();
    // 필터 초기화는 조건·정렬이 없으면 숨김
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
  });

  it('320px: 바는 줄바꿈(가로 스크롤 없음)하고 건수는 좁은 화면에서 다음 줄', () => {
    setupClient();
    const bar = document.querySelector('[data-quick-filter-bar]') as HTMLElement;
    expect(bar).toHaveClass('flex-wrap');
    expect(bar).not.toHaveClass('overflow-x-auto');
    const count = document.querySelector('[data-quick-filter-count]') as HTMLElement;
    expect(count.parentElement).toHaveClass('max-sm:w-full', 'ml-auto');
    // 칩은 밀집 크기 sm 고정 — 36px·14px (Penta PR-2, Q-D1 = B)
    expect(fieldButton('이름')).toHaveClass('h-(--height-control-sm)', 'text-[14px]');
  });

  it('leading slot: 페이지 필터를 같은 카드 안, 바 위에 놓는다', () => {
    setupClient(<input aria-label="검색" />);
    const search = within(group()).getByRole('textbox', { name: '검색' });
    const bar = group().querySelector('[data-quick-filter-bar]') as HTMLElement;
    expect(bar).toBeInTheDocument();
    expect(search.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('DataTableQuickFilterBar — 적용 규칙 (§2.3)', () => {
  it('enum: 버튼 → 체크 = 2클릭으로 바로 적용, 팝오버는 열린 채. 값 추가도 2클릭, "선택 해제"', async () => {
    const user = setupClient();
    await user.click(fieldButton('역할'));
    const dialog = await screen.findByRole('dialog', { name: '역할 필터' });
    expect(within(dialog).queryByRole('button', { name: '적용' })).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: '관리자' }));
    expect(names()).toEqual(['Alpha', 'delta']);
    expect(screen.getByRole('dialog', { name: '역할 필터' })).toBeInTheDocument();
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터, 관리자 적용 중');
    expect(fieldButton('역할')).toHaveTextContent('역할: 관리자');
    expect(fieldButton('역할')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '역할 필터 해제' })).toBeInTheDocument();
    expect(screen.getByText('전체 4건 중 2건')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: '손님' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '사용자' }));
    // 정의 순서로, 넘치면 +N
    expect(fieldButton('역할')).toHaveTextContent('역할: 관리자,사용자 +1');
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터, 관리자, 사용자, 손님 적용 중');
    expect(names()).toHaveLength(4);

    await user.click(within(dialog).getByRole('button', { name: '선택 해제' }));
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터');
    expect(screen.getByRole('dialog', { name: '역할 필터' })).toBeInTheDocument();
    expect(screen.getByText('4건')).toBeInTheDocument();
  });

  it('text: 포함/같음 2버튼(기본 포함), 입력 중에는 적용 없음, Enter 로 적용 → 닫히고 그 필드 버튼으로 포커스', async () => {
    const user = setupClient();
    await user.click(fieldButton('이름'));
    const dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    const input = within(dialog).getByRole('textbox', { name: '값' });
    await waitFor(() => expect(input).toHaveFocus());
    const has = within(dialog).getByRole('button', { name: '포함' });
    const eq = within(dialog).getByRole('button', { name: '같음' });
    expect(has).toHaveAttribute('aria-pressed', 'true');
    expect(eq).toHaveAttribute('aria-pressed', 'false');

    await user.type(input, 'DELTA');
    expect(names()).toHaveLength(4);
    expect(fieldButton('이름')).toHaveAccessibleName('이름 필터');
    // 한글 조합 중 Enter 는 적용하지 않는다
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(names()).toHaveLength(4);

    await user.click(eq);
    expect(eq).toHaveAttribute('aria-pressed', 'true');
    input.focus();
    await user.keyboard('{Enter}');
    await closed('이름 필터');
    expect(names()).toEqual(['delta']);
    expect(fieldButton('이름')).toHaveAccessibleName('이름 필터, "DELTA" 같음 적용 중');
    expect(fieldButton('이름')).toHaveFocus();
  });

  it('text: "적용" 버튼으로도 적용, 빈 값 적용은 그 열 해제', async () => {
    const user = setupClient();
    await user.click(fieldButton('이름'));
    let dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), 'al');
    await user.click(within(dialog).getByRole('button', { name: '적용' }));
    await closed('이름 필터');
    expect(names()).toEqual(['Alpha']);

    await user.click(fieldButton('이름'));
    dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    await user.clear(within(dialog).getByRole('textbox', { name: '값' }));
    await user.click(within(dialog).getByRole('button', { name: '적용' }));
    await closed('이름 필터');
    expect(names()).toHaveLength(4);
  });

  it('date: 프리셋(오늘·최근 7일·최근 30일·이번 달)은 누르면 바로 적용, 입력은 Enter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-03T03:00:00Z'));
    const user = setupClient();
    await user.click(fieldButton('등록일'));
    let dialog = await screen.findByRole('dialog', { name: '등록일 필터' });
    const presets = within(dialog).getByRole('group', { name: '빠른 기간' });
    expect(
      within(presets)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['오늘', '최근 7일', '최근 30일', '이번 달']);
    await user.click(within(presets).getByRole('button', { name: '최근 7일' }));
    await closed('등록일 필터');
    expect(names()).toEqual(['charlie']);
    expect(fieldButton('등록일')).toHaveTextContent('등록일: 2026-02-25 ~ 2026-03-03');
    expect(fieldButton('등록일')).toHaveFocus();

    // 다시 열면 현재 프리셋이 눌린 상태, 입력 + Enter
    await user.click(fieldButton('등록일'));
    dialog = await screen.findByRole('dialog', { name: '등록일 필터' });
    expect(within(dialog).getByRole('button', { name: '최근 7일' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const from = within(dialog).getByLabelText('시작일');
    await user.clear(from);
    await user.type(from, '2026-01-10');
    expect(names()).toEqual(['charlie']);
    await user.keyboard('{Enter}');
    await closed('등록일 필터');
    expect(names()).toEqual(['charlie', 'Alpha', 'delta']);
  });
  // money(슬라이더·통화 라디오)는 money-range-editor.test.tsx (§7.5)
});

describe('DataTableQuickFilterBar — ＋ N개 더·포커스·팝오버 (§2.1·§2.6)', () => {
  it('"＋ N개 더" → 필드 목록 → 같은 편집기. 조건이 걸리면 바에 버튼이 생기고 Esc 는 그 버튼으로 포커스', async () => {
    const user = setupClient();
    await user.click(screen.getByRole('button', { name: '＋ 1개 더' }));
    const list = await screen.findByRole('dialog', { name: '필터 더 보기' });
    await user.click(within(list).getByRole('button', { name: '통화' }));
    const dialog = await screen.findByRole('dialog', { name: '통화 필터' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'USD' }));
    expect(names()).toEqual(['Alpha']);
    expect(fieldButton('통화')).toHaveAccessibleName('통화 필터, USD 적용 중');
    expect(screen.queryByRole('button', { name: /개 더$/ })).toBeNull();
    await user.keyboard('{Escape}');
    await closed('통화 필터');
    expect(fieldButton('통화')).toHaveFocus();
  });

  it('× 뒤 포커스: 고정 필드는 같은 필드 버튼, 고정 아닌 필드는 버튼이 사라지므로 "＋ N개 더"', async () => {
    const user = setupClient();
    await user.click(fieldButton('역할'));
    await user.click(
      within(await screen.findByRole('dialog', { name: '역할 필터' })).getByRole('checkbox', {
        name: '사용자',
      }),
    );
    await user.keyboard('{Escape}');
    await closed('역할 필터');
    await user.click(screen.getByRole('button', { name: '역할 필터 해제' }));
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터');
    expect(fieldButton('역할')).toHaveFocus();
    expect(screen.queryByRole('button', { name: '역할 필터 해제' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '＋ 1개 더' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: '필터 더 보기' })).getByRole('button', {
        name: '통화',
      }),
    );
    await user.click(
      within(await screen.findByRole('dialog', { name: '통화 필터' })).getByRole('checkbox', {
        name: 'KRW',
      }),
    );
    await user.keyboard('{Escape}');
    await closed('통화 필터');
    await user.click(screen.getByRole('button', { name: '통화 필터 해제' }));
    expect(screen.queryByRole('button', { name: /^통화 필터/ })).toBeNull();
    expect(screen.getByRole('button', { name: '＋ 1개 더' })).toHaveFocus();
  });

  it('필터 초기화는 바 끝 — 누르면 사라지고 포커스는 첫 필드 버튼. 0건 빈 상태의 초기화도 첫 필드 버튼으로', async () => {
    const user = setupClient();
    await user.click(fieldButton('이름'));
    let dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), 'zulu{Enter}');
    await closed('이름 필터');
    const resets = screen.getAllByRole('button', { name: '필터 초기화' });
    expect(resets).toHaveLength(2); // 바 + 0건 빈 상태
    await user.click(resets[0] as HTMLElement);
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
    expect(fieldButton('이름')).toHaveFocus();

    await user.click(fieldButton('이름'));
    dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), 'zulu{Enter}');
    await closed('이름 필터');
    await user.click(within(table()).getByRole('button', { name: '필터 초기화' }));
    expect(fieldButton('이름')).toHaveFocus();
  });

  it('마우스 이탈로 닫히지 않고, 바깥 클릭은 닫으며 포커스를 그 필드 버튼으로', async () => {
    const user = setupClient();
    await user.click(fieldButton('역할'));
    const dialog = await screen.findByRole('dialog', { name: '역할 필터' });
    await user.hover(dialog);
    await user.unhover(dialog);
    fireEvent.pointerLeave(dialog);
    fireEvent.mouseLeave(dialog);
    expect(screen.getByRole('dialog', { name: '역할 필터' })).toBeInTheDocument();

    await user.click(document.body);
    await closed('역할 필터');
    expect(fieldButton('역할')).toHaveFocus();
  });

  it('같은 필드 버튼을 다시 누르면 닫히고, 다른 필드 버튼을 누르면 그 필드 편집기로 바로 바뀐다', async () => {
    const user = setupClient();
    await user.click(fieldButton('역할'));
    await screen.findByRole('dialog', { name: '역할 필터' });
    await user.click(fieldButton('이름'));
    await screen.findByRole('dialog', { name: '이름 필터' });
    await closed('역할 필터');
    await user.click(fieldButton('이름'));
    await closed('이름 필터');
    expect(fieldButton('이름')).toHaveAttribute('aria-expanded', 'false');
  });
});

/**
 * 가짜 타이머 구간은 fireEvent 로 조작한다 — user-event·findBy 는 내부 setTimeout 을 기다려 가짜 타이머에서 멈춘다
 */
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
const typeEnter = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('DataTableQuickFilterBar — 서버 표·경쟁 조건 (§2.4·§2.5)', () => {
  const setupLagging = (props: Partial<DataTableQuickFilterBarProps<Row>> = {}) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<LaggingHarness {...props} />, { wrapper: MotionProvider });
  };
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('서버 표: 400ms 안에 3개 체크 → 요청 1회(세 값 모두), 팝오버 열린 채. 대기 중 aria-busy·진행 표시', async () => {
    setupLagging({ mode: 'server' });
    fireEvent.click(fieldButton('역할'));
    const dialog = screen.getByRole('dialog', { name: '역할 필터' });
    for (const name of ['관리자', '사용자', '손님']) {
      fireEvent.click(within(dialog).getByRole('checkbox', { name }));
      advance(100);
    }
    expect(requests).toEqual([]);
    // 대기 중 표시도 체크한 값(낙관적)
    expect(within(dialog).getByRole('checkbox', { name: '손님' })).toBeChecked();
    expect(fieldButton('역할')).toHaveTextContent('역할: 관리자,사용자 +1');

    advance(SERVER_ENUM_DEBOUNCE_MS);
    expect(requests).toEqual([[{ col: 'role', op: 'in', values: ['ADMIN', 'USER', 'GUEST'] }]]);
    expect(screen.getByRole('dialog', { name: '역할 필터' })).toBeInTheDocument();
    expect(group()).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('[data-quick-filter-progress]')).toBeInTheDocument();

    advance(LAND_MS);
    expect(group()).not.toHaveAttribute('aria-busy');
    expect(document.querySelector('[data-quick-filter-progress]')).toBeNull();
    expect(screen.getByText('총 57건 · 조건 1개')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it('R1: URL 이 따라잡기 전의 다음 변경은 대기 중 조건에서 계산된다(앞 변경을 지우지 않음)', async () => {
    setupLagging({ mode: 'client' });
    fireEvent.click(fieldButton('역할'));
    const dialog = screen.getByRole('dialog', { name: '역할 필터' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '관리자' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '사용자' }));
    escape();
    // 다른 필드도 URL 반영 전에
    fireEvent.click(fieldButton('이름'));
    const name = screen.getByRole('dialog', { name: '이름 필터' });
    typeEnter(within(name).getByRole('textbox', { name: '값' }), 'a');
    expect(requests).toEqual([
      [{ col: 'role', op: 'in', values: ['ADMIN'] }],
      [{ col: 'role', op: 'in', values: ['ADMIN', 'USER'] }],
      [
        { col: 'name', op: 'has', value: 'a' },
        { col: 'role', op: 'in', values: ['ADMIN', 'USER'] },
      ],
    ]);
    advance(LAND_MS);
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터, 관리자, 사용자 적용 중');
    expect(fieldButton('이름')).toHaveAccessibleName('이름 필터, "a" 포함 적용 중');

    // ×도 대기 중 조건 기준
    fireEvent.click(screen.getByRole('button', { name: '이름 필터 해제' }));
    fireEvent.click(screen.getByRole('button', { name: '역할 필터 해제' }));
    expect(requests.at(-1)).toEqual([]);
  });

  it('서버 표: 디바운스 중 text 적용은 체크한 값까지 한 번에 보낸다(요청 1회)', async () => {
    setupLagging({ mode: 'server' });
    fireEvent.click(fieldButton('역할'));
    const dialog = screen.getByRole('dialog', { name: '역할 필터' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '관리자' }));
    fireEvent.click(fieldButton('이름'));
    const name = screen.getByRole('dialog', { name: '이름 필터' });
    typeEnter(within(name).getByRole('textbox', { name: '값' }), 'a');
    advance(SERVER_ENUM_DEBOUNCE_MS * 2);
    expect(requests).toEqual([
      [
        { col: 'name', op: 'has', value: 'a' },
        { col: 'role', op: 'in', values: ['ADMIN'] },
      ],
    ]);
  });

  it('외부 변경(초기화 등)이 오면 디바운스 중인 조건은 버린다 — 외부 상태가 이긴다', async () => {
    setupLagging({ mode: 'server', canReset: true });
    fireEvent.click(fieldButton('역할'));
    const dialog = screen.getByRole('dialog', { name: '역할 필터' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '관리자' }));
    escape();
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
    advance(SERVER_ENUM_DEBOUNCE_MS * 2);
    expect(requests).toEqual([]);
    expect(fieldButton('역할')).toHaveAccessibleName('역할 필터');
  });

  it('서버 표 건수: 조건 없으면 "총 N건"', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<LaggingHarness />, { wrapper: MotionProvider });
    expect(screen.getByText('총 57건')).toBeInTheDocument();
    expect(group()).not.toHaveAttribute('aria-busy');
  });
});

describe('DataTableQuickFilterBar — 라이브 안내 1회 (§2.4)', () => {
  it('연달아 체크해도 마지막 변경 후 ~300ms 에 결과 안내 1회', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<ClientHarness />, { wrapper: MotionProvider });
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(liveRegion().textContent ?? ''));
    observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true });

    fireEvent.click(fieldButton('역할'));
    const dialog = screen.getByRole('dialog', { name: '역할 필터' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '관리자' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '사용자' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '손님' }));
    act(() => vi.advanceTimersByTime(FILTER_ANNOUNCE_DELAY_MS));
    await act(async () => {});
    observer.disconnect();
    expect(texts.filter(Boolean)).toEqual(['필터 적용 · 4건']);
  });
});
