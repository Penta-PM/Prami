import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PartMappingView } from '@/features/parts/types';

/** #32 PR-2: 파츠 매핑 표가 공용 DataTable(클라이언트 정렬)로 동작한다 */
// 정렬·필터는 URL 상태(page-state-memory §2.2-6) — router.replace 가 useSearchParams 를 바꾸는 메모리 더블
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);
const { navigation } = await import('../../helpers/next-navigation');

const { PartsMappingTable } = await import('@/features/parts/PartsMappingTable');

const mapping = (modelItemCode: string, modelName: string, parts: string[]): PartMappingView => ({
  modelItemCode,
  modelName,
  parts: parts.map((itemName, index) => ({ itemName, itemCode: `${modelItemCode}-${index}` })),
});

// 'WAPPLES-2700' 이 'WAPPLES-300' 보다 앞(코드포인트, 스펙 §2), 대소문자는 무시
const MAPPINGS: PartMappingView[] = [
  mapping('M1', 'Wapples-300', ['N_1']),
  mapping('M2', 'WAPPLES-2700', ['N_2', 'N_3']),
  mapping('M3', 'D.AMO KE', ['N_4']),
];

const table = () => screen.getByRole('table', { name: '등록된 매핑 표' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const codes = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.querySelector('span')?.textContent);
const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);

const renderTable = (onEdit = vi.fn(), onDelete = vi.fn()) =>
  render(<PartsMappingTable mappings={MAPPINGS} onEdit={onEdit} onDelete={onDelete} userId="u1" />);

beforeEach(() => {
  navigation.reset('/admin/parts');
  localStorage.clear();
});

describe('PartsMappingTable (DataTable)', () => {
  it('기본 헤더 순서와 행 순서는 그대로다', () => {
    renderTable();
    expect(headers()).toEqual(['모델', '장착 가능 파츠 (품번)', '관리']);
    expect(codes()).toEqual(['M1', 'M2', 'M3']);
  });

  it('모델: aria-sort 오름 → 내림 → 없음, 순서가 기본으로 돌아온다', async () => {
    renderTable();
    const button = within(th('모델')).getByRole('button');
    await userEvent.click(button);
    expect(th('모델')).toHaveAttribute('aria-sort', 'ascending');
    expect(codes()).toEqual(['M3', 'M2', 'M1']);
    await userEvent.click(button);
    expect(th('모델')).toHaveAttribute('aria-sort', 'descending');
    expect(codes()).toEqual(['M1', 'M2', 'M3']);
    await userEvent.click(button);
    expect(th('모델')).not.toHaveAttribute('aria-sort');
    expect(codes()).toEqual(['M1', 'M2', 'M3']);
  });

  it('장착 파츠(목록) 열은 정렬하지 않지만 이동은 된다, 관리 열은 버튼·aria-sort 가 없다', async () => {
    renderTable();
    const partsButton = within(th('장착 가능 파츠 (품번)')).getByRole('button');
    await userEvent.click(partsButton);
    expect(th('장착 가능 파츠 (품번)')).not.toHaveAttribute('aria-sort');
    expect(codes()).toEqual(['M1', 'M2', 'M3']);

    expect(within(th('관리')).queryByRole('button')).toBeNull();
    expect(th('관리')).not.toHaveAttribute('aria-sort');

    partsButton.focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(headers()).toEqual(['장착 가능 파츠 (품번)', '모델', '관리']);
    expect(localStorage.getItem('prami:table:parts-mapping:v1:u1')).not.toBeNull();
  });

  it("'열 초기화'는 기본 상태에서 비활성이고, 바꾼 뒤 누르면 기본으로 돌아온다", async () => {
    renderTable();
    const reset = screen.getByRole('button', { name: '열 초기화' });
    expect(reset).toBeDisabled();
    within(th('모델')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(reset).toBeEnabled();
    await userEvent.click(reset);
    expect(headers()).toEqual(['모델', '장착 가능 파츠 (품번)', '관리']);
    expect(reset).toBeDisabled();
  });

  it('정렬 뒤에도 행 액션은 해당 매핑을 넘긴다', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderTable(onEdit, onDelete);
    await userEvent.click(within(th('모델')).getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: 'D.AMO KE 매핑 수정' }));
    expect(onEdit).toHaveBeenCalledWith(MAPPINGS[2]);
    await userEvent.click(screen.getByRole('button', { name: 'Wapples-300 매핑 삭제' }));
    expect(onDelete).toHaveBeenCalledWith(MAPPINGS[0]);
  });
});
