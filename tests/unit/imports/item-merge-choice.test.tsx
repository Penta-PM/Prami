import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ItemMergeChoice, ReplaceConfirmModal } from '@/features/admin-policies/ItemMergeChoice';

/** PRAMI-003 AC-373 ③ (PR #19 I-3) 운영중 행 증감 안내 · AC-375 ③ (PR #19 I-7) 위험 색 토큰 */
describe('ItemMergeChoice · ReplaceConfirmModal', () => {
  const info = {
    missingFamilies: ['D.AMO'],
    vanishingItems: 2126,
    operating: { now: 2428, afterReplace: 3644 },
  };

  it('전량 교체 선택 시 사라질 품번 수 + 운영중 행 2,428 → 3,644(+1,216) 를 위험 색 토큰으로 보여 준다', () => {
    render(<ItemMergeChoice info={info} value="replace" onChange={vi.fn()} />);
    const delta = screen.getByTestId('operating-delta');
    expect(delta).toHaveTextContent('운영중 판매단가 행은 2,428 → 3,644(+1,216)이 될 예정입니다.');
    expect(delta.parentElement).toHaveClass('text-text-danger');
    expect(screen.getByText(/2,126개 품번/)).toBeInTheDocument();
  });

  it('확인 모달에도 같은 증감, 변화가 없으면 "변화 없음", 정보가 없으면 생략', () => {
    const { rerender } = render(
      <ReplaceConfirmModal
        open
        vanishingItems={3}
        operating={{ now: 10, afterReplace: 10 }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('operating-delta')).toHaveTextContent('10 → 10(변화 없음)');
    rerender(
      <ReplaceConfirmModal open vanishingItems={3} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByTestId('operating-delta')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('품번 3개가 사라집니다');
  });

  it('AC-375 ③: 하드코딩 text-red-500 이 없다 (grep)', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../src/features/admin-policies/ItemMergeChoice.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/text-red-\d{3}/);
    expect(source).toContain('text-text-danger');
  });
});
