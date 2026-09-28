import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatchOption } from '@/features/admin-policies/types';
import type { CostRowView } from '@/features/costs/types';

/** 원가 관리 화면 컴포넌트 (디자인 원가 관리 표, §4.5.5, 요구 14) — Server Action·라우터는 모킹 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  apply: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/admin/costs',
}));
vi.mock('@/features/costs/actions', () => ({
  applyCostImportAction: mocks.apply,
  updateMaterialCostAction: mocks.update,
  deleteMaterialCostAction: mocks.remove,
}));

const { CostFilters } = await import('@/features/costs/CostFilters');
const { CostBrowser, COST_COLUMNS } = await import('@/features/costs/CostBrowser');
const { CostImportPanel } = await import('@/features/costs/CostImportPanel');
const { CostPagination } = await import('@/features/costs/CostPagination');

const ROW: CostRowView = {
  id: 3,
  materialCode: 'W10100016',
  materialName: 'WAPPLES-100 (H100 T2)',
  unit: 'EA',
  unitCost: '984000.00',
  currency: 'KRW',
  effectiveFrom: '2024-01-01',
  effectiveTo: '2025-01-01',
  operationStatus: '미사용',
  productFamily: 'WAPPLES',
  remark: null,
  source: 'erp',
};
const FAMILIES = [
  { family: 'WAPPLES', count: 294 },
  { family: 'D.AMO', count: 80 },
  { family: 'iSIGN', count: 108 },
  { family: '기타', count: 5 },
];
const BATCH: BatchOption = {
  id: '11111111-1111-4111-8111-111111111111',
  fileName: '원자재코드 정보_260825.xlsx',
  status: 'applied',
  rowCount: 487,
  createdAt: '2026-09-28T01:00:00.000Z',
};
const STATS = {
  inserted: 487,
  materialCount: 157,
  seriesCount: 157,
  latestCount: 157,
  manualPreserved: 0,
  manualConflicts: 0,
  otherFamilyRows: 5,
  duplicateDateGroups: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CostFilters', () => {
  it('제품군 탭(전체 + Q-03 파생 4개, 건수) → URL, 라인업 칩 없음', () => {
    render(
      <CostFilters
        filter={{ dateMode: 'start', page: 3, family: 'D.AMO' }}
        errors={{}}
        families={FAMILIES}
        years={[2026, 2025]}
      />,
    );
    const tabs = within(screen.getByRole('navigation', { name: '제품군' })).getAllByRole('link');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '전체487',
      'WAPPLES294',
      'D.AMO80',
      'iSIGN108',
      '기타5',
    ]);
    expect(tabs[2]).toHaveAttribute('aria-current', 'page');
    expect(tabs[1]).toHaveAttribute('href', '/admin/costs?family=WAPPLES');
    expect(tabs[0]).toHaveAttribute('href', '/admin/costs');
    expect(screen.queryByText(/라인업/)).not.toBeInTheDocument();
  });

  it('날짜 두 기준·연도 칩·검색이 URL 로 간다 (요구 14, 페이지 1로 초기화)', async () => {
    render(
      <CostFilters
        filter={{ dateMode: 'start', page: 2, q: 'H100' }}
        errors={{}}
        families={FAMILIES}
        years={[2026, 2025]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '적용기간 기준' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/costs?dateMode=period&q=H100');
    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/costs?from=2025-01-01&to=2025-12-31&q=H100',
    );

    const search = screen.getByRole('searchbox', { name: '원자재명·코드 검색' });
    expect(search).toHaveValue('H100');
    await userEvent.clear(search);
    await userEvent.type(search, 'W40{Enter}');
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/costs?q=W40');
  });
});

describe('CostBrowser', () => {
  it('디자인 헤더 8개, 원가·기간·상태 라벨, 빈 결과 문구', () => {
    const { rerender } = render(<CostBrowser rows={[ROW, { ...ROW, id: 4, source: 'manual' }]} />);
    const table = screen.getByRole('table', { name: '원가 표' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(COST_COLUMNS.map((column) => column.label));
    expect(COST_COLUMNS.map((column) => column.label)).toEqual([
      '원자재 코드',
      '원자재명',
      '분류',
      '원가',
      '적용시작일',
      '적용기간',
      '상태',
      '관리',
    ]);
    const [first] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('984,000원');
    expect(first).toHaveTextContent('2024-01-01 ~ 2024-12-31');
    expect(first).toHaveTextContent('미사용');
    expect(within(table).getAllByText('수동')).toHaveLength(1);
    rerender(<CostBrowser rows={[]} />);
    expect(screen.getByText('검색 결과가 없습니다.')).toBeInTheDocument();
  });

  it('수정 모달: 사유 필드 오류 표시 → 성공 시 status + refresh', async () => {
    mocks.update
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: '입력값을 확인하세요',
          fieldErrors: { reason: ['변경 사유를 입력하세요'] },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { id: 3, operationStatus: '운영중' } });
    render(<CostBrowser rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES-100 (H100 T2) 수정' }));
    const dialog = screen.getByRole('dialog', { name: '원가 수정' });
    expect(within(dialog).getByText(/ERP 임포트 행을 수정하면/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('원가 (KRW) *')).toHaveValue('984000');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByText('변경 사유를 입력하세요')).toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledWith({
      id: 3,
      unitCost: '984000',
      effectiveFrom: '2024-01-01',
      remark: '',
      reason: '',
    });

    await userEvent.type(within(dialog).getByLabelText(/^변경 사유 */), '계약 반영');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent('수정했습니다. 상태: 운영중');
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('삭제 모달: 사유 오류 → alert, 성공 시 status', async () => {
    mocks.remove
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: '입력값',
          fieldErrors: { reason: ['변경 사유를 입력하세요'] },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { id: 3 } });
    render(<CostBrowser rows={[ROW]} />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES-100 (H100 T2) 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '원가 삭제' });
    expect(dialog).toHaveTextContent('984,000원');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('변경 사유를 입력하세요');
    await userEvent.type(within(dialog).getByLabelText(/^변경 사유 */), '정리');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했습니다');
    expect(mocks.remove).toHaveBeenLastCalledWith({ id: 3, reason: '정리' });
  });
});

