import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import {
  DataTableQuickFilterBar,
  QuickFilterEditor,
  type DataTableFilterField,
} from '@/components/ui/data-table';
import type { FilterCondition } from '@/lib/table/filter';

/**
 * 빠른 필터 바 디자인 보정 PR-4 (table-filter-quickbar §7.1·§7.2) — enum 목록 행(40px+, 행 전체 클릭, hover·선택 스타일),
 * 하단 "N개 선택됨" · "선택 해제", "＋ N개 더" 목록 행, 날짜 입력 1열·min-w-0, 팝오버 가로 넘침 차단, 건수 줄바꿈.
 */
type Row = { status: string; note: string; created: string; amount: number };

const STATUS: DataTableFilterField<Row> = {
  id: 'status',
  label: '상태',
  quick: true,
  filter: {
    kind: 'enum',
    options: [
      { value: 'ACTIVE', label: '활성' },
      { value: 'INACTIVE', label: '비활성' },
      { value: 'LONG', label: '아주 긴 이름의 상태값으로 줄바꿈이 필요한 선택지' },
    ],
  },
  value: (row) => row.status,
};
const CREATED: DataTableFilterField<Row> = {
  id: 'created',
  label: '등록일',
  quick: true,
  filter: { kind: 'date' },
  value: (row) => row.created,
};
const NOTE: DataTableFilterField<Row> = {
  id: 'note',
  label: '비고',
  filter: { kind: 'text' },
  value: (row) => row.note,
};
const AMOUNT: DataTableFilterField<Row> = {
  id: 'amount',
  label: '금액',
  filter: { kind: 'number' },
  value: (row) => row.amount,
};
const FIELDS = [STATUS, CREATED, NOTE, AMOUNT];

function EditorHarness({ field = STATUS }: { field?: DataTableFilterField<Row> }) {
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  return (
    <>
      <QuickFilterEditor
        field={field}
        fields={FIELDS}
        filters={filters}
        onToggle={setFilters}
        onApply={setFilters}
      />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

const optionRow = (label: string) => screen.getByText(label).closest('label') as HTMLElement;

describe('enum 목록 행 (§7.2)', () => {
  it('행: min-h-10 px-2.5 py-2 rounded-lg gap-2.5 text-[13px], 미선택 hover bg-gray-75, 긴 글자 min-w-0 break-words', () => {
    render(<EditorHarness />);
    const row = optionRow('활성');
    expect(row).toHaveClass(
      'min-h-10',
      'px-2.5',
      'py-2',
      'rounded-lg',
      'gap-2.5',
      'text-[13px]',
      'hover:bg-gray-75',
    );
    expect(row).not.toHaveClass('bg-purple-600/8');
    expect(screen.getByText('아주 긴 이름의 상태값으로 줄바꿈이 필요한 선택지')).toHaveClass(
      'min-w-0',
      'break-words',
    );
    const list = document.querySelector('[data-filter-options]')!;
    expect(list).toHaveClass('gap-0.5', 'max-h-[min(280px,45vh)]', 'overflow-y-auto');
    expect(screen.getByText('상태', { selector: 'legend' })).toHaveClass('mb-2');
  });

  it('행 전체가 클릭 영역 — 글자가 아닌 행(label)을 눌러도 체크·즉시 적용, 선택 행은 bg-purple-600/8 font-medium', async () => {
    render(<EditorHarness />);
    await userEvent.click(optionRow('비활성'));
    expect(screen.getByRole('checkbox', { name: '비활성' })).toBeChecked();
    expect(screen.getByTestId('filters')).toHaveTextContent(
      JSON.stringify([{ col: 'status', op: 'in', values: ['INACTIVE'] }]),
    );
    expect(optionRow('비활성')).toHaveClass('bg-purple-600/8', 'font-medium');
    expect(optionRow('비활성')).not.toHaveClass('hover:bg-gray-75');
    expect(optionRow('활성')).not.toHaveClass('bg-purple-600/8');
  });

  it('공용 Checkbox 사용 — accent- 네이티브 체크 없음', () => {
    render(<EditorHarness />);
    const input = screen.getByRole('checkbox', { name: '활성' });
    expect(input).toHaveClass('appearance-none', 'border-slate-600-aa');
    expect(input.className).not.toMatch(/accent-/);
  });

  it('하단 구분선 아래: 왼쪽 "N개 선택됨" + 오른쪽 "선택 해제" — 해제하면 0개·비활성', async () => {
    render(<EditorHarness />);
    const count = document.querySelector('[data-filter-selected-count]')!;
    expect(count).toHaveTextContent('0개 선택됨');
    expect(count.parentElement).toHaveClass('border-t', 'border-border-subtle', 'justify-between');
    const clear = screen.getByRole('button', { name: '선택 해제' });
    expect(clear).toBeDisabled();

    await userEvent.click(optionRow('활성'));
    await userEvent.click(optionRow('비활성'));
    expect(count).toHaveTextContent('2개 선택됨');
    expect(clear).toBeEnabled();
    await userEvent.click(clear);
    expect(count).toHaveTextContent('0개 선택됨');
    expect(screen.getByTestId('filters')).toHaveTextContent('[]');
    expect(screen.getByRole('checkbox', { name: '활성' })).not.toBeChecked();
  });
});

describe('넘침 (§7.1)', () => {
  it('A1 날짜 입력: 1열 grid, label·input min-w-0', () => {
    render(<EditorHarness field={CREATED} />);
    const start = screen.getByLabelText('시작일');
    const end = screen.getByLabelText('종료일');
    expect(start.closest('label')).toHaveClass('min-w-0');
    expect(end.closest('label')).toHaveClass('min-w-0');
    expect(start).toHaveClass('min-w-0', 'w-full');
    const grid = start.closest('label')!.parentElement!;
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).not.toHaveClass('grid-cols-2');
  });

  it('A2 팝오버: overflow-y-auto overflow-x-hidden. "＋ N개 더" 목록 행 min-h-10 px-2.5', async () => {
    function Bar() {
      const [filters, setFilters] = useState<readonly FilterCondition[]>([]);
      return (
        <DataTableQuickFilterBar
          fields={FIELDS}
          filters={filters}
          onFiltersChange={setFilters}
          onReset={() => setFilters([])}
          rows={[]}
        />
      );
    }
    render(<Bar />, { wrapper: MotionProvider });
    await userEvent.click(screen.getByRole('button', { name: '＋ 2개 더' }));
    const dialog = await screen.findByRole('dialog', { name: '필터 더 보기' });
    expect(dialog).toHaveClass('overflow-y-auto', 'overflow-x-hidden');
    expect(dialog).not.toHaveClass('overflow-auto');
    expect(within(dialog).getByText('필터할 열')).toHaveClass('mb-2');
    const row = within(dialog).getByRole('button', { name: '비고' });
    expect(row).toHaveClass('min-h-10', 'px-2.5', 'rounded-lg', 'min-w-0', 'break-words');

    // A6 건수 영역: min-w-0 flex-wrap justify-end
    const count = document.querySelector('[data-quick-filter-count]')!;
    expect(count.parentElement).toHaveClass('min-w-0', 'flex-wrap', 'justify-end');
  });
});
