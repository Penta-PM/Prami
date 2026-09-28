import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CalculatorPage from '@/app/(app)/calculator/page';
import { PAGE_SPECS, type PageKey } from '@/features/shell/pages';

/** PR-6 까지 구현되지 않은 화면만 자리표시자로 남는다 (계산기 PR-7) */
const PAGES: Record<PageKey, () => React.JSX.Element> = {
  calculator: CalculatorPage,
};

describe('자리표시자 페이지', () => {
  it.each(Object.keys(PAGES) as PageKey[])('%s 페이지는 제목과 예정 PR 을 표시한다', (key) => {
    const Page = PAGES[key];
    const spec = PAGE_SPECS[key];
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: spec.title })).toBeInTheDocument();
    expect(screen.getByText(`${spec.plannedPr} 예정`)).toBeInTheDocument();
    expect(screen.getByText(spec.description)).toBeInTheDocument();
  });
});
