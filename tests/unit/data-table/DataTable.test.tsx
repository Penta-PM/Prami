import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DataTable,
  DataTableResetButton,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';
import { STATUS_ORDERS } from '@/lib/table/compare';
import { clearLayout } from '@/lib/table/layout-storage';

/** 공용 표 (#32 스펙 §4·§5) — 정렬·리사이즈·재배치·키보드·저장 */
type Row = {
  id: string;
  name: string;
  price: number | null;
  role: 'ADMIN' | 'USER';
  created: string | null;
};

const ROWS: Row[] = [
  { id: '1', name: 'charlie', price: 300, role: 'USER', created: '2026-03-01' },
  { id: '2', name: 'Alpha', price: null, role: 'ADMIN', created: null },
  { id: '3', name: 'bravo', price: 100, role: 'USER', created: '2026-01-01' },
  { id: '4', name: 'delta', price: 200, role: 'ADMIN', created: '2026-02-01' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', header: '이름', type: 'text', sortValue: (r) => r.name, cell: (r) => r.name },
  {
    id: 'price',
    header: '판매가',
    type: 'number',
    align: 'right',
    sortValue: (r) => r.price,
    cell: (r) => (r.price === null ? '—' : String(r.price)),
  },
  {
    id: 'role',
    header: '역할',
    type: 'status',
    statusOrder: STATUS_ORDERS.role,
    sortValue: (r) => r.role,
    cell: (r) => r.role,
  },
  {
    id: 'created',
    header: '등록일',
    type: 'date',
    sortValue: (r) => r.created,
    cell: (r) => r.created ?? '—',
  },
  {
    id: 'actions',
    header: '관리',
    type: 'none',
    pinned: 'end',
    cell: (r) => (
      <button type="button" aria-label={`${r.name} 수정`}>
        수정
      </button>
    ),
  },
];

const KEY = 'prami:table:t:v1:u1';
const DEFAULT_HEADERS = ['이름', '판매가', '역할', '등록일', '관리'];
/** 열 id → 셀 텍스트 (본문 정렬 검증용) */
const CELL_TEXT: Record<string, (r: Row) => string> = {
  name: (r) => r.name,
  price: (r) => (r.price === null ? '—' : String(r.price)),
  role: (r) => r.role,
  created: (r) => r.created ?? '—',
  actions: () => '수정',
};
const HEADER_TO_ID: Record<string, string> = {
  이름: 'name',
  판매가: 'price',
  역할: 'role',
  등록일: 'created',
  관리: 'actions',
};

type Props = Partial<Parameters<typeof DataTable<Row>>[0]>;

function renderTable(props: Props = {}) {
  return render(
    <DataTable
      tableId="t"
      userId="u1"
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      aria-label="테스트 표"
      {...props}
    />,
  );
}

const table = () => screen.getByRole('table', { name: '테스트 표' });
const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((th) => th.textContent);
const th = (name: string) => screen.getByRole('columnheader', { name });
const sortButton = (name: string) => within(th(name)).getByRole('button', { name });
const handle = (name: string) => screen.getByRole('separator', { name: `${name} 열 너비 조절` });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const columnTexts = (header: string) => {
  const index = headers().indexOf(header);
  return bodyRows().map((row) => within(row).getAllByRole('cell')[index]?.textContent);
};
const liveRegion = () => document.querySelector('[aria-live="polite"]');
const ghost = () => screen.queryByTestId('data-table-drag-ghost');
const colWidth = (id: string) =>
  (table().querySelector(`col[data-column-id="${id}"]`) as HTMLElement | null)?.style.width;

/** jsdom 은 레이아웃이 없다 — th 는 순서대로 100px 폭, offsetWidth 는 열마다 지정 */
let offsetWidths: Record<string, number> = {};
beforeEach(() => {
  localStorage.clear();
  offsetWidths = {};
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return offsetWidths[this.dataset.columnId ?? ''] ?? 100;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'TH' && this.parentElement) {
      const index = Array.from(this.parentElement.children).indexOf(this);
      return new DOMRect(index * 100, 0, 100, 40);
    }
    return new DOMRect(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 헤더 순서대로 모든 행의 셀이 따라오는지 (스펙 §7 — 재배치 후 셀이 바뀐 헤더 아래) */
function expectCellsFollowHeaders() {
  const ids = headers().map((text) => HEADER_TO_ID[text ?? ''] as string);
  for (const row of bodyRows()) {
    const cells = within(row).getAllByRole('cell');
    const name = cells[ids.indexOf('name')]?.textContent;
    const source = ROWS.find((r) => r.name === name) as Row;
    expect(cells.map((cell) => cell.textContent)).toEqual(ids.map((id) => CELL_TEXT[id]?.(source)));
  }
}

describe('DataTable 정렬', () => {
  it('클릭마다 aria-sort 가 ascending → descending → 없음으로 바뀌고 기본 순서로 돌아온다', async () => {
    renderTable();
    expect(headers()).toEqual(DEFAULT_HEADERS);
    expect(th('이름')).not.toHaveAttribute('aria-sort');

    await userEvent.click(sortButton('이름'));
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    expect(columnTexts('이름')).toEqual(['Alpha', 'bravo', 'charlie', 'delta']);
    expect(liveRegion()).toHaveTextContent('이름 오름차순 정렬');

    await userEvent.click(sortButton('이름'));
    expect(th('이름')).toHaveAttribute('aria-sort', 'descending');
    expect(columnTexts('이름')).toEqual(['delta', 'charlie', 'bravo', 'Alpha']);

    await userEvent.click(sortButton('이름'));
    expect(th('이름')).not.toHaveAttribute('aria-sort');
    expect(columnTexts('이름')).toEqual(['charlie', 'Alpha', 'bravo', 'delta']);
    expect(liveRegion()).toHaveTextContent('이름 정렬 해제');
  });

  it('다른 열을 누르면 그 열 오름차순부터 시작하고 이전 열의 aria-sort 는 사라진다', async () => {
    renderTable();
    await userEvent.click(sortButton('이름'));
    await userEvent.click(sortButton('역할'));
    expect(th('이름')).not.toHaveAttribute('aria-sort');
    expect(th('역할')).toHaveAttribute('aria-sort', 'ascending');
    expect(columnTexts('역할')).toEqual(['ADMIN', 'ADMIN', 'USER', 'USER']);
  });

  it('빈 값은 방향과 관계없이 맨 뒤에 둔다', async () => {
    renderTable();
    await userEvent.click(sortButton('판매가'));
    expect(columnTexts('판매가')).toEqual(['100', '200', '300', '—']);
    await userEvent.click(sortButton('판매가'));
    expect(columnTexts('판매가')).toEqual(['300', '200', '100', '—']);
    await userEvent.click(sortButton('등록일'));
    expect(columnTexts('등록일')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '—']);
  });

  it('비데이터 열에는 정렬 버튼·아이콘·aria-sort 가 없다', () => {
    renderTable();
    const actions = th('관리');
    expect(within(actions).queryByRole('button')).toBeNull();
    expect(actions.querySelector('svg')).toBeNull();
    expect(actions).not.toHaveAttribute('aria-sort');
    // 정렬 아이콘은 aria-hidden 이고 텍스트가 없다
    const icon = th('이름').querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.textContent).toBe('');
  });

  it('server 모드는 행을 정렬하지 않고 onSortChange 로 다음 상태만 알린다', async () => {
    const onSortChange = vi.fn<(next: DataTableSort) => void>();
    const { rerender } = renderTable({ sortMode: 'server', sort: null, onSortChange });
    await userEvent.click(sortButton('판매가'));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'price', dir: 'asc' });
    expect(th('판매가')).not.toHaveAttribute('aria-sort');
    expect(columnTexts('이름')).toEqual(['charlie', 'Alpha', 'bravo', 'delta']);

    rerender(
      <DataTable
        tableId="t"
        userId="u1"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        aria-label="테스트 표"
        sortMode="server"
        sort={{ id: 'price', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(th('판매가')).toHaveAttribute('aria-sort', 'ascending');
    expect(columnTexts('이름')).toEqual(['charlie', 'Alpha', 'bravo', 'delta']);
    await userEvent.click(sortButton('판매가'));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'price', dir: 'desc' });
  });

  it('빠른 연속 클릭(BL-2, page-state-memory §6): sort prop(URL)이 따라잡기 전에도 직전 클릭 결과에서 다음 단계 — 오름 → 내림 → 해제', () => {
    const onSortChange = vi.fn<(next: DataTableSort) => void>();
    const props = {
      tableId: 't',
      userId: 'u1',
      columns: COLUMNS,
      rows: ROWS,
      getRowKey: (r: Row) => r.id,
      'aria-label': '테스트 표',
      sortMode: 'server' as const,
      onSortChange,
    };
    const { rerender } = render(<DataTable {...props} sort={null} />);
    // URL 갱신 없이 두 번 — 두 번째 요청은 낡은 URL(정렬 없음)이 아니라 첫 요청(오름) 기준
    fireEvent.click(sortButton('판매가'));
    fireEvent.click(sortButton('판매가'));
    expect(onSortChange.mock.calls).toEqual([
      [{ id: 'price', dir: 'asc' }],
      [{ id: 'price', dir: 'desc' }],
    ]);
    // URL 이 중간 요청(오름)까지만 따라잡았을 때 누르면 마지막 요청(내림) 기준 → 해제
    rerender(<DataTable {...props} sort={{ id: 'price', dir: 'asc' }} />);
    fireEvent.click(sortButton('판매가'));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
    // 마지막 요청까지 따라잡으면 대기 상태를 비우고 URL 기준으로 돌아간다
    rerender(<DataTable {...props} sort={{ id: 'price', dir: 'desc' }} />);
    rerender(<DataTable {...props} sort={null} />);
    fireEvent.click(sortButton('판매가'));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'price', dir: 'asc' });
  });

  it('빠른 연속 클릭 대기 중 URL 이 요청 밖의 값으로 바뀌면(필터 초기화 등 외부 변경) 그 값이 기준 (BL-2)', () => {
    const onSortChange = vi.fn<(next: DataTableSort) => void>();
    const props = {
      tableId: 't',
      userId: 'u1',
      columns: COLUMNS,
      rows: ROWS,
      getRowKey: (r: Row) => r.id,
      'aria-label': '테스트 표',
      sortMode: 'server' as const,
      onSortChange,
    };
    const { rerender } = render(<DataTable {...props} sort={null} />);
    fireEvent.click(sortButton('판매가'));
    rerender(<DataTable {...props} sort={{ id: 'name', dir: 'desc' }} />);
    fireEvent.click(sortButton('이름'));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });

  it('헤더 클릭은 행 클릭 핸들러를 부르지 않는다', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    await userEvent.click(sortButton('이름'));
    await userEvent.click(handle('이름'));
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('bravo'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2]);
  });
});

