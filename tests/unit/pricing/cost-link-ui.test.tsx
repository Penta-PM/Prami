import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CostLink, costLinkState } from '@/features/pricing/cells';
import { PRICE_SORT_IDS, parsePriceFilter } from '@/features/pricing/filter';
import type { CostLinkCellView, PriceRowView } from '@/features/pricing/types';

/**
 * 가격정책 관리 '원가 매핑' 열 + 매핑 수정 모달 (policy-cost-link-column §2.1·§2.3) — Server Action·라우터는 모킹.
 * 칸 5상태·같은 품목 같은 값·버튼 유무(cost.write·후보 밖), 모달(초기 선택·확정 비활성·변경·해제 2단계·오류), 성공 후
 * refresh·aria-live·포커스 복귀, 칸 클릭이 드로어를 열지 않음.
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  detail: vi.fn(),
  load: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/admin/policies',
}));
vi.mock('@/features/pricing/actions', () => ({
  getPriceRowDetailAction: mocks.detail,
  getPriceHistoryAction: vi.fn(),
  createPricePolicyAction: vi.fn(),
  updatePricePolicyAction: vi.fn(),
  deletePricePolicyAction: vi.fn(),
  lookupItemAction: vi.fn(),
}));
vi.mock('@/features/costs/link-actions', () => ({
  loadCostLinkPickerAction: mocks.load,
  confirmCostLinksAction: mocks.confirm,
  deleteCostLinkAction: mocks.remove,
}));

const { PricingBrowser } = await import('@/features/pricing/PricingBrowser');

const base: PriceRowView = {
  id: 1,
  priceType: '정상판매',
  major: 'WAPPLES',
  mid: 'H/W Appliance',
  minor: 'Wapples',
  itemCode: 'P1',
  itemName: 'Wapples-1700',
  unitPrice: '1000.00',
  currency: 'KRW',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  itemStatus: '사용',
  operationStatus: '운영중',
  remark: null,
  source: 'erp',
  previousPrice: null,
  priceChangeRate: null,
};
const row = (id: number, itemCode: string, itemName: string): PriceRowView => ({
  ...base,
  id,
  itemCode,
  itemName,
});
const ROWS = [
  row(1, 'P1', 'Wapples-1700'),
  // 같은 품목의 다른 가격 행
  { ...row(2, 'P1', 'Wapples-1700'), priceType: '대리점' },
  row(3, 'P2', 'Wapples-2600'),
  row(4, 'P3', 'Wapples-4600'),
  row(5, 'P8', 'NIC 10G'),
  row(6, 'P9', 'NIC 1G'),
];
const LINKS: Record<string, CostLinkCellView> = {
  P1: {
    inScope: true,
    link: { materialCode: 'W1700', materialName: 'WAPPLES-1700 T2 본체', inCostTable: true },
  },
  P2: { inScope: true, link: { materialCode: 'WGONE', materialName: null, inCostTable: false } },
  P3: { inScope: true, link: null },
  P8: { inScope: false, link: null },
  P9: { inScope: false, link: { materialCode: 'W2600', materialName: 'X', inCostTable: true } },
};
const BROWSER = {
  mode: 'admin' as const,
  withPriceChange: true,
  filter: { dateMode: 'start' as const, page: 1 },
  userId: 'u1',
  rows: ROWS,
  costRatios: {},
  costLinks: LINKS,
};

const MATERIALS = [
  { materialCode: 'W1700', materialName: 'WAPPLES-1700 T2 본체' },
  { materialCode: 'W2600', materialName: 'WAPPLES-2600' },
];
const picker = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    item: {
      itemCode: 'P1',
      itemName: 'Wapples-1700',
      family: 'WAPPLES',
      categoryMinor: 'Wapples',
      itemStatus: '사용',
      inScope: true,
    },
    link: { materialCode: 'W1700', materialName: 'WAPPLES-1700 T2 본체', inCostTable: true },
    suggestion: { materialCode: 'W1700', materialName: 'WAPPLES-1700 T2 본체' },
    noSuggestion: null,
    materials: MATERIALS,
    impact: { priceRows: 7, normalPriceRows: 2 },
    ...over,
  },
});

const dialog = () => screen.getByRole('dialog', { name: '원가 매핑' });
const trigger = (name = 'Wapples-1700') =>
  screen.getAllByRole('button', { name: `${name} 원가 매핑 수정` })[0]!;
const IMPACT =
  "이 품목의 가격 행 7건에 같은 매핑이 적용되고, 원가 비중은 정상판매 2건에 반영됩니다(해당 시기 원가가 없으면 '—').";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(picker());
  mocks.confirm.mockResolvedValue({ ok: true, data: { saved: 1, unchanged: 0 } });
  mocks.remove.mockResolvedValue({ ok: true, data: { deleted: true } });
});

describe('원가 매핑 칸 (§2.1-4)', () => {
  it('5상태 표시: 매핑됨(W코드 + 자재명 말줄임·title) / 원가표에 없음(경고색) / 미매핑 / 후보 밖 "—"·title / 후보 밖 링크(경고 title)', () => {
    const states = Object.fromEntries(
      Object.entries(LINKS).map(([code, value]) => [code, costLinkState(value)]),
    );
    expect(states).toEqual({
      P1: 'linked',
      P2: 'missing-cost',
      P3: 'unlinked',
      P8: 'out-of-scope',
      P9: 'out-of-scope-linked',
    });
    const { container, rerender } = render(<CostLink value={LINKS.P1} />);
    expect(container).toHaveTextContent('W1700WAPPLES-1700 T2 본체');
    const name = screen.getByText('WAPPLES-1700 T2 본체');
    expect(name).toHaveAttribute('title', 'WAPPLES-1700 T2 본체');
    expect(name).toHaveClass('truncate');
    rerender(<CostLink value={LINKS.P2} />);
    // BL-2: 경고색은 amber-700(흰색~gray-200·강조 행에서 5.13:1 이상) — #a86a00(흰색 4.44:1) 아님
    expect(screen.getByText('WGONE (원가표에 없음)')).toHaveClass('text-amber-700');
    expect(screen.getByText('WGONE (원가표에 없음)').className).not.toMatch(/#a86a00/i);
    rerender(<CostLink value={LINKS.P3} />);
    expect(screen.getByText('미매핑')).toHaveClass('text-text-tertiary');
    rerender(<CostLink value={LINKS.P8} />);
    expect(container.querySelector('[title]')).toHaveAttribute('title', '원가 매핑 대상 아님');
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    rerender(<CostLink value={LINKS.P9} />);
    expect(container.querySelector('[title]')).toHaveAttribute(
      'title',
      '후보 밖 — 원가 비중에 쓰이지 않음',
    );
    expect(container).toHaveTextContent('W2600');
    expect(container.querySelector('[data-cost-link-state="out-of-scope-linked"]')).toHaveClass(
      'text-amber-700',
    );
    // 값 없음(계산 실패): 툴팁 없는 '—'
    rerender(<CostLink value={undefined} />);
    expect(container).toHaveTextContent('—');
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('cost.write: 후보 밖·링크 없음만 버튼 없음, 같은 품목의 모든 가격 행이 같은 값·같은 버튼(aria-haspopup·describedby)', () => {
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    const p1 = screen.getAllByRole('button', { name: 'Wapples-1700 원가 매핑 수정' });
    expect(p1).toHaveLength(2);
    for (const button of p1) {
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      expect(button).toHaveAccessibleDescription('W1700WAPPLES-1700 T2 본체');
    }
    for (const name of ['Wapples-2600', 'Wapples-4600', 'NIC 1G']) {
      expect(screen.getByRole('button', { name: `${name} 원가 매핑 수정` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'NIC 10G 원가 매핑 수정' })).toBeNull();
    expect(document.querySelector('[data-cost-link-state="out-of-scope"]')).not.toBeNull();
  });

  it('cost.write 없음: 칸은 텍스트만(버튼 없음)', () => {
    render(<PricingBrowser {...BROWSER} />);
    expect(screen.getByRole('columnheader', { name: /원가 매핑/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /원가 매핑 수정/ })).toEqual([]);
    expect(screen.getAllByText('W1700')).toHaveLength(2);
  });

  it('원가 열 없음(costRatios 없음 — cost.read 없음/조회 화면): 헤더·칸 없음', () => {
    const { unmount } = render(
      <PricingBrowser {...BROWSER} costRatios={undefined} costLinks={undefined} costLinkEditable />,
    );
    expect(screen.queryByRole('columnheader', { name: /원가 매핑/ })).toBeNull();
    unmount();
    render(<PricingBrowser {...BROWSER} mode="view" withPriceChange={false} costLinkEditable />);
    expect(screen.queryByRole('columnheader', { name: /원가 매핑/ })).toBeNull();
    expect(document.querySelector('[data-cost-link-state]')).toBeNull();
  });

  it('정렬·열 필터 없음: 서버 화이트리스트 밖(sort=costLink·f.costLink.* 무시), 헤더에 정렬 상태 없음', () => {
    expect(PRICE_SORT_IDS as readonly string[]).not.toContain('costLink');
    const { filter } = parsePriceFilter({ sort: 'costLink', dir: 'asc', 'f.costLink.in': 'W1' });
    expect(filter.sort).toBeUndefined();
    expect(filter.filters).toBeUndefined();
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    const header = screen.getByRole('columnheader', { name: /원가 매핑/ });
    expect(header).not.toHaveAttribute('aria-sort');
    expect(header.querySelector('svg')).toBeNull();
  });
});

describe('칸 클릭 → 매핑 수정 모달 (§2.1-6·§2.3)', () => {
  it('클릭·Enter → 모달만(드로어 아님), 품목코드로 1회 조회, 요약·현재 매핑·제안·영향 안내·링크, 금액 없음', async () => {
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger());
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith({ itemCode: 'P1' });
    const summary = await within(dialog()).findByLabelText('품목 요약');
    expect(
      within(summary)
        .getAllByRole('term')
        .map((dt) => dt.textContent),
    ).toEqual(['품명', '품번', '제품군', '소분류', '상태', '현재 매핑', '제안']);
    expect(within(summary).getAllByText('WAPPLES-1700 T2 본체 (W1700)')).toHaveLength(2);
    expect(within(dialog()).getByText(IMPACT)).toBeInTheDocument();
    expect(within(dialog()).getByRole('link', { name: '매핑 화면에서 보기' })).toHaveAttribute(
      'href',
      '/admin/costs/links',
    );
    expect(
      within(dialog()).getByRole('searchbox', { name: '자재명·자재번호 검색' }),
    ).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent(/원가 금액|단가|원$/);

    await userEvent.click(within(dialog()).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '원가 매핑' })).toBeNull());
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).toBeNull();
  });

  it('초기 선택 = 현재 매핑 → 확정 비활성(변경 없음). 다른 자재 선택 → 확정 → 같은 Action, 닫힘·refresh·aria-live·포커스 복귀', async () => {
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger());
    const select = await within(dialog()).findByRole('listbox', { name: /원가 자재/ });
    expect(select).toHaveValue('W1700');
    const confirm = within(dialog()).getByRole('button', { name: '확정' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(select, 'W2600');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mocks.confirm).toHaveBeenCalledWith({
      links: [{ itemCode: 'P1', materialCode: 'W2600' }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '원가 매핑' })).toBeNull());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    const live = document.querySelector('[data-cost-link-live]')!;
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('P1 원가 매핑 변경 — 가격 행 7건');
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('현재 매핑 없음 → 초기 선택 = 제안(확정 가능), 제안 없으면 사유 표시·선택 없음(확정 비활성)', async () => {
    mocks.load.mockResolvedValueOnce(picker({ link: null }));
    const { unmount } = render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger('Wapples-4600'));
    const select = await within(dialog()).findByRole('listbox', { name: /원가 자재/ });
    expect(select).toHaveValue('W1700');
    expect(within(dialog()).getByRole('button', { name: '확정' })).toBeEnabled();
    expect(within(dialog()).queryByRole('button', { name: '매핑 해제' })).toBeNull();
    unmount();

    mocks.load.mockResolvedValueOnce(
      picker({ link: null, suggestion: null, noSuggestion: 'sw-upgrade' }),
    );
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger('Wapples-4600'));
    expect(await within(dialog()).findByText('S/W 업그레이드 — 제안 없음')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: '확정' })).toBeDisabled();
  });

  it('매핑 해제: 2단계 확인(해제 문구 → 해제) → deleteCostLinkAction, 닫힘·refresh·안내', async () => {
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger());
    await userEvent.click(await within(dialog()).findByRole('button', { name: '매핑 해제' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/의 원가 매핑을 해제합니다/)).toBeInTheDocument();
    // 1단계 취소 → 다시 편집 화면
    await userEvent.click(within(dialog()).getByRole('button', { name: '취소' }));
    expect(within(dialog()).getByRole('button', { name: '확정' })).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: '매핑 해제' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: '해제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ itemCode: 'P1' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '원가 매핑' })).toBeNull());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-cost-link-live]')).toHaveTextContent(
      'P1 원가 매핑 변경 — 가격 행 7건',
    );
  });

  it('후보 밖·링크 있음: 해제 전용(검색·목록·확정 없음, 경고 안내)', async () => {
    mocks.load.mockResolvedValueOnce(
      picker({
        item: {
          itemCode: 'P9',
          itemName: 'NIC 1G',
          family: null,
          categoryMinor: 'NIC',
          itemStatus: '사용',
          inScope: false,
        },
        link: { materialCode: 'W2600', materialName: 'WAPPLES-2600', inCostTable: true },
        suggestion: null,
      }),
    );
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger('NIC 1G'));
    expect(
      await within(dialog()).findByText('후보 밖 — 원가 비중에 쓰이지 않음'),
    ).toBeInTheDocument();
    // BL-2: 모달(흰 배경) 경고 안내 amber-700 5.78:1 — #a86a00 은 4.44:1
    expect(within(dialog()).getByText('후보 밖 — 원가 비중에 쓰이지 않음')).toHaveClass(
      'text-amber-700',
    );
    expect(within(dialog()).queryByRole('listbox')).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: '확정' })).toBeNull();
    expect(within(dialog()).getByRole('button', { name: '매핑 해제' })).toBeInTheDocument();
  });

  it('서버 오류(후보 밖·원가표에 없는 자재 등): 모달 안 role=alert, 모달 유지·refresh 없음', async () => {
    mocks.confirm.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION', message: '원가표에 없는 자재번호입니다: W2600' },
    });
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger());
    await userEvent.selectOptions(
      await within(dialog()).findByRole('listbox', { name: /원가 자재/ }),
      'W2600',
    );
    await userEvent.click(within(dialog()).getByRole('button', { name: '확정' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      '원가표에 없는 자재번호입니다: W2600',
    );
    expect(dialog()).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('조회 실패: 오류 + 다시 시도(재요청)', async () => {
    mocks.load.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    await userEvent.click(trigger());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      '이 작업을 수행할 권한이 없습니다',
    );
    await userEvent.click(within(dialog()).getByRole('button', { name: '다시 시도' }));
    expect(await within(dialog()).findByLabelText('품목 요약')).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('열 리사이즈 드래그가 칸 위에서 끝난 직후의 click 은 모달·드로어를 열지 않는다', async () => {
    render(<PricingBrowser {...BROWSER} costLinkEditable />);
    const handle = screen.getByRole('separator', { name: '원가 매핑 열 너비 조절' });
    const button = trigger();
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(document, { clientX: 160 });
    fireEvent.pointerUp(button, { clientX: 160 });
    fireEvent.click(button);
    expect(screen.queryByRole('dialog', { name: '원가 매핑' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await userEvent.click(button);
    expect(dialog()).toBeInTheDocument();
  });
});
