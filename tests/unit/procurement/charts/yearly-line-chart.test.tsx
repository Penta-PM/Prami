import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { YearlyLineChart, type YearlyPoint } from '@/features/procurement/charts';

/** 조달이 통합 UI-4 — 연도별 선 차트 (x = 1~12월, 연도마다 선). 합성 금액만 */
const M = 1_000_000;
function year(y: number, months: number[]): YearlyPoint[] {
  return months.map((amount, index) => ({
    month: `${y}-${String(index + 1).padStart(2, '0')}`,
    amount: amount * M,
  }));
}
// 2023 = 12개월, 2024 = 12개월(3월 실적 없음), 2025 = 4월까지
const POINTS = [
  ...year(2023, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
  ...year(2024, [20, 5, 0, 15, 10, 10, 10, 10, 10, 10, 10, 10]),
  ...year(2025, [30, 10, 10, 50]),
];

const plot = () => screen.getByRole('group', { name: '연도별 누적 매출' });

describe('YearlyLineChart', () => {
  it('연도마다 선 1개, 최근 연도는 --ink-900·굵게, 선 끝 연도 글자, 실적 없는 달은 점선', () => {
    render(<YearlyLineChart title="연도별 누적 매출" points={POINTS} />);
    const lines = [...document.querySelectorAll('[data-line]')];
    expect(lines.map((line) => line.getAttribute('data-line'))).toEqual(['2023', '2024', '2025']);
    const latest = lines.at(-1)!;
    expect(latest.querySelector('line')!.getAttribute('stroke')).toBe('var(--ink-900)');
    expect(latest.querySelector('line')!.getAttribute('stroke-width')).toBe('3');
    expect(latest).toHaveTextContent('25년');
    // 2025 는 4월까지 → 선분 3개, 표식 4개
    expect(latest.querySelectorAll('line')).toHaveLength(3);
    expect(latest.querySelectorAll('[data-marker]')).toHaveLength(4);
    // 2024 3월(실적 0) 구간만 점선
    const dashed = [...lines[1]!.querySelectorAll('line')].filter((line) =>
      line.hasAttribute('stroke-dasharray'),
    );
    expect(dashed).toHaveLength(1);
    // 연도마다 표식 모양이 다르다 (색 외 구분)
    const shapes = lines.map((line) =>
      line.querySelector('[data-marker]')!.getAttribute('data-marker'),
    );
    expect(new Set(shapes).size).toBe(3);
  });

  it('role="img" 요약 — 연도별 연간 누적(억·만)', () => {
    render(<YearlyLineChart title="연도별 누적 매출" points={POINTS} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      '연도별 누적 매출. 2023~2025년 3개 연도, 연간 누적 2023년 1억 2,000만, 2024년 1억 2,000만, 2025년 1억.',
    );
  });

  it('키보드: 1~12월 이동, 툴팁에 연도별 월 금액·누적 (자료 없는 해는 —)', async () => {
    const user = userEvent.setup();
    render(<YearlyLineChart title="연도별 누적 매출" points={POINTS} />);
    act(() => plot().focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('1월');
    await user.keyboard('{End}');
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('12월');
    expect(tip).toHaveTextContent('2025년——');
    expect(document.querySelector('[data-active-month]')).toHaveAttribute(
      'data-active-month',
      '12',
    );
    await user.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.querySelector('[data-chart-live]')).toHaveTextContent(
      '4월: 2025년 월 5,000만, 누적 1억. 2024년 월 1,500만, 누적 4,000만. 2023년 월 1,000만, 누적 4,000만',
    );
  });

  it('범례: 최근 연도 먼저, 강조·숨김', async () => {
    const user = userEvent.setup();
    render(<YearlyLineChart title="연도별 누적 매출" points={POINTS} />);
    const legend = screen.getByRole('list', { name: '연도별 누적 매출 범례' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-legend-item')),
    ).toEqual(['2025', '2024', '2023']);
    await user.click(screen.getByRole('button', { name: '2023년' }));
    expect(document.querySelector('[data-line="2025"]')).toHaveAttribute('opacity', '0.15');
    await user.click(screen.getByRole('button', { name: '2024년 숨기기' }));
    expect(document.querySelector('[data-line="2024"]')).toBeNull();
  });

  it('표로 보기 — 행 1~12월 × 열 연도(최근 먼저), 차트와 같은 누적값(백만원), 없는 달 —', async () => {
    const user = userEvent.setup();
    render(<YearlyLineChart title="연도별 누적 매출" points={POINTS} />);
    await user.click(screen.getByRole('button', { name: '표로 보기' }));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('연초부터 누적 (단위: 백만원)');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(13);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(rows[1]!)).toEqual(['30.0', '20.0', '10.0']);
    expect(cells(rows[4]!)).toEqual(['100.0', '40.0', '40.0']);
    expect(cells(rows[5]!)).toEqual(['—', '50.0', '50.0']);
  });

  it('monthly 모드 — 월 금액을 그대로 (표도 같은 값)', async () => {
    const user = userEvent.setup();
    render(<YearlyLineChart title="연도별 월 매출" points={POINTS} mode="monthly" />);
    await user.click(screen.getByRole('button', { name: '표로 보기' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(
      within(rows[4]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['50.0', '15.0', '10.0']);
  });

  it('데이터가 없으면 안내 문구', () => {
    render(<YearlyLineChart title="연도별" points={[]} />);
    expect(screen.getByText('표시할 데이터가 없습니다')).toBeInTheDocument();
  });
});