describe('CostImportPanel', () => {
  it('현재 적용 배치가 있으면 재사용 기본, 적용 → 통계(같은 날짜 중복 포함) + refresh', async () => {
    mocks.apply.mockResolvedValue({ ok: true, data: STATS });
    render(<CostImportPanel options={[BATCH]} currentBatchId={BATCH.id} />);
    expect(screen.getByLabelText('원가 파일 기존 배치')).toHaveValue(BATCH.id);
    await userEvent.click(screen.getByRole('button', { name: '원가 적용' }));
    expect(mocks.apply).toHaveBeenCalledWith({ batchId: BATCH.id, reused: true });
    const status = await screen.findByRole('status', { name: '원가 적용 완료' });
    expect(within(status).getByText('487')).toBeInTheDocument();
    expect(within(status).getByText('같은 날짜 중복').nextElementSibling).toHaveTextContent('3');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('적용 이력이 없으면 신규 업로드 모드이고 업로드 전에는 적용 불가, 실패는 alert', async () => {
    mocks.apply.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: '원가 적용에 실패했습니다' },
    });
    render(<CostImportPanel options={[]} currentBatchId={null} />);
    expect(screen.getByRole('button', { name: '원가 적용' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '구매단가 엑셀 업로드' })).toBeInTheDocument();
    expect(
      screen.getByText('오류 없는 원가 파일을 선택하면 적용할 수 있습니다'),
    ).toBeInTheDocument();
  });
});

describe('CostPagination', () => {
  it('총건수·페이지와 이전/다음 링크(필터 유지)', () => {
    render(
      <CostPagination
        filter={{ dateMode: 'period', family: 'iSIGN', page: 2 }}
        page={2}
        pageCount={3}
        total={108}
      />,
    );
    expect(screen.getByText('총 108건 · 2 / 3 페이지')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      '/admin/costs?family=iSIGN&dateMode=period',
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      '/admin/costs?family=iSIGN&dateMode=period&page=3',
    );
  });
});
