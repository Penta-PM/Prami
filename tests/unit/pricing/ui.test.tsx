import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PriceRowView } from '@/features/pricing/types';

/** 가격정책 화면 컴포넌트 (디자인 조회·관리 표) — Server Action·라우터는 모킹 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/pricing',
}));
vi.mock('@/features/pricing/actions', () => ({
  getPriceRowDetailAction: mocks.detail,
  createPricePolicyAction: mocks.create,
  updatePricePolicyAction: mocks.update,
  deletePricePolicyAction: mocks.remove,
  lookupItemAction: mocks.lookup,
}));

const { PriceTable } = await import('@/features/pricing/PriceTable');
const { PricingFilters } = await import('@/features/pricing/PricingFilters');
const { PricingBrowser } = await import('@/features/pricing/PricingBrowser');
const { PolicyFormModal } = await import('@/features/pricing/PolicyFormModal');
const { EMPTY_POLICY_FORM } = await import('@/features/pricing/policy-form');

const ROW: PriceRowView = {
  id: 7,
  priceType: '정상판매',
  major: 'WAPPLES',
  mid: 'Appliance',
  minor: 'H500',
  itemCode: 'P10100015',
  itemName: 'Wapples-500 (H500 T2)',
  unitPrice: '12500000.00',
  currency: 'KRW',
  effectiveFrom: '2022-04-01',
  effectiveTo: '2026-01-01',
  itemStatus: '폐기',
  operationStatus: '미사용',
  remark: '26.05.01 가격정책',
  source: 'erp',
};

const DETAIL_ROW = {
  ...ROW,
  sourceId: 2,
  productFamily: 'WAPPLES',
  spec: null,
  unit: 'EA',
  priceCategory: '일반',
  hasCorePrice: false,
  appliesToAllCustomers: false,
  isFinalSource: false,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
  customerCode: '0',
  customerNo: null,
  customerName: null,
  seriesKey: 'P10100015|정상판매|일반|KRW|0',
  batchFileName: '병합_가격_raw.xlsx',
};

const DETAIL = {
  row: DETAIL_ROW,
  history: [
    {
      id: 8,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      unitPrice: '13000000.00',
      currency: 'KRW',
      operationStatus: '미사용',
      source: 'erp',
    },
    {
      id: 7,
      effectiveFrom: '2022-04-01',
      effectiveTo: '2026-01-01',
      unitPrice: '12500000.00',
      currency: 'KRW',
      operationStatus: '미사용',
      source: 'erp',
    },
  ],
};

const headers = () =>
  screen
    .getByRole('table')
    .querySelectorAll('thead th')
    .values()
    .map((th) => th.textContent)
    .toArray();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockResolvedValue({ ok: true, data: DETAIL });
});

describe('PriceTable (AC-12~14, AC-22)', () => {
  it('조회 표: 적용기간만, 판매가 포맷, 품목상태 색상 필, 운영상태 텍스트', () => {
    render(<PriceTable mode="view" rows={[ROW]} onRowClick={vi.fn()} />);
    expect(headers()).toEqual([
      '단가 유형',
      '대분류',
      '중분류',
      '소분류',
      '품목명',
      '판매가',
      '적용기간',
      '품목상태',
      '상태',
      '비고',
    ]);
    expect(screen.getByText('12,500,000원')).toBeInTheDocument();
    expect(screen.getByText('2022-04-01 ~ 2025-12-31')).toBeInTheDocument();
    expect(screen.getByText('폐기')).toHaveAttribute('data-item-status', '폐기');
    expect(screen.getByText('미사용')).toBeInTheDocument();
  });

  it('관리 표: 적용시작일·운영 연도·관리 컬럼, 행 클릭(관리 칸 제외)', async () => {
    const onRowClick = vi.fn();
    render(
      <PriceTable
        mode="admin"
        rows={[{ ...ROW, itemStatus: '미확인', priceType: null }]}
        onRowClick={onRowClick}
        renderActions={() => <button type="button">수정</button>}
      />,
    );
    expect(headers()).toContain('운영 연도');
    expect(screen.getByText('2022 ~ 2025')).toBeInTheDocument();
    expect(screen.getByText('—', { selector: 'td' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '수정' }));
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Wapples-500 (H500 T2)'));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('빈 결과 안내', () => {
    render(<PriceTable mode="view" rows={[]} onRowClick={vi.fn()} />);
    expect(screen.getByText('검색 결과가 없습니다.')).toBeInTheDocument();
  });
});

describe('PricingFilters (AC-10·11, R-01·R-13)', () => {
  const baseProps = {
    filter: { dateMode: 'start' as const, page: 3, major: 'WAPPLES', mid: 'Appliance' },
    errors: {},
    options: {
      majors: ['D.AMO', 'WAPPLES'],
      mids: ['Appliance', 'Parts'],
      minors: ['H500'],
      hasMaster: true,
    },
    years: [2026, 2025, 2024],
    searchPlaceholder: '모델명으로 검색',
  };

  it('대분류 변경 → 중·소분류 초기화 + 1페이지, URL 로 반영', async () => {
    render(<PricingFilters {...baseProps} />);
    await userEvent.selectOptions(screen.getByLabelText('대분류'), 'D.AMO');
    expect(mocks.push).toHaveBeenLastCalledWith('/pricing?major=D.AMO');
    await userEvent.selectOptions(screen.getByLabelText('소분류'), 'H500');
    expect(mocks.push).toHaveBeenLastCalledWith('/pricing?major=WAPPLES&mid=Appliance&minor=H500');
  });

  it('날짜 기준 전환·연도 칩·전체 칩·검색', async () => {
    render(
      <PricingFilters
        {...baseProps}
        filter={{ ...baseProps.filter, from: '2025-01-01', to: '2025-12-31' }}
      />,
    );
    expect(screen.getByRole('button', { name: '2025' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('radio', { name: '적용기간 기준' }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/pricing?major=WAPPLES&mid=Appliance&dateMode=period&from=2025-01-01&to=2025-12-31',
    );
    await userEvent.click(screen.getByRole('button', { name: '2024' }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/pricing?major=WAPPLES&mid=Appliance&from=2024-01-01&to=2024-12-31',
    );
    await userEvent.click(screen.getByRole('button', { name: '전체' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/pricing?major=WAPPLES&mid=Appliance');
    await userEvent.type(
      screen.getByRole('searchbox', { name: '품목명·품번 검색' }),
      'H500{Enter}',
    );
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/pricing?major=WAPPLES&mid=Appliance&from=2025-01-01&to=2025-12-31&q=H500',
    );
  });

  it('품목 마스터 미적용: 중/소분류 비활성 + 안내, 날짜 오류 표시', () => {
    render(
      <PricingFilters
        {...baseProps}
        filter={{ dateMode: 'start', page: 1 }}
        errors={{ to: '종료일은 시작일 이후여야 합니다' }}
        options={{ majors: ['WAPPLES'], mids: [], minors: [], hasMaster: false }}
      />,
    );
    expect(screen.getByLabelText('중분류')).toBeDisabled();
    expect(
      screen.getByText('품목조회 파일이 적용되면 중/소분류 필터가 활성화됩니다'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('종료일은 시작일 이후여야 합니다');
  });
});

describe('PricingBrowser — 드로어·관리 동작 (AC-15·16)', () => {
  it('행 클릭 → 행 상세 드로어: 원본 20컬럼 + 계열 이력', async () => {
    render(<PricingBrowser mode="view" rows={[ROW]} />);
    await userEvent.click(screen.getByText('Wapples-500 (H500 T2)'));
    const drawer = await screen.findByRole('dialog', { name: '행 상세' });
    const source = await within(drawer).findByRole('region', { name: '원본 20컬럼' });
    expect(within(source).getAllByRole('term')).toHaveLength(20);
    expect(within(source).getByText('최종여부(원본)')).toBeInTheDocument();
    expect(within(drawer).getByText('ERP 임포트', { exact: false })).toHaveTextContent(
      '병합_가격_raw.xlsx',
    );
    expect(
      within(drawer).getByRole('region', { name: '계열 이력' }).querySelectorAll('li'),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '+ 등록' })).not.toBeInTheDocument();
  });

  it('관리: + 등록 → "가격정책 등록" 모달, 사유 없이 저장하면 필드 오류', async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: '입력값을 확인하세요',
        fieldErrors: { reason: ['변경 사유를 입력하세요'] },
      },
    });
    render(<PricingBrowser mode="admin" rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: '+ 등록' }));
    const dialog = screen.getByRole('dialog', { name: '가격정책 등록' });
    await userEvent.click(within(dialog.closest('dialog')!).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('입력값을 확인하세요');
    expect(within(dialog).getByText('변경 사유를 입력하세요')).toBeInTheDocument();
  });

  it('관리: 수정 → 원본 값 채움·ERP 경고·폐기 안내, 저장 성공 → 안내·새로고침', async () => {
    mocks.update.mockResolvedValue({
      ok: true,
      data: { id: 7, operationStatus: '미사용', discarded: true },
    });
    render(<PricingBrowser mode="admin" rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: `${ROW.itemName} 수정` }));
    const dialog = await screen.findByRole('dialog', { name: '가격정책 수정' });
    expect(within(dialog).getByRole('note')).toHaveTextContent('폐기 품목입니다');
    expect(within(dialog).getByText(/ERP 임포트 행을 수정하면/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('변경 사유 * (감사 로그에 기록됩니다)'),
      '가격 인상',
    );
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, unitPrice: '12500000', reason: '가격 인상' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('폐기 품목이라 상태는 미사용');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('관리: 복사 → 적용시작일 비운 등록 모달 / 삭제 → 사유 필수 후 삭제', async () => {
    mocks.remove
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'x',
          fieldErrors: { reason: ['변경 사유를 입력하세요'] },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { id: 7 } });
    render(<PricingBrowser mode="admin" rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: `${ROW.itemName} 복사` }));
    const copy = await screen.findByRole('dialog', { name: '가격정책 등록' });
    expect(within(copy).getByLabelText('적용시작일 *')).toHaveValue('');
    expect(within(copy).getByLabelText('품번 *')).toHaveValue('P10100015');
    await userEvent.click(within(copy).getByRole('button', { name: '닫기' }));

    await userEvent.click(screen.getByRole('button', { name: `${ROW.itemName} 삭제` }));
    const del = screen.getByRole('dialog', { name: '가격정책 삭제' });
    await userEvent.click(within(del).getByRole('button', { name: '삭제' }));
    expect(await within(del).findByRole('alert')).toHaveTextContent('변경 사유');
    await userEvent.type(
      within(del).getByLabelText('변경 사유 * (감사 로그에 기록됩니다)'),
      '중복 행',
    );
    await userEvent.click(within(del).getByRole('button', { name: '삭제' }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenLastCalledWith({ id: 7, reason: '중복 행' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했습니다');
  });

  it('상세 조회 실패는 알림', async () => {
    mocks.detail.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: '가격정책을 찾을 수 없습니다' },
    });
    render(<PricingBrowser mode="admin" rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: `${ROW.itemName} 수정` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('가격정책을 찾을 수 없습니다');
  });
});

describe('PolicyFormModal — 품번 조회·폐기 안내 (AC-23)', () => {
  it('품번 입력 후 포커스 이동 → 품명·제품군 채움, 폐기면 안내, 등록 성공 메시지', async () => {
    mocks.lookup.mockResolvedValue({
      ok: true,
      data: {
        itemCode: 'N_51244',
        itemName: '폐기 파츠',
        productFamily: 'WAPPLES',
        unit: 'EA',
        itemStatus: '폐기',
      },
    });
    mocks.create.mockResolvedValue({
      ok: true,
      data: { id: 1, operationStatus: '운영중', discarded: false },
    });
    const onSaved = vi.fn();
    render(
      <PolicyFormModal
        mode={{ kind: 'create' }}
        initial={{ ...EMPTY_POLICY_FORM, unit: '' }}
        initialItemStatus={null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await userEvent.type(screen.getByLabelText('품번 *'), 'N_51244');
    await userEvent.tab();
    expect(await screen.findByRole('note')).toHaveTextContent('운영중 상태를 가질 수 없어');
    expect(screen.getByLabelText('품명 *')).toHaveValue('폐기 파츠');
    expect(screen.getByLabelText('제품군 *')).toHaveValue('WAPPLES');
    await userEvent.click(screen.getByLabelText('코어단가유무'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('등록했습니다. 상태: 운영중'));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ hasCorePrice: true, itemCode: 'N_51244' }),
    );
  });
});
