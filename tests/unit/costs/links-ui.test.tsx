import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostLinkCandidate, CostLinkView } from '@/server/cost/item-link-types';

/** 원가 매핑 관리 화면 (스펙 cost-ratio-price-change §2.1) — Server Action·라우터는 모킹 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
  usePathname: () => '/admin/costs/links',
}));
vi.mock('@/features/costs/link-actions', () => ({
  confirmCostLinksAction: mocks.confirm,
  deleteCostLinkAction: mocks.remove,
}));

const { CostLinkManager } = await import('@/features/costs/CostLinkManager');

const UPDATED = '2026-10-01T03:00:00.000Z';

function candidate(
  overrides: Partial<CostLinkCandidate> & Pick<CostLinkCandidate, 'itemCode' | 'itemName'>,
): CostLinkCandidate {
  return {
    family: 'WAPPLES',
    categoryMinor: '본체',
    itemStatus: '사용',
    hasNormalPrice: true,
    link: null,
    suggestion: null,
    noSuggestion: null,
    ...overrides,
  };
}

const W100 = { materialCode: 'W100', materialName: 'WAPPLES-100 본체' };
const W200 = { materialCode: 'W200', materialName: 'iSIGN+ 200' };
const W300 = { materialCode: 'W300', materialName: 'D.AMO KMS 서버' };

const VIEW: CostLinkView = {
  candidates: [
    candidate({ itemCode: 'P001', itemName: 'WAPPLES-100', suggestion: W100 }),
    candidate({
      itemCode: 'P002',
      itemName: 'WAPPLES-100 포트 확장',
      categoryMinor: '포트',
      suggestion: W100,
      link: { ...W100, updatedAt: UPDATED },
    }),
    candidate({
      itemCode: 'P003',
      itemName: 'D.AMO KMS S/W 업그레이드',
      family: 'D.AMO KMS',
      hasNormalPrice: false,
      noSuggestion: 'sw-upgrade',
    }),
    candidate({
      itemCode: 'P004',
      itemName: 'iSIGN+ 200',
      family: 'iSIGN',
      suggestion: W200,
      link: { materialCode: 'W999', materialName: null, updatedAt: UPDATED },
    }),
    candidate({
      itemCode: 'P005',
      itemName: 'iSIGN 기타',
      family: 'iSIGN',
      noSuggestion: 'no-model',
    }),
    candidate({ itemCode: 'P006', itemName: 'WAPPLES-9000', noSuggestion: 'no-cost' }),
  ],
  orphans: [
    { itemCode: 'P900', materialCode: 'W300', materialName: 'D.AMO KMS 서버', updatedAt: UPDATED },
  ],
  outOfScope: [],
  materials: [W300, W200, W100],
};

const table = () => screen.getByRole('table', { name: '원가 매핑 후보' });
const rowOf = (name: string) => {
  const cell = within(table()).getByText(name, { selector: 'td' });
  return cell.closest('tr') as HTMLElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.confirm.mockResolvedValue({ ok: true, data: { saved: 1, unchanged: 0 } });
  mocks.remove.mockResolvedValue({ ok: true, data: { deleted: true } });
});

describe('CostLinkManager 표시', () => {
  it('행·확정 원가·제안·제안 없음 사유·요약을 그린다', () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);

    expect(within(table()).getAllByRole('row')).toHaveLength(1 + VIEW.candidates.length);
    expect(screen.getByText('후보 6 · 확정 2 · 제안 3')).toBeInTheDocument();

    expect(within(rowOf('P001')).getByText('WAPPLES-100 본체 (W100)')).toBeInTheDocument();
    expect(within(rowOf('P001')).getByText('미확정')).toBeInTheDocument();
    expect(within(rowOf('P004')).getByText('W999 (원가표에 없음)')).toBeInTheDocument();
    expect(within(rowOf('P003')).getByText('S/W 업그레이드 — 제안 없음')).toBeInTheDocument();
    expect(within(rowOf('P003')).getByText('없음')).toBeInTheDocument();
    expect(within(rowOf('P005')).getByText('모델을 읽을 수 없음')).toBeInTheDocument();
    expect(within(rowOf('P006')).getByText('같은 모델 원가 없음')).toBeInTheDocument();
  });

  it('선택 체크박스·제안대로 확정은 제안이 있고 확정과 다른 행에만 있다', () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);

    expect(screen.getByRole('checkbox', { name: 'WAPPLES-100 선택' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'iSIGN+ 200 선택' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'WAPPLES-100 포트 확장 선택' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'D.AMO KMS S/W 업그레이드 선택' })).toBeNull();

    expect(within(rowOf('P002')).queryByRole('button', { name: /제안대로 확정/ })).toBeNull();
    expect(
      within(rowOf('P002')).getByRole('button', { name: 'WAPPLES-100 포트 확장 해제' }),
    ).toBeInTheDocument();
    expect(within(rowOf('P003')).queryByRole('button', { name: /해제/ })).toBeNull();
    expect(
      within(rowOf('P003')).getByRole('button', { name: 'D.AMO KMS S/W 업그레이드 직접 선택' }),
    ).toBeInTheDocument();
  });

  it('cost.write 가 없으면 읽기 전용 — 체크박스·동작 버튼이 없다', () => {
    render(<CostLinkManager view={VIEW} canWrite={false} userId="u1" />);

    expect(within(table()).queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /제안대로 확정|직접 선택|해제$/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '동작' })).toBeNull();
    // 품목 없음 구역은 보이되 해제 버튼은 없다
    expect(
      screen.getByRole('heading', { name: '품목 없음 (가격 품목이 사라진 매핑)' }),
    ).toBeInTheDocument();
  });

  it('품목 없음 구역: 고아 매핑을 나열하고, 없으면 구역을 숨긴다', async () => {
    const { unmount } = render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    const section = screen.getByRole('region', { name: '품목 없음 (가격 품목이 사라진 매핑)' });
    expect(within(section).getByText('P900')).toBeInTheDocument();
    expect(within(section).getByText('D.AMO KMS 서버 (W300)')).toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: 'P900 해제' }));
    const dialog = screen.getByRole('dialog', { name: '매핑 해제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '해제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ itemCode: 'P900' });
    unmount();

    render(<CostLinkManager view={{ ...VIEW, orphans: [] }} canWrite userId="u1" />);
    expect(screen.queryByRole('heading', { name: /품목 없음/ })).toBeNull();
  });

  it('후보 밖 링크 구역(Plan Q1 A): 품목코드·품목명과 자재를 나열하고 해제만 가능, 없으면 숨김', async () => {
    const view = {
      ...VIEW,
      outOfScope: [
        {
          itemCode: 'P800',
          itemName: 'NIC 10G 파츠',
          materialCode: 'W100',
          materialName: 'WAPPLES-1700 T1',
          updatedAt: UPDATED,
        },
      ],
    };
    const { unmount } = render(<CostLinkManager view={view} canWrite userId="u1" />);
    const section = screen.getByRole('region', { name: '후보 밖 링크 (원가 비중에 쓰이지 않음)' });
    expect(within(section).getByText('P800 NIC 10G 파츠')).toBeInTheDocument();
    expect(within(section).getByText(/원가 비중 계산에 쓰이지 않으며/)).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'P800 해제' }));
    const dialog = screen.getByRole('dialog', { name: '매핑 해제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '해제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ itemCode: 'P800' });
    unmount();

    render(<CostLinkManager view={view} canWrite={false} userId="u1" />);
    expect(
      within(
        screen.getByRole('region', { name: '후보 밖 링크 (원가 비중에 쓰이지 않음)' }),
      ).queryByRole('button'),
    ).toBeNull();
  });

  it('같은 모델 원가가 여럿이면 모호함 사유', () => {
    render(
      <CostLinkManager
        view={{
          ...VIEW,
          candidates: [
            candidate({ itemCode: 'P777', itemName: 'WAPPLES-700', noSuggestion: 'ambiguous' }),
          ],
        }}
        canWrite
        userId="u1"
      />,
    );
    expect(
      within(rowOf('WAPPLES-700')).getByText('같은 모델 원가가 여럿 — 직접 선택'),
    ).toBeInTheDocument();
  });

  it('원가 금액처럼 보이는 텍스트가 없다', () => {
    const { container } = render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/₩|KRW|\d{1,3}(,\d{3})+|\d+\s*원(?!가)/);
  });
});

describe('CostLinkManager 필터', () => {
  it('제품군 필터는 해당 제품군 행만 남긴다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('radio', { name: 'iSIGN' }));

    const codes = within(table())
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getByText(/^P\d+$/).textContent);
    expect(codes).toEqual(['P004', 'P005']);
  });

  it('미확정만은 확정 매핑이 있는 행을 숨긴다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('checkbox', { name: '미확정만' }));

    expect(within(table()).queryByText('P002')).toBeNull();
    expect(within(table()).queryByText('P004')).toBeNull();
    expect(within(table()).getByText('P001')).toBeInTheDocument();
    expect(within(table()).getAllByRole('row')).toHaveLength(1 + 4);
  });

  it('검색은 품목코드·품목명으로 거른다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.type(screen.getByRole('searchbox', { name: '품목코드·품목명 검색' }), '9000');
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    expect(within(table()).getByText('P006')).toBeInTheDocument();
  });
});

describe('CostLinkManager 동작', () => {
  it('제안대로 확정 → 제안 쌍으로 Action 호출, 결과 건수 안내 + refresh', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES-100 제안대로 확정' }));

    expect(mocks.confirm).toHaveBeenCalledWith({
      links: [{ itemCode: 'P001', materialCode: 'W100' }],
    });
    expect(await screen.findByText('1건 확정')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1건 확정');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('실패하면 error.message 를 alert 로 보이고 refresh 하지 않는다', async () => {
    mocks.confirm.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FORBIDDEN', message: '권한이 없습니다' },
    });
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES-100 제안대로 확정' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없습니다');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('일괄: 선택한 행들의 제안 쌍을 한 번에 보낸다', async () => {
    mocks.confirm.mockResolvedValueOnce({ ok: true, data: { saved: 2, unchanged: 0 } });
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);

    const bulk = screen.getByRole('button', { name: '선택 0건 제안대로 확정' });
    expect(bulk).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'WAPPLES-100 선택' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'iSIGN+ 200 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택 2건 제안대로 확정' }));

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith({
      links: [
        { itemCode: 'P001', materialCode: 'W100' },
        { itemCode: 'P004', materialCode: 'W200' },
      ],
    });
    expect(await screen.findByText('2건 확정')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '선택 0건 제안대로 확정' })).toBeInTheDocument();
  });

  it('헤더 체크박스는 보이는 선택 가능 행만 고른다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('radio', { name: 'WAPPLES' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '보이는 제안 전체 선택' }));
    expect(screen.getByRole('button', { name: '선택 1건 제안대로 확정' })).toBeEnabled();
  });

  it('500건을 넘으면 500건씩 나눠 보낸다', async () => {
    const many = Array.from({ length: 501 }, (_, i) =>
      candidate({ itemCode: `P${1000 + i}`, itemName: `WAPPLES-${1000 + i}`, suggestion: W100 }),
    );
    mocks.confirm.mockImplementation(async (input: { links: unknown[] }) => ({
      ok: true,
      data: { saved: input.links.length, unchanged: 0 },
    }));
    render(<CostLinkManager view={{ ...VIEW, candidates: many }} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('checkbox', { name: '보이는 제안 전체 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택 501건 제안대로 확정' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[0]![0].links).toHaveLength(500);
    expect(mocks.confirm.mock.calls[1]![0].links).toHaveLength(1);
    expect(await screen.findByText('501건 확정')).toBeInTheDocument();
  });

  it('직접 선택: 모달에서 검색·선택한 자재로 확정한다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'D.AMO KMS S/W 업그레이드 직접 선택' }),
    );

    const dialog = screen.getByRole('dialog', { name: '원가 직접 선택' });
    const confirmButton = within(dialog).getByRole('button', { name: '확정' });
    expect(confirmButton).toBeDisabled(); // 제안·확정이 없으면 미선택

    await userEvent.type(
      within(dialog).getByRole('searchbox', { name: '자재명·자재번호 검색' }),
      'KMS',
    );
    const list = within(dialog).getByRole('listbox', { name: /원가 자재/ });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await userEvent.selectOptions(list, 'W300');
    await userEvent.click(confirmButton);

    expect(mocks.confirm).toHaveBeenCalledWith({
      links: [{ itemCode: 'P003', materialCode: 'W300' }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('1건 확정')).toBeInTheDocument();
  });

  it('해제: 확인 모달을 거쳐 delete Action 을 부른다', async () => {
    render(<CostLinkManager view={VIEW} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'iSIGN+ 200 해제' }));

    const dialog = screen.getByRole('dialog', { name: '매핑 해제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '해제' }));

    expect(mocks.remove).toHaveBeenCalledWith({ itemCode: 'P004' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('1건 해제')).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
