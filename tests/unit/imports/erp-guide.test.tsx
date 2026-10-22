import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import type { BatchOption } from '@/features/admin-policies/types';
import * as guide from '@/lib/constants/erp-guide';

/**
 * ERP 업로드 안내 (erp-upload-guide §2·§6): 문구 상수 = 사용자 원문, 두 업로드 패널 맨 위 "PRAMI ERP 데이터" 버튼 → 공통 설명
 * 팝오버(두 줄), 판매단가·품목상태·원가 칸 ⓘ(신규·재사용 두 모드), 업로드 버튼 aria-describedby(sr-only 경로).
 */
const mocks = vi.hoisted(() => ({
  applyPolicyAction: vi.fn(),
  previewItemMergeAction: vi.fn(),
  applyCostImportAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/features/admin-policies/actions', () => ({
  applyPolicyAction: mocks.applyPolicyAction,
  previewItemMergeAction: mocks.previewItemMergeAction,
}));
vi.mock('@/features/costs/actions', () => ({
  applyCostImportAction: mocks.applyCostImportAction,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const { ImportPanel } = await import('@/features/admin-policies/ImportPanel');
const { CostImportPanel } = await import('@/features/costs/CostImportPanel');

const withMotion = { wrapper: MotionProvider };

const BATCH: BatchOption = {
  id: '11111111-1111-4111-8111-111111111111',
  fileName: 'a.xlsx',
  status: 'applied',
  rowCount: 10,
  createdAt: '2026-09-23T01:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewItemMergeAction.mockResolvedValue({
    ok: true,
    data: { missingFamilies: [], vanishingItems: 0, previousBatchId: null },
  });
});

describe('ERP 안내 문구 상수 — 사용자 원문 (띄어쓰기·화살표만 정리)', () => {
  it('공통 설명 제목·두 줄', () => {
    expect(guide.ERP_GUIDE_TITLE).toBe('PRAMI ERP 데이터');
    expect(guide.ERP_GUIDE_INTRO).toBe('아래 내용에 대해 ERP에서 조회한 후');
    const line = guide.ERP_GUIDE_STEPS.map((step) => `${step.strong ?? ''}${step.text}`).join(
      ' -> ',
    );
    expect(line).toBe(
      '전체 리스트 드래그 -> (우클릭) -> [EXCEL로 전송하기] 클릭 (자동 다운로드) -> 파일 업로드',
    );
    expect(guide.ERP_GUIDE_STEPS[2]?.strong).toBe('[EXCEL로 전송하기]');
  });

  it('항목 1~4 이름 : 경로', () => {
    const lines = [
      guide.ERP_HINT_SALES,
      guide.ERP_HINT_ITEMS,
      guide.ERP_HINT_COSTS,
      guide.ERP_HINT_COST_LINK,
    ].map((hint) => `${hint.item} : ${hint.path}`);
    expect(lines).toEqual([
      '가격정책 관리 품목 업데이트 : 기본정보 > 품목단가 > 판매단가등록',
      '사용, 폐기 등 품목 상태 정보 업데이트 : 기본정보 > 품목 > 품목조회',
      '원가 관리 업데이트 : 기본정보 > 품목단가 > 구매단가등록(계약)',
      '품목 - 원가 매칭 업데이트 : 기본정보 > 품목 > 품목조회(추가정보)',
    ]);
    expect(guide.ERP_HINT_ITEM_COST_LINK_ON_LINKS_PAGE).toBe(true);
  });
});

async function expectCommonGuide(section: HTMLElement) {
  // 패널 맨 위 = 공통 설명 버튼 (상시 박스 없음 — 닫힌 상태에서는 본문이 보이지 않는다)
  const button = within(section).getByRole('button', { name: 'PRAMI ERP 데이터' });
  expect(section.querySelector('button')).toBe(button);
  expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  expect(screen.queryByText(guide.ERP_GUIDE_INTRO)).not.toBeInTheDocument();

  await userEvent.click(button);
  const dialog = screen.getByRole('dialog', { name: 'PRAMI ERP 데이터' });
  expect(within(dialog).getByText(guide.ERP_GUIDE_INTRO)).toBeInTheDocument();
  const steps = within(dialog).getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  expect(steps.map((li) => li.textContent)).toEqual([
    '전체 리스트 드래그',
    ' →(우클릭)',
    ' →[EXCEL로 전송하기] 클릭 (자동 다운로드)',
    ' →파일 업로드',
  ]);
  // 화살표는 장식, "[EXCEL로 전송하기]" 는 굵게
  expect(within(steps[1]!).getByText('→')).toHaveAttribute('aria-hidden', 'true');
  expect(within(dialog).getByText('[EXCEL로 전송하기]').tagName).toBe('STRONG');
  expect(dialog).toHaveAccessibleDescription(
    '아래 내용에 대해 ERP에서 조회한 후 전체 리스트 드래그 (우클릭) [EXCEL로 전송하기] 클릭 (자동 다운로드) 파일 업로드',
  );
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(button).toHaveFocus();
}

