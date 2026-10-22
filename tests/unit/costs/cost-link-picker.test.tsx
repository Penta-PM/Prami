import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  COST_LINK_PICKER_RENDER_MAX,
  CostLinkPicker,
  type CostLinkPickerProps,
} from '@/features/costs/CostLinkPicker';
import type { CostLinkMaterial } from '@/server/cost/item-link-types';

/**
 * 원가 자재 피커 (빠른 필터 바 디자인 보정 §7.4) — 검색 combobox + listbox/option, 행 2줄(자재명·자재번호) + [현재]/[제안] 배지,
 * ↑↓·Enter(폼 제출 없음), 클릭 선택, 검색 시 선택 자재 유지, 200건 렌더 상한, 결과 없음.
 */
const MATERIALS: CostLinkMaterial[] = [
  { materialCode: 'W1700', materialName: 'WAPPLES-1700 T2 본체' },
  { materialCode: 'W2600', materialName: 'WAPPLES-2600' },
  { materialCode: 'K300', materialName: 'D.AMO KMS' },
];

function Harness(
  props: Partial<CostLinkPickerProps> & { initial?: string; onSubmit?: () => void },
) {
  const { initial = '', onSubmit = () => {}, ...rest } = props;
  const [chosen, setChosen] = useState(initial);
  return (
    <form
      aria-label="폼"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <CostLinkPicker materials={MATERIALS} chosen={chosen} onChosenChange={setChosen} {...rest} />
      <button type="submit">확정</button>
      <output data-testid="chosen">{chosen}</output>
    </form>
  );
}

const combo = () => screen.getByRole('combobox', { name: '자재명·자재번호 검색' });
const list = () => screen.getByRole('listbox', { name: /원가 자재/ });
const option = (code: string) =>
  within(list())
    .getAllByRole('option')
    .find((el) => el.dataset.materialCode === code)!;

