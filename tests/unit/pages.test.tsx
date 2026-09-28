import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AdminGroupsPage from '@/app/(app)/admin/groups/page';
import AdminPartsPage from '@/app/(app)/admin/parts/page';
import CalculatorPage from '@/app/(app)/calculator/page';
import { PAGE_SPECS, type PageKey } from '@/features/shell/pages';

/** PR-9 까지 구현되지 않은 화면만 자리표시자로 남는다 (계산기 PR-7, 파츠·그룹 PR-6) */
const PAGES: Record<PageKey, () => React.JSX.Element> = {
  calculator: CalculatorPage,
  adminParts: AdminPartsPage,
  adminGroups: AdminGroupsPage,
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