describe('DataTable 행 클릭', () => {
  it('비데이터 칸(관리) 클릭은 버튼 사이 여백이어도 행 클릭으로 번지지 않고, 데이터 칸 클릭은 행 클릭이다', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const [first] = bodyRows();
    const cells = within(first as HTMLElement).getAllByRole('cell');
    await userEvent.click(cells[cells.length - 1] as HTMLElement);
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(cells[0] as HTMLElement);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable 접근성 이름', () => {
  it('기본(auto) 레이아웃에서도 모든 리사이즈 핸들이 aria-valuenow·min·max 를 가진다 — 포커스 가능한 separator 필수 속성 (QA #44)', () => {
    offsetWidths = { name: 140, price: 90 };
    renderTable();
    expect(table().querySelector('colgroup')).toBeNull(); // 아직 auto 레이아웃
    const handles = screen.getAllByRole('separator');
    expect(handles.length).toBe(COLUMNS.length);
    for (const separator of handles) {
      expect(separator).toHaveAttribute('aria-valuenow');
      expect(separator).toHaveAttribute('aria-valuemin', '60');
      expect(separator).toHaveAttribute('aria-valuemax', '600');
    }
    expect(handle('이름')).toHaveAttribute('aria-valuenow', '140');
    expect(handle('판매가')).toHaveAttribute('aria-valuenow', '90');
  });

  it('columnheader 이름에 리사이즈 핸들 aria-label 이 섞이지 않는다', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: '이름' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '관리' })).toBeInTheDocument();
    expect(handle('이름')).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle('이름')).toHaveAttribute('tabindex', '0');
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });
});