describe('CostLinkPicker', () => {
  it('ARIA: combobox(aria-controls=listbox, aria-expanded, aria-autocomplete=list) + listbox 이름 "원가 자재 (N건)", option aria-selected', () => {
    render(<Harness initial="W2600" />);
    expect(combo()).toHaveAttribute('aria-controls', list().id);
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(combo()).toHaveAttribute('aria-autocomplete', 'list');
    expect(list()).toHaveAccessibleName('원가 자재 (3건)');
    expect(within(list()).getAllByRole('option')).toHaveLength(3);
    expect(option('W2600')).toHaveAttribute('aria-selected', 'true');
    expect(option('W1700')).toHaveAttribute('aria-selected', 'false');
    // 선택 행이 처음 활성 행
    expect(combo()).toHaveAttribute('aria-activedescendant', option('W2600').id);
  });

  it('행: min-h-11 px-3 py-2, 1행 자재명 13px font-medium 2줄, 2행 자재번호 12px tabular-nums tertiary, 선택 행 bg-purple-600/8 + 체크, divide-y', () => {
    render(<Harness initial="W2600" currentCode="W1700" suggestedCode="W2600" />);
    const row = option('W2600');
    expect(row).toHaveClass('min-h-11', 'px-3', 'py-2', 'bg-purple-600/8');
    expect(row.querySelector('svg')).not.toBeNull();
    expect(option('W1700')).toHaveClass('hover:bg-gray-75');
    expect(option('W1700').querySelector('svg')).toBeNull();
    expect(within(row).getByText('WAPPLES-2600')).toHaveClass(
      'text-[13px]',
      'font-medium',
      'line-clamp-2',
    );
    expect(within(row).getByText('W2600')).toHaveClass(
      'text-[12px]',
      'tabular-nums',
      'text-text-tertiary',
    );
    expect(list()).toHaveClass('divide-y', 'divide-border-subtle', 'max-h-[min(320px,45vh)]');
  });

  it('[현재]/[제안] 배지 — 현재 매핑·제안 자재 행에만', () => {
    render(<Harness currentCode="W1700" suggestedCode="W2600" />);
    expect(within(option('W1700')).getByText('현재')).toBeInTheDocument();
    expect(within(option('W1700')).queryByText('제안')).toBeNull();
    expect(within(option('W2600')).getByText('제안')).toBeInTheDocument();
    expect(within(option('K300')).queryByText(/현재|제안/)).toBeNull();
  });

  it('검색: 자재명·자재번호 부분 일치(대소문자 무시), 선택한 자재는 남김, 결과 수 갱신, 결과 없음 문구', async () => {
    render(<Harness initial="W1700" />);
    await userEvent.type(combo(), 'kms');
    expect(
      within(list())
        .getAllByRole('option')
        .map((el) => el.dataset.materialCode),
    ).toEqual(['W1700', 'K300']);
    expect(list()).toHaveAccessibleName('원가 자재 (2건)');
    await userEvent.clear(combo());
    await userEvent.type(combo(), 'zzz');
    // 선택 자재(W1700)는 검색과 무관하게 남는다
    expect(within(list()).getAllByRole('option')).toHaveLength(1);

    render(<Harness />, { container: document.body.appendChild(document.createElement('div')) });
    const [, second] = screen.getAllByRole('combobox');
    await userEvent.type(second!, 'zzz');
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument();
  });

  it('↑↓ 로 활성 행 이동(aria-activedescendant), Enter 로 선택 — 폼은 제출되지 않는다', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    combo().focus();
    expect(combo()).not.toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-activedescendant', option('W1700').id);
    expect(option('W1700')).toHaveAttribute('data-active');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    // 끝에서 멈춘다
    expect(combo()).toHaveAttribute('aria-activedescendant', option('K300').id);
    await userEvent.keyboard('{ArrowUp}');
    expect(combo()).toHaveAttribute('aria-activedescendant', option('W2600').id);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('chosen')).toHaveTextContent('W2600');
    expect(option('W2600')).toHaveAttribute('aria-selected', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(combo()).toHaveFocus();

    // 활성 행 없이 Enter 해도 제출 없음
    await userEvent.type(combo(), 'zzz{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    // 확정 버튼으로는 제출된다
    await userEvent.click(screen.getByRole('button', { name: '확정' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('클릭으로 선택 — 검색창 포커스 유지', async () => {
    render(<Harness />);
    combo().focus();
    await userEvent.click(option('K300'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('K300');
    expect(combo()).toHaveAttribute('aria-activedescendant', option('K300').id);
  });

  it('disabled: 검색창 비활성, 클릭해도 선택되지 않음', async () => {
    render(<Harness disabled />);
    expect(combo()).toBeDisabled();
    await userEvent.click(option('K300'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
    expect(option('K300')).toHaveAttribute('aria-disabled', 'true');
  });

  it(`렌더 상한 ${COST_LINK_PICKER_RENDER_MAX}건 + "검색어를 좁혀 주세요", 상한 밖 선택 자재는 덧붙여 남김`, async () => {
    const many: CostLinkMaterial[] = Array.from({ length: 250 }, (_, i) => ({
      materialCode: `M${String(i).padStart(3, '0')}`,
      materialName: `자재 ${i}`,
    }));
    render(<Harness materials={many} initial="M240" />);
    const rows = within(list()).getAllByRole('option');
    expect(rows).toHaveLength(COST_LINK_PICKER_RENDER_MAX + 1);
    expect(rows.at(-1)!.dataset.materialCode).toBe('M240');
    expect(list()).toHaveAccessibleName('원가 자재 (250건)');
    expect(screen.getByText('200건까지 표시 — 검색어를 좁혀 주세요')).toHaveAttribute(
      'role',
      'status',
    );

    await userEvent.type(combo(), '자재 1');
    // "자재 1", "자재 10".."19", "자재 100".."199" = 111건 + 선택 자재(M240) → 상한 안
    expect(within(list()).getAllByRole('option')).toHaveLength(112);
    expect(screen.queryByText(/검색어를 좁혀 주세요/)).toBeNull();
  });
});
