import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** /calculator 조립 (서버 컴포넌트) — 권한 가드·쿼리는 모킹. 탭·원가 잠금 여부가 역할로 결정된다 */
const calls = vi.hoisted(() => ({
  guards: [] as string[],
  role: 'USER' as 'USER' | 'ADMIN',
  drafts: [] as { userId: string; skipQuote: boolean }[],
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    calls.guards.push(`${permission}:${path}`);
    return { id: 'u', email: 'x@pentasecurity.com', name: '픽스처', role: calls.role };
  },
}));
vi.mock('@/server/parts/catalog', () => ({ listProductFamilies: async () => ['WAPPLES'] }));
vi.mock('@/server/quotes/catalog', () => ({
  listQuotePriceTypes: async () => [{ priceType: '정상판매', count: 1 }],
  listQuoteCategories: async () => ({
    majors: ['WAPPLES'],
    mids: [],
    minorsByMid: {},
    hasMaster: false,
  }),
  listGroupHardware: async () => [],
}));
vi.mock('@/server/groups/queries', () => ({ listGroupChips: async () => [] }));
vi.mock('@/server/quotes/queries', () => ({ listMyQuotes: async () => [] }));
vi.mock('@/features/calculator/actions', () => ({
  listQuoteItemsAction: async () => ({ ok: true, data: [] }),
}));
vi.mock('@/features/costs/actions', () => ({}));

// 계산기 탭은 전환 시 ?tab= 을 router.replace 로 반영한다(page-state-memory §2.2-7)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/calculator',
  useSearchParams: () => new URLSearchParams(),
}));
// 조회 상태 복원·저장(page-state-memory B-1)은 tests/unit/page-state 에서 검증한다 — 여기서는 화면 렌더만
vi.mock('@/server/page-state/restore-page', () => ({
  restoreViewState: async (pageKey: string) => ({ pageKey, savedQuery: null, restoreTop: null }),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));
// 입력 초안 복원(page-state-memory B-2)은 tests/unit/page-state/drafts*.test.ts(x) 에서 검증한다 — 여기서는 전달만
vi.mock('@/server/page-state/draft-restore', () => ({
  restoreCalculatorDrafts: async (
    _db: unknown,
    userId: string,
    options: { skipQuote: boolean },
  ) => {
    calls.drafts.push({ userId, skipQuote: options.skipQuote });
    return {};
  },
}));
vi.mock('@/features/page-state/draft-actions', () => ({
  saveDraftAction: async () => ({ ok: true, data: { status: 'saved' } }),
  deleteDraftAction: async () => ({ ok: true, data: { status: 'deleted' } }),
  readDraftAction: async () => ({ ok: true, data: null }),
}));

const { default: CalculatorPage } = await import('@/app/(app)/calculator/page');

describe('/calculator', () => {
  it('calculator.use 가드, 견적 계산기 탭 기본, 제품 칩·STEP 카드·장바구니', async () => {
    render(await CalculatorPage({ searchParams: Promise.resolve({}) }));
    expect(calls.guards).toContain('calculator.use:/calculator');
    expect(screen.getByRole('heading', { level: 1, name: '계산기' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '견적 계산기' })).toBeChecked();
    expect(screen.getByRole('group', { name: '제품군' })).toHaveTextContent('WAPPLES');
    expect(screen.getByRole('region', { name: 'STEP 1 · 단가 유형' })).toHaveTextContent(
      '정상판매',
    );
    expect(screen.getByLabelText('장바구니')).toBeInTheDocument();
    // 입력 초안은 세션 사용자 것만 읽는다 (§2.7-2)
    expect(calls.drafts.at(-1)).toEqual({ userId: 'u', skipQuote: false });
  });

  it('챗봇 견적 시작 링크(?family=&item=)는 견적 입력 초안보다 우선한다', async () => {
    render(
      await CalculatorPage({ searchParams: Promise.resolve({ family: 'WAPPLES', item: 'P1' }) }),
    );
    expect(calls.drafts.at(-1)).toEqual({ userId: 'u', skipQuote: true });
  });

  it('?tab=margin 이면 순매출 탭, USER 는 원가 잠금', async () => {
    calls.role = 'USER';
    render(await CalculatorPage({ searchParams: Promise.resolve({ tab: 'margin' }) }));
    expect(screen.getByRole('radio', { name: '순매출 계산기' })).toBeChecked();
    expect(screen.getByRole('status', { name: '원가 잠금' })).toBeInTheDocument();
  });
});