describe('DataTable 열 이동 (키보드)', () => {
  it('Alt+Shift+→ 로 열을 옮기고 모든 행의 셀이 헤더를 따라가며 라이브 영역이 알린다', async () => {
    renderTable();
    sortButton('이름').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(['판매가', '이름', '역할', '등록일', '관리']);
    expect(liveRegion()).toHaveTextContent('이름 열을 2번째로 이동');
    expect(sortButton('이름')).toHaveFocus();
    expectCellsFollowHeaders();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      order: ['price', 'name', 'role', 'created', 'actions'],
    });

    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(headers()).toEqual(DEFAULT_HEADERS);
    // 기본 순서로 돌아오면 저장값을 지운다
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('맨 끝 열은 고정 열 너머로, 맨 앞 열은 더 앞으로 이동하지 않는다', async () => {
    renderTable();
    sortButton('등록일').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(DEFAULT_HEADERS);
    sortButton('이름').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('Enter·Space 는 정렬한다', async () => {
    renderTable();
    sortButton('이름').focus();
    await userEvent.keyboard('{Enter}');
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.keyboard(' ');
    expect(th('이름')).toHaveAttribute('aria-sort', 'descending');
  });
});

describe('DataTable 열 너비', () => {
  it('처음 리사이즈하면 colgroup + table-layout fixed 로 바뀌고 ←/→ 는 ±16px', async () => {
    offsetWidths = { name: 120, price: 90 };
    renderTable();
    expect(table().querySelector('colgroup')).toBeNull();
    expect(table().style.tableLayout).toBe('');

    handle('이름').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(table().style.tableLayout).toBe('fixed');
    expect(colWidth('name')).toBe('136px');
    // 다른 열은 측정한 기준 폭 그대로 (기본 모습 유지)
    expect(colWidth('price')).toBe('90px');
    expect(table().style.width).toBe(`${136 + 90 + 100 * 3}px`);
    expect(liveRegion()).toHaveTextContent('이름 열 너비 136px');
    expect(handle('이름')).toHaveAttribute('aria-valuenow', '136');

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(colWidth('name')).toBe('104px');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      widths: { name: 104 },
    });
  });

  it('최소 60px·최대 600px 에서 멈춘다', async () => {
    offsetWidths = { name: 70, price: 590 };
    renderTable();
    handle('이름').focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(colWidth('name')).toBe('60px');
    handle('판매가').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(colWidth('price')).toBe('600px');
  });

  it('포인터로 끌어도 최소 60px·최대 600px 에서 멈춘다 (QA #44 백로그 3)', () => {
    offsetWidths = { name: 100 };
    renderTable();
    fireEvent.pointerDown(handle('이름'), { pointerType: 'mouse', button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { clientX: -900 });
    expect(colWidth('name')).toBe('60px');
    fireEvent.pointerMove(document, { clientX: 2000 });
    expect(colWidth('name')).toBe('600px');
    fireEvent.pointerUp(document, { clientX: 2000 });
    expect(colWidth('name')).toBe('600px');
    expect(handle('이름')).toHaveAttribute('aria-valuenow', '600');
  });

  it('핸들 더블클릭은 그 열만 기본 폭으로 되돌리고, 남은 폭이 없으면 auto 레이아웃으로 돌아간다', async () => {
    renderTable();
    handle('이름').focus();
    await userEvent.keyboard('{ArrowRight}');
    handle('판매가').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(colWidth('price')).toBe('116px');

    await userEvent.dblClick(handle('판매가'));
    expect(colWidth('price')).toBe('100px');
    expect(colWidth('name')).toBe('116px');

    await userEvent.dblClick(handle('이름'));
    expect(table().querySelector('colgroup')).toBeNull();
    expect(table().style.tableLayout).toBe('');
    expect(th('이름')).not.toHaveAttribute('aria-sort');
  });

  it('포인터로 끌어 폭을 바꾸고 놓을 때 저장한다. 핸들 조작은 정렬·재배치를 일으키지 않는다', () => {
    renderTable();
    fireEvent.pointerDown(handle('이름'), { pointerType: 'mouse', clientX: 100 });
    fireEvent.pointerMove(document, { clientX: 180 });
    expect(colWidth('name')).toBe('180px');
    expect(ghost()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    fireEvent.pointerUp(document, { clientX: 180 });
    fireEvent.click(handle('이름'));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      widths: { name: 180 },
    });
    expect(th('이름')).not.toHaveAttribute('aria-sort');
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('터치 포인터는 리사이즈하지 않는다', () => {
    renderTable();
    fireEvent.pointerDown(handle('이름'), { pointerType: 'touch', clientX: 100 });
    fireEvent.pointerMove(document, { clientX: 300 });
    fireEvent.pointerUp(document, { clientX: 300 });
    expect(table().querySelector('colgroup')).toBeNull();
  });
});

describe('DataTable 열 이동 (포인터)', () => {
  it('5px 미만으로 움직였다 놓으면 정렬한다', () => {
    renderTable();
    const button = sortButton('이름');
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 13, clientY: 10 });
    expect(ghost()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 13, clientY: 10 });
    fireEvent.click(button);
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('임계값 경계: 4px 이동은 클릭(정렬), 정확히 5px 이동부터 드래그 (QA #44 백로그 3)', () => {
    renderTable();
    const button = sortButton('이름');
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 14, clientY: 10 });
    expect(ghost()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 14, clientY: 10 });
    fireEvent.click(button);
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 13, clientY: 14 }); // 대각선 √(9+16) = 5px
    expect(ghost()).not.toBeNull();
    fireEvent.pointerUp(document, { clientX: 13, clientY: 14 });
    fireEvent.click(button);
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending'); // 드래그 직후 click 은 정렬하지 않음
  });

  it('5px 이상 끌면 고스트·삽입선을 보이고, 놓으면 이동하며 직후 click 은 정렬하지 않는다', () => {
    renderTable();
    const button = sortButton('이름');
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 260, clientY: 12 });
    expect(ghost()).toHaveTextContent('이름');
    // 판매가(0~200)·역할(200~300) 중간점 250 을 넘었으니 등록일 앞(300px)에 삽입선
    expect(screen.getByTestId('data-table-drop-indicator')).toHaveStyle({ left: '300px' });
    // 행에는 transform 을 걸지 않는다 (Motion 스펙 금지 2)
    for (const row of bodyRows()) expect(row.style.transform).toBe('');

    fireEvent.pointerUp(document, { clientX: 260, clientY: 12 });
    fireEvent.click(sortButton('이름'));
    expect(ghost()).toBeNull();
    expect(headers()).toEqual(['판매가', '역할', '이름', '등록일', '관리']);
    expect(th('이름')).not.toHaveAttribute('aria-sort');
    expect(liveRegion()).toHaveTextContent('이름 열을 3번째로 이동');
    expectCellsFollowHeaders();
  });

  it('고정 열 너머로는 놓을 수 없다', () => {
    renderTable();
    fireEvent.pointerDown(sortButton('이름'), { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 1000, clientY: 10 });
    // 관리(400~500) 앞 경계에서 멈춘다
    expect(screen.getByTestId('data-table-drop-indicator')).toHaveStyle({ left: '400px' });
    fireEvent.pointerUp(document, { clientX: 1000, clientY: 10 });
    expect(headers()).toEqual(['판매가', '역할', '등록일', '이름', '관리']);
  });

  it('고정 열은 끌어도 움직이지 않는다', () => {
    renderTable();
    fireEvent.pointerDown(screen.getByText('관리'), { pointerType: 'mouse', clientX: 450 });
    fireEvent.pointerMove(document, { clientX: 10 });
    expect(ghost()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 10 });
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('드래그 중 Esc 는 드래그만 취소하고 바깥(모달 등)으로 전파되지 않는다', () => {
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <DataTable
          tableId="t"
          userId="u1"
          columns={COLUMNS}
          rows={ROWS}
          getRowKey={(r) => r.id}
          aria-label="테스트 표"
        />
      </div>,
    );
    const button = sortButton('이름');
    button.focus();
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 260, clientY: 10 });
    expect(ghost()).not.toBeNull();

    const notCancelled = fireEvent.keyDown(button, { key: 'Escape' });
    expect(notCancelled).toBe(false); // preventDefault — <dialog> cancel 로 이어지지 않는다
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();

    fireEvent.pointerUp(document, { clientX: 260, clientY: 10 });
    fireEvent.click(button);
    expect(headers()).toEqual(DEFAULT_HEADERS);
    expect(th('이름')).not.toHaveAttribute('aria-sort');

    // 드래그가 아닐 때의 Esc 는 그대로 전파된다
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('드래그 중이 아닐 때 Esc 는 막지 않는다 — 모달(<dialog> cancel)·문서 리스너(알림 드롭다운)에 그대로 전달 (#32 §9)', () => {
    const onParentKeyDown = vi.fn();
    const onDocumentKeyDown = vi.fn();
    document.addEventListener('keydown', onDocumentKeyDown);
    render(
      <div onKeyDown={onParentKeyDown}>
        <DataTable
          tableId="t"
          userId="u1"
          columns={COLUMNS}
          rows={ROWS}
          getRowKey={(r) => r.id}
          aria-label="테스트 표"
        />
      </div>,
    );
    const button = sortButton('이름');
    // 평상시: 헤더 버튼·리사이즈 핸들 포커스
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(true); // preventDefault 없음 → dialog cancel 정상
    expect(fireEvent.keyDown(handle('이름'), { key: 'Escape' })).toBe(true);
    // 누르고 있지만 5px 미만(드래그 전): 아직 드래그가 아니다
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 12, clientY: 10 });
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(true);
    fireEvent.pointerUp(document, { clientX: 12, clientY: 10 });
    // 드래그가 끝난 뒤
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 260, clientY: 10 });
    fireEvent.pointerUp(document, { clientX: 260, clientY: 10 });
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(true);

    expect(onParentKeyDown).toHaveBeenCalledTimes(4);
    expect(onDocumentKeyDown).toHaveBeenCalledTimes(4);
    document.removeEventListener('keydown', onDocumentKeyDown);
  });

  it('터치 포인터는 끌어도 이동하지 않고 탭은 정렬한다', () => {
    renderTable();
    const button = sortButton('이름');
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 10 });
    expect(ghost()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 300, clientY: 10 });
    fireEvent.click(button);
    expect(headers()).toEqual(DEFAULT_HEADERS);
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
  });
});