async function expectRowHint(label: string, item: string, path: string) {
  const hint = screen.getByRole('button', { name: `${label} ERP 메뉴 경로` });
  await userEvent.click(hint);
  const dialog = screen.getByRole('dialog', { name: `${label} ERP 메뉴 경로` });
  expect(within(dialog).getByText(item).tagName).toBe('STRONG');
  expect(within(dialog).getByText(path)).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('ImportPanel — ERP 안내', () => {
  it('신규 업로드 모드: 공통 설명 버튼·칸별 ⓘ·업로드 버튼 describedby', async () => {
    render(
      <ImportPanel
        userId="u"
        salesOptions={[]}
        itemOptions={[]}
        currentSalesId={null}
        currentItemId={null}
      />,
      withMotion,
    );
    await expectCommonGuide(screen.getByRole('region', { name: '가격정책 파일 적용' }));
    await expectRowHint('판매단가 파일', guide.ERP_HINT_SALES.item, guide.ERP_HINT_SALES.path);
    await expectRowHint('품목상태 파일', guide.ERP_HINT_ITEMS.item, guide.ERP_HINT_ITEMS.path);

    expect(
      screen.getByRole('button', { name: '판매단가 엑셀 업로드' }),
    ).toHaveAccessibleDescription(
      '가격정책 관리 품목 업데이트: 기본정보 > 품목단가 > 판매단가등록',
    );
    expect(
      screen.getByRole('button', { name: '품목조회 파일 업로드 (1~5개, 제품군별)' }),
    ).toHaveAccessibleDescription(
      '사용, 폐기 등 품목 상태 정보 업데이트: 기본정보 > 품목 > 품목조회',
    );
    // describedby 대상은 화면에는 숨긴(sr-only) 경로 텍스트
    const describedId = screen
      .getByRole('button', { name: '판매단가 엑셀 업로드' })
      .getAttribute('aria-describedby')!;
    expect(document.getElementById(describedId)).toHaveClass('sr-only');
  });

  it('기존 파일 재사용 모드에서도 칸별 ⓘ 와 공통 설명 버튼이 보인다', async () => {
    render(
      <ImportPanel
        userId="u"
        salesOptions={[BATCH]}
        itemOptions={[{ ...BATCH, id: '22222222-2222-4222-8222-222222222222' }]}
        currentSalesId={BATCH.id}
        currentItemId="22222222-2222-4222-8222-222222222222"
      />,
      withMotion,
    );
    expect(screen.getByLabelText('판매단가 파일 기존 배치')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PRAMI ERP 데이터' })).toBeInTheDocument();
    await expectRowHint('판매단가 파일', guide.ERP_HINT_SALES.item, guide.ERP_HINT_SALES.path);
    await expectRowHint('품목상태 파일', guide.ERP_HINT_ITEMS.item, guide.ERP_HINT_ITEMS.path);
    expect(screen.getByLabelText('판매단가 파일 기존 배치')).toHaveAccessibleDescription(
      '가격정책 관리 품목 업데이트: 기본정보 > 품목단가 > 판매단가등록',
    );
  });
});

describe('CostImportPanel — ERP 안내', () => {
  it('신규 업로드 모드: 공통 설명 버튼·원가 칸 ⓘ·기존 note 유지·업로드 버튼 describedby', async () => {
    render(<CostImportPanel userId="u" options={[]} currentBatchId={null} />, withMotion);
    await expectCommonGuide(screen.getByRole('region', { name: '원가 파일 적용' }));
    await expectRowHint('원가 파일', guide.ERP_HINT_COSTS.item, guide.ERP_HINT_COSTS.path);
    expect(screen.getByText(/구매단가등록 12컬럼/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '구매단가 엑셀 업로드' }),
    ).toHaveAccessibleDescription('원가 관리 업데이트: 기본정보 > 품목단가 > 구매단가등록(계약)');
  });

  it('기존 파일 재사용 모드에서도 원가 칸 ⓘ 가 보인다', async () => {
    render(<CostImportPanel userId="u" options={[BATCH]} currentBatchId={BATCH.id} />, withMotion);
    expect(screen.getByLabelText('원가 파일 기존 배치')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PRAMI ERP 데이터' })).toBeInTheDocument();
    await expectRowHint('원가 파일', guide.ERP_HINT_COSTS.item, guide.ERP_HINT_COSTS.path);
  });
});
