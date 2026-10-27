import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementDeliveries, procurementItems } from '@/db/schema/procurement';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-5 — /procurement 화면(서버 컴포넌트) + PGlite + 실제 조회(server/procurement/performance).
 * 합성 데이터만(가상 제조사·기관). URL(기간·기준월·고른 달·페이지·강조)이 상태이고 서버가 집계·페이지네이션한다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: '198.51.100.7', userAgent: 'vitest' }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/procurement',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

const { default: PerformancePage } = await import('@/app/(app)/procurement/page');
const { writeViewQuery } = await import('@/server/page-state/store');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const open = (params: Record<string, string> = {}) =>
  PerformancePage({ searchParams: Promise.resolve(params) });

const M = 1_000_000;
const Q1 = { from: '2025-01', to: '2025-03', month: '2025-03' };
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  await state.handle.db.insert(procurementItems).values([
    { itemId: 'P-1', product: 'WAPPLES', manufacturer: '(주)펜타시큐리티', status: 'active' },
    { itemId: 'P-2', product: 'WAPPLES', manufacturer: '가상보안', status: 'active' },
    {
      itemId: 'P-3',
      product: 'iSIGN',
      manufacturer: '가상인증',
      detailCategory: 'SSO',
      status: 'active',
    },
  ]);
  await state.handle.db.insert(procurementDeliveries).values([
    {
      dlvrReqNo: 'S-OURS-1',
      itemId: 'P-1',
      dlvrReqDate: '2025-01-10',
      amount: 100 * M,
      demandOrg: '가상기관',
    },
    // 첫 변경차수만 (D-9)
    {
      dlvrReqNo: 'S-OURS-1',
      itemId: 'P-1',
      changeOrd: '01',
      dlvrReqDate: '2025-01-20',
      amount: 999 * M,
    },
    // 1월 가상보안 55건 (서버 페이지네이션 — 50건/쪽)
    ...Array.from({ length: 55 }, (_, index) => ({
      dlvrReqNo: `S-RIVAL-${String(index).padStart(3, '0')}`,
      itemId: 'P-2',
      dlvrReqDate: `2025-01-${String(1 + (index % 28)).padStart(2, '0')}`,
      amount: 1 * M,
      demandOrg: '가상기관',
    })),
    { dlvrReqNo: 'S-SSO-1', itemId: 'P-3', dlvrReqDate: '2025-03-05', amount: 40 * M },
    { dlvrReqNo: 'S-PREV-1', itemId: 'P-1', dlvrReqDate: '2024-03-15', amount: 50 * M },
  ]);
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = userId;
});

describe('/procurement 조달 실적 현황', () => {
  it('KPI(억·만)·보고표·콤보 차트·제조사 표·연도별 — 서버 집계', async () => {
    render(await open(Q1));
    expect(screen.getByRole('heading', { level: 1, name: '조달 실적 현황' })).toBeInTheDocument();
    const kpi = Object.fromEntries(
      [...document.querySelectorAll('[data-kpi]')].map((card) => [
        card.getAttribute('data-kpi'),
        card.querySelectorAll('dd')[0]!.textContent,
      ]),
    );
    // 자사 1억 / 전체 1억 9,500만 = 51.3%, 가상보안 28.2% → +23.1%p, 전년 5,000만 → +100%
    expect(kpi).toEqual({ amount: '1억', share: '51.3%', rival: '+23.1%p', yoy: '+100.0%' });
    expect(screen.getByTestId('monthly-report')).toHaveTextContent('전체 25년 조달 3월 실적');
    const table = screen.getByTestId('manufacturer-table');
    expect(
      [...table.querySelectorAll('[data-manufacturer-row]')].map((row) =>
        row.getAttribute('data-manufacturer-row'),
      ),
    ).toEqual(['m:(주)펜타시큐리티', 'm:가상보안', 'm:가상인증']);
    // 표 금액 = 백만원 소수 1자리
    expect(table.querySelector('[data-manufacturer-row="m:가상보안"]')).toHaveTextContent('55.0');
    const legend = screen.getByRole('list', { name: '전체 월별 매출 추이 범례' });
    expect(
      within(legend).getByRole('button', { name: /^펜타시큐리티\s?자사$/ }),
    ).toBeInTheDocument();
    const yearly = document.querySelector('[data-yearly-table="amount"]') as HTMLElement;
    expect(
      within(yearly)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['제조사', '2024', '2025', '합계']);
    expect(screen.queryByTestId('month-contracts')).toBeNull();
  });

  it('고른 달 → 그 달 계약 목록, 서버 페이지네이션(50건/쪽)', async () => {
    render(await open({ ...Q1, sel: '2025-01' }));
    const list = screen.getByTestId('month-contracts');
    expect(within(list).getByRole('heading', { level: 3 })).toHaveTextContent(
      '전체 · 25.01 계약 목록 (56건 · 1억 5,500만)',
    );
    expect(list.querySelectorAll('[data-contract-row]')).toHaveLength(50);
    expect(within(list).getByRole('navigation')).toHaveTextContent('1 / 2 페이지');
    const { container } = render(await open({ ...Q1, sel: '2025-01', page: '2' }));
    expect(container.querySelectorAll('[data-contract-row]')).toHaveLength(6);
  });

  it('강조 제조사(mfr)가 있으면 그 회사 계약만', async () => {
    render(await open({ ...Q1, sel: '2025-01', mfr: 'm:가상보안' }));
    expect(
      within(screen.getByTestId('month-contracts')).getByRole('heading', { level: 3 }),
    ).toHaveTextContent('가상보안 · 25.01 계약 목록 (55건 · 5,500만)');
    expect(document.querySelector('[data-manufacturer-row="m:가상보안"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });

  it('기간 밖의 고른 달은 무시한다', async () => {
    render(await open({ ...Q1, to: '2025-02', sel: '2025-03' }));
    expect(screen.queryByTestId('month-contracts')).toBeNull();
  });

  it('iSIGN 세부 그룹 탭', async () => {
    render(await open({ ...Q1, tab: 'iSIGN', group: 'SSO' }));
    expect(screen.getByTestId('monthly-report')).toHaveTextContent(
      'iSIGN · SSO 25년 조달 3월 실적',
    );
    expect(
      [...document.querySelectorAll('[data-manufacturer-row]')].map((row) =>
        row.getAttribute('data-manufacturer-row'),
      ),
    ).toEqual(['m:가상인증', 'm:펜타시큐리티']);
  });

  it('실적 없는 범위는 빈 상태', async () => {
    render(await open({ tab: 'D.AMO' }));
    expect(screen.getByRole('status')).toHaveTextContent('D.AMO 조달 실적이 없습니다');
  });

  it('파라미터 없는 진입은 저장된 조회 상태로 복원 redirect (B-1)', async () => {
    await writeViewQuery(state.handle!.db, userId, 'procurement', 'tab=WAPPLES&month=2025-02');
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/procurement?tab=WAPPLES&month=2025-02');
    await writeViewQuery(state.handle!.db, userId, 'procurement', '');
  });
});