describe('DataTable 저장', () => {
  const saved = JSON.stringify({
    order: ['price', 'name', 'role', 'created', 'actions'],
    widths: { name: 200 },
  });

  it('서버 렌더(첫 렌더)는 기본 레이아웃이고 저장값은 마운트 뒤에 적용된다', () => {
    localStorage.setItem(KEY, saved);
    const html = renderToString(
      <DataTable
        tableId="t"
        userId="u1"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        aria-label="테스트 표"
      />,
    );
    expect(html.indexOf('이름')).toBeLessThan(html.indexOf('판매가'));
    expect(html).not.toContain('colgroup');

    renderTable();
    expect(headers()).toEqual(['판매가', '이름', '역할', '등록일', '관리']);
    expect(table().style.tableLayout).toBe('fixed');
    expect(colWidth('name')).toBe('200px');
    expectCellsFollowHeaders();
  });

  it('다른 사용자 키의 저장값은 쓰지 않는다', () => {
    localStorage.setItem('prami:table:t:v1:other', saved);
    renderTable();
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('손상된 저장값이면 기본 레이아웃이다', () => {
    localStorage.setItem(KEY, '{not json');
    renderTable();
    expect(headers()).toEqual(DEFAULT_HEADERS);
    expect(table().querySelector('colgroup')).toBeNull();
  });

  it("'열 초기화'는 기본 상태에서 비활성이고, 누르면 기본으로 돌아가며 정렬은 유지한다", async () => {
    render(
      <>
        <DataTableResetButton tableId="t" userId="u1" columns={COLUMNS} />
        <DataTable
          tableId="t"
          userId="u1"
          columns={COLUMNS}
          rows={ROWS}
          getRowKey={(r) => r.id}
          aria-label="테스트 표"
        />
      </>,
    );
    const reset = screen.getByRole('button', { name: '열 초기화' });
    expect(reset).toBeDisabled();

    await userEvent.click(sortButton('이름'));
    expect(reset).toBeDisabled(); // 정렬은 레이아웃이 아니다

    sortButton('이름').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    handle('판매가').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(reset).toBeEnabled();

    await userEvent.click(reset);
    expect(headers()).toEqual(DEFAULT_HEADERS);
    expect(table().querySelector('colgroup')).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(reset).toBeDisabled();
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending');
    // 비활성화된 버튼 대신 첫 헤더 버튼으로 포커스를 옮기고 알린다 (#32 §9 Q4)
    await waitFor(() => expect(sortButton('이름')).toHaveFocus());
    expect(liveRegion()).toHaveTextContent('열 너비·순서를 기본값으로 되돌렸습니다');
  });

  it('localStorage 쓰기가 실패해도 이번 탭에서는 바뀐 레이아웃이 유지된다 (메모리 폴백, #32 §9 Q3)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    renderTable();
    sortButton('이름').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(['판매가', '이름', '역할', '등록일', '관리']);
    handle('판매가').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(colWidth('price')).toBe('116px');
    expect(localStorage.getItem(KEY)).toBeNull();
    expectCellsFollowHeaders();

    // 다음 테스트로 메모리 폴백이 새지 않게 — 쓰기가 다시 성공하면 폴백을 비운다
    setItem.mockRestore();
    act(() => clearLayout(KEY));
    expect(headers()).toEqual(DEFAULT_HEADERS);
  });

  it('다른 탭의 storage 이벤트로 바뀐 레이아웃을 반영한다', () => {
    renderTable();
    act(() => {
      localStorage.setItem(KEY, saved);
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(headers()).toEqual(['판매가', '이름', '역할', '등록일', '관리']);
  });
});

describe('DataTable 빈 상태 (table-column-filter §2.5-7, A-1 백로그 — 320px 잘림)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('빈 상태는 가로 스크롤 영역의 왼쪽에 고정(sticky)되고 폭 = 스크롤 영역의 보이는 폭', () => {
    // jsdom 은 레이아웃이 없다 — 스크롤 영역(overflow-x-auto) 보이는 폭 296px(320px 화면 - 여백)을 흉내
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('overflow-x-auto') ? 296 : 0;
    });
    renderTable({ rows: [], empty: <button type="button">필터 초기화</button> });
    const box = screen.getByTestId('data-table-empty');
    expect(box).toHaveClass('sticky', 'left-0');
    expect(box.style.width).toBe('296px');
    expect(box.closest('td')).toHaveAttribute('colspan', String(DEFAULT_HEADERS.length));
    expect(within(box).getByRole('button', { name: '필터 초기화' })).toBeInTheDocument();
  });

  it('측정 전(서버 렌더)에는 폭 지정 없음 — 하이드레이션 불일치 없음, 행이 있으면 빈 상태 없음', () => {
    const html = renderToString(
      <DataTable
        tableId="t"
        userId="u1"
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        aria-label="테스트 표"
        empty="없음"
      />,
    );
    expect(html).toContain('data-testid="data-table-empty"');
    expect(html).not.toMatch(/data-table-empty"[^>]*style=/);
    renderTable({ empty: '없음' });
    expect(screen.queryByTestId('data-table-empty')).toBeNull();
  });
});
