import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AdminCostsPage from '@/app/(app)/admin/costs/page';
import AdminGroupsPage from '@/app/(app)/admin/groups/page';
import AdminNoticesPage from '@/app/(app)/admin/notices/page';
import AdminPartsPage from '@/app/(app)/admin/parts/page';
import CalculatorPage from '@/app/(app)/calculator/page';
import NoticesPage from '@/app/(app)/notices/page';
import HomePage from '@/app/(app)/page';
import SearchPage from '@/app/(app)/search/page';
import { PAGE_SPECS, type PageKey } from '@/features/shell/pages';

const PAGES: Record<PageKey, () => React.JSX.Element> = {
  home: HomePage,
  calculator: CalculatorPage,
  notices: NoticesPage,
  search: SearchPage,
  adminCosts: AdminCostsPage,
  adminParts: AdminPartsPage,
  adminGroups: AdminGroupsPage,
  adminNotices: AdminNoticesPage,
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
