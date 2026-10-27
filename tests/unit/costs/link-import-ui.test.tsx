import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostLinkImportPreview } from '@/server/cost/item-link-types';

/**
 * 매칭 파일 업로드 화면 (erp-upload-guide §6.2-4) — 파서·Server Action·라우터는 모킹, 합성 데이터만.
 * 미리보기 건수·접는 목록 → "확정(변경 N·추가 M)" → 결과, 데이터가 바뀌어 거부되면 "다시 미리보기".
 * 서버로는 쌍만 간다(파일·파일명 없음).
 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  read: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock('@/features/costs/cost-link-file-reader', () => ({ readCostLinkFile: mocks.read }));
vi.mock('@/features/costs/link-actions', () => ({
  previewCostLinkImportAction: mocks.preview,
  applyCostLinkImportAction: mocks.apply,
}));

const { CostLinkImport } = await import('@/features/costs/CostLinkImport');

const PAIRS = [
  { itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-002' },
  { itemCode: 'TEST-ITEM-002', materialCode: 'TEST-MAT-001' },
  { itemCode: 'TEST-ITEM-404', materialCode: 'TEST-MAT-001' },
];

const PREVIEW: CostLinkImportPreview = {
  pairs: 3,
  items: 3,
  same: 0,
  changed: [
    {
      itemCode: 'TEST-ITEM-001',
      itemName: 'TEST 품목 1',
      family: 'WAPPLES',
      before: { materialCode: 'TEST-MAT-001', materialName: 'TEST 자재 1' },
      after: { materialCode: 'TEST-MAT-002', materialName: 'TEST 자재 2' },
    },
  ],
  added: [
    {
      itemCode: 'TEST-ITEM-002',
      itemName: 'TEST 품목 2',
      family: 'iSIGN',
      before: null,
      after: { materialCode: 'TEST-MAT-001', materialName: 'TEST 자재 1' },
    },
  ],
  failed: [{ itemCode: 'TEST-ITEM-404', materialCodes: ['TEST-MAT-001'], reason: 'no-item' }],
  failedByReason: { 'no-item': 1, 'out-of-scope': 0, 'no-cost': 0, multiple: 0, format: 0 },
  kept: [{ family: 'WAPPLES', count: 2 }],
};

const file = () => new File(['synthetic'], 'synthetic.xlsx');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ ok: true, pairs: PAIRS, rowCount: 4, skipped: 1 });
  mocks.preview.mockResolvedValue({ ok: true, data: PREVIEW });
});

describe('CostLinkImport', () => {
  it('파일 → 미리보기(건수·사유·유지·접는 목록) → 확정(변경 1·추가 1) → 결과 + refresh. 서버로는 쌍만', async () => {
    mocks.apply.mockResolvedValue({
      ok: true,
      data: { saved: 2, unchanged: 0, failedByReason: PREVIEW.failedByReason },
    });
    const user = userEvent.setup();
    render(<CostLinkImport />);
    await user.upload(screen.getByLabelText('품목-원가 매칭 파일 선택'), file());

    const preview = await screen.findByRole('group', { name: '매칭 파일 미리보기' });
    expect(preview).toHaveTextContent('파일 4행 · 빈 품번·원자재품번으로 건너뜀 1행');
    expect(preview).toHaveTextContent('변경 1');
    expect(preview).toHaveTextContent('추가 1');
    expect(preview).toHaveTextContent('품목 마스터 없음 1');
    expect(preview).toHaveTextContent('WAPPLES 2');
    expect(preview).toHaveTextContent(
      'TEST-ITEM-001 TEST 품목 1 · TEST 자재 1 (TEST-MAT-001) → TEST 자재 2 (TEST-MAT-002)',
    );
    expect(mocks.preview).toHaveBeenCalledWith({ pairs: PAIRS });

    // 미리보기 묶음과 확정 버튼은 같은 렌더에 나오지 않을 수 있다(부하 때 CI 에서 한 번 실패) — 버튼도 기다린다
    await user.click(await screen.findByRole('button', { name: '확정(변경 1·추가 1)' }));
    await waitFor(() =>
      expect(mocks.apply).toHaveBeenCalledWith({
        pairs: PAIRS,
        expected: { changed: 1, added: 1 },
      }),
    );
    expect(JSON.stringify(mocks.apply.mock.calls)).not.toContain('synthetic.xlsx');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2건 확정'));
    expect(screen.queryByRole('group', { name: '매칭 파일 미리보기' })).toBeNull();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('형식 오류는 서버를 부르지 않고 알림', async () => {
    mocks.read.mockResolvedValue({ ok: false, message: '품목-원가 매칭 파일 형식이 아닙니다' });
    const user = userEvent.setup();
    render(<CostLinkImport />);
    await user.upload(screen.getByLabelText('품목-원가 매칭 파일 선택'), file());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '품목-원가 매칭 파일 형식이 아닙니다',
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('확정이 CONFLICT(stale) → "다시 미리보기" 로 같은 쌍을 다시 미리보기', async () => {
    mocks.apply.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', message: '다시 미리보기 하세요', details: { stale: true } },
    });
    const user = userEvent.setup();
    render(<CostLinkImport />);
    await user.upload(screen.getByLabelText('품목-원가 매칭 파일 선택'), file());
    await user.click(await screen.findByRole('button', { name: '확정(변경 1·추가 1)' }));
    await user.click(await screen.findByRole('button', { name: '다시 미리보기' }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
    expect(mocks.preview).toHaveBeenLastCalledWith({ pairs: PAIRS });
  });

  it('변경·추가 0건이면 확정 버튼 비활성', async () => {
    mocks.preview.mockResolvedValue({ ok: true, data: { ...PREVIEW, changed: [], added: [] } });
    const user = userEvent.setup();
    render(<CostLinkImport />);
    await user.upload(screen.getByLabelText('품목-원가 매칭 파일 선택'), file());
    expect(await screen.findByRole('button', { name: '확정(변경 0·추가 0)' })).toBeDisabled();
  });
});
