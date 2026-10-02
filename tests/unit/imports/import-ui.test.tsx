import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PolicyApplyStats } from '@/db/schema';
import type { BatchOption, UploadSummaryData } from '@/features/admin-policies/types';

/** 가격정책 관리 ImportPanel (§4.5.3 ①②③, R-11) — fetch·Server Action 은 모킹 */
const mocks = vi.hoisted(() => ({
  applyPolicyAction: vi.fn(),
  previewItemMergeAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/features/admin-policies/actions', () => ({
  applyPolicyAction: mocks.applyPolicyAction,
  previewItemMergeAction: mocks.previewItemMergeAction,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const { ImportPanel } = await import('@/features/admin-policies/ImportPanel');
const { ApplyStatsView } = await import('@/features/admin-policies/ApplyStatsView');
const { ImportFileRow } = await import('@/features/admin-policies/ImportFileRow');

const SALES_BATCH: BatchOption = {
  id: '11111111-1111-4111-8111-111111111111',
  fileName: '병합_가격_raw.xlsx',
  status: 'applied',
  rowCount: 5885,
  createdAt: '2026-09-23T01:00:00.000Z',
};
const ITEM_BATCH: BatchOption = {
  ...SALES_BATCH,
  id: '22222222-2222-4222-8222-222222222222',
  fileName: '품목조회.xlsx',
  status: 'parsed',
  rowCount: 1500,
};

const UPLOAD_OK: UploadSummaryData = {
  batchId: '33333333-3333-4333-8333-333333333333',
  status: 'parsed',
  fileName: 'new.xlsx',
  sheetName: 'RAW',
  headerRowIndex: 0,
  rowCount: 2,
  errorCount: 0,
  preview: [
    {
      rowIndex: 2,
      row: { itemCode: 'P1', itemName: '품목 1', unitPrice: '100.00', priceType: null },
    },
    { rowIndex: 3, row: { itemCode: 'P2', itemName: '품목 2', unitPrice: '200.00' } },
  ],
  errors: [],
  warnings: [{ row: 1, column: '메모', message: '정의되지 않은 컬럼이라 무시했습니다' }],
  duplicateWarnings: { sameDateDuplicates: [], conflictingDuplicates: [] },
};

const STATS: PolicyApplyStats = {
  inserted: 5885,
  seriesCount: 3810,
  latestCount: 3810,
  discardedForced: 2,
  missingItems: 3,
  manualPreserved: 0,
  manualConflicts: 0,
  operatingCount: 3808,
  itemsApplied: 1500,
  unmappedItemStatus: 1,
  finalSourceMismatch: 0,
};

function mockFetch(response: unknown) {
  const fetchMock = vi.fn(async () => ({ json: async () => response }) as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function chooseFile(label: string, name = 'new.xlsx') {
  const input = screen.getByLabelText(label);
  await userEvent.upload(input, new File(['x'], name));
}

beforeEach(() => {
  vi.clearAllMocks();
  // 빠지는 제품군 없음 → 병합 방식 선택 없이 적용 (PRAMI-003 §4.2.3)
  mocks.previewItemMergeAction.mockResolvedValue({
    ok: true,
    data: { missingFamilies: [], vanishingItems: 0, previousBatchId: null },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImportPanel', () => {
  it('현재 적용 배치가 있으면 기존 파일 재사용이 기본이고 바로 적용할 수 있다 (③ 둘 다 기존)', async () => {
    mocks.applyPolicyAction.mockResolvedValue({ ok: true, data: { runId: 'r', stats: STATS } });
    render(
      <ImportPanel
        salesOptions={[SALES_BATCH]}
        itemOptions={[ITEM_BATCH]}
        currentSalesId={SALES_BATCH.id}
        currentItemId={ITEM_BATCH.id}
      />,
    );
    expect(screen.getByLabelText('판매단가 파일 기존 배치')).toHaveValue(SALES_BATCH.id);
    expect(
      screen.getByRole('option', {
        name: /병합_가격_raw\.xlsx · 2026-09-23 · 5,885행 · 현재 적용/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '가격정책 적용' }));
    expect(mocks.applyPolicyAction).toHaveBeenCalledWith({
      salesBatchId: SALES_BATCH.id,
      itemBatchId: ITEM_BATCH.id,
      salesReused: true,
      itemReused: true,
    });
    const status = await screen.findByRole('status', { name: '적용 완료' });
    expect(within(status).getByText('5,885')).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('처음(적용 이력 없음)에는 신규 업로드, 오류 없는 업로드 후에만 적용 가능 (품목 없음 허용)', async () => {
    const fetchMock = mockFetch({ ok: true, data: UPLOAD_OK });
    mocks.applyPolicyAction.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: '가격정책 적용에 실패했습니다: 불변식 I-1 위반' },
    });
    render(
      <ImportPanel salesOptions={[]} itemOptions={[]} currentSalesId={null} currentItemId={null} />,
    );
    const apply = screen.getByRole('button', { name: '가격정책 적용' });
    expect(apply).toBeDisabled();

    await chooseFile('판매단가 엑셀 업로드');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/imports/sales',
      expect.objectContaining({ method: 'POST' }),
    );
    const summary = await screen.findByLabelText('new.xlsx 검증 결과');
    expect(within(summary).getByText('검증 통과')).toBeInTheDocument();
    expect(
      within(summary).getByRole('table', { name: '미리보기 (상위 20행)' }),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/경고: 메모/)).toBeInTheDocument();

    // 품목상태: 기존 재사용 + "없음" → 선택 사항이므로 적용 가능
    const itemMode = screen.getByRole('radiogroup', { name: '품목상태 파일 방식' });
    await userEvent.click(within(itemMode).getByRole('radio', { name: '기존 파일 재사용' }));
    expect(screen.getByLabelText('품목상태 파일 기존 배치')).toHaveValue('');
    expect(apply).toBeEnabled();
    await userEvent.click(apply);
    expect(mocks.applyPolicyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        salesBatchId: UPLOAD_OK.batchId,
        itemBatchId: null,
        salesReused: false,
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('불변식 I-1 위반');
  });

  it('오류가 있는 업로드는 오류 목록(행·컬럼·값)을 보이고 적용 버튼을 막는다 (AC-25)', async () => {
    mockFetch({
      ok: true,
      data: {
        ...UPLOAD_OK,
        errorCount: 2,
        errors: [
          {
            row: 4,
            column: '적용시작일',
            message: '날짜 형식(YYYY-MM-DD)이 아닙니다',
            value: '2024-13-45',
          },
          { row: 6, column: '단가', message: '음수는 허용되지 않습니다', value: -1000 },
        ],
      },
    });
    render(
      <ImportPanel salesOptions={[]} itemOptions={[]} currentSalesId={null} currentItemId={null} />,
    );
    await chooseFile('판매단가 엑셀 업로드');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '4행 · 적용시작일 — 날짜 형식(YYYY-MM-DD)이 아닙니다 (값: 2024-13-45)',
    );
    expect(alert).toHaveTextContent('6행 · 단가');
    expect(screen.getByRole('button', { name: '가격정책 적용' })).toBeDisabled();
  });

  it('같은 파일 재업로드(409)는 안내 + "기존 파일 선택"으로 재사용 전환', async () => {
    mockFetch({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: '이미 업로드된 파일입니다',
        details: { existingBatchId: SALES_BATCH.id },
      },
    });
    render(
      <ImportPanel
        salesOptions={[SALES_BATCH]}
        itemOptions={[]}
        currentSalesId={null}
        currentItemId={null}
      />,
    );
    await chooseFile('판매단가 엑셀 업로드');
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 업로드된 파일입니다');
    await userEvent.click(screen.getByRole('button', { name: '기존 파일 선택' }));
    expect(screen.getByLabelText('판매단가 파일 기존 배치')).toHaveValue(SALES_BATCH.id);
  });

  it('네트워크 실패 안내, 실패(헤더 누락) 배치 표시', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    render(
      <ImportPanel salesOptions={[]} itemOptions={[]} currentSalesId={null} currentItemId={null} />,
    );
    await chooseFile('품목조회 파일 업로드 (1~5개, 제품군별)');
    expect(await screen.findByRole('alert')).toHaveTextContent('업로드하지 못했습니다');

    mockFetch({
      ok: true,
      data: {
        ...UPLOAD_OK,
        status: 'failed',
        sheetName: '',
        rowCount: 0,
        errorCount: 1,
        preview: [],
        warnings: [],
        duplicateWarnings: { sameDateDuplicates: [], conflictingDuplicates: [] },
        errors: [{ row: 0, column: '', message: '필수 헤더 누락: 단가(1코어)' }],
      },
    });
    await chooseFile('판매단가 엑셀 업로드', 'broken.xlsx');
    const summary = await screen.findByLabelText('new.xlsx 검증 결과');
    expect(within(summary).getByText('실패')).toBeInTheDocument();
    expect(within(summary).getByRole('alert')).toHaveTextContent(
      '파일 — 필수 헤더 누락: 단가(1코어)',
    );
  });
});

function sizedFile(name: string, size: number): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('ImportPanel 업로드 상한·병합 미리보기 (PRAMI-003 QA M-2·L-4)', () => {
  const MB = 1024 * 1024;

  it('L-4: 품목 배치 병합 미리보기 응답 전에는 적용 버튼이 잠기고, 응답 후 열린다', async () => {
    let resolvePreview: (value: unknown) => void = () => {};
    mocks.previewItemMergeAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    render(
      <ImportPanel
        salesOptions={[SALES_BATCH]}
        itemOptions={[ITEM_BATCH]}
        currentSalesId={SALES_BATCH.id}
        currentItemId={ITEM_BATCH.id}
      />,
    );
    const apply = screen.getByRole('button', { name: '가격정책 적용' });
    expect(apply).toBeDisabled();
    expect(screen.getByText('품목 제품군 병합 여부를 확인하는 중입니다…')).toBeInTheDocument();
    resolvePreview({
      ok: true,
      data: { missingFamilies: [], vanishingItems: 0, previousBatchId: null },
    });
    await vi.waitFor(() => expect(apply).toBeEnabled());
  });

  it('L-4: 미리보기가 실패해도 영구히 잠기지 않는다 (서버가 적용 시 다시 판정)', async () => {
    mocks.previewItemMergeAction.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'x' },
    });
    render(
      <ImportPanel
        salesOptions={[SALES_BATCH]}
        itemOptions={[ITEM_BATCH]}
        currentSalesId={SALES_BATCH.id}
        currentItemId={ITEM_BATCH.id}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: '가격정책 적용' })).toBeEnabled(),
    );
  });

  it('M-2: 파일당 10MB·품목 합계 25MB·5개 초과는 보내기 전에 안내하고 요청하지 않는다', async () => {
    const fetchMock = mockFetch({ ok: true, data: UPLOAD_OK });
    render(
      <ImportPanel salesOptions={[]} itemOptions={[]} currentSalesId={null} currentItemId={null} />,
    );
    await userEvent.upload(
      screen.getByLabelText('판매단가 엑셀 업로드'),
      sizedFile('big.xlsx', 10 * MB + 1),
    );
    expect(await screen.findByText('파일은 10MB 이하만 업로드할 수 있습니다')).toBeInTheDocument();

    const itemInput = screen.getByLabelText('품목조회 파일 업로드 (1~5개, 제품군별)');
    await userEvent.upload(itemInput, [
      sizedFile('a.xlsx', 10 * MB),
      sizedFile('b.xlsx', 10 * MB),
      sizedFile('c.xlsx', 5 * MB + 1),
    ]);
    expect(
      await screen.findByText('품목조회 파일 합계는 25MB 이하만 업로드할 수 있습니다'),
    ).toBeInTheDocument();
    await userEvent.upload(
      itemInput,
      ['1', '2', '3', '4', '5', '6'].map((n) => sizedFile(`${n}.xlsx`, 1)),
    );
    expect(await screen.findByText('품목조회 파일은 한 번에 5개까지입니다')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M-2: 합계 25MB 정확히는 보낸다 / 플랫폼 413(JSON 아님)은 크기 한도 안내', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 413,
          json: async () => {
            throw new SyntaxError('Unexpected token R');
          },
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ImportPanel salesOptions={[]} itemOptions={[]} currentSalesId={null} currentItemId={null} />,
    );
    await userEvent.upload(screen.getByLabelText('품목조회 파일 업로드 (1~5개, 제품군별)'), [
      sizedFile('a.xlsx', 10 * MB),
      sizedFile('b.xlsx', 10 * MB),
      sizedFile('c.xlsx', 5 * MB),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/업로드 크기가 서버 허용 한도를 넘었습니다\(413\)/),
    ).toBeInTheDocument();
  });
});

describe('ApplyStatsView', () => {
  it('run.stats 를 라벨과 함께 표시한다', () => {
    render(<ApplyStatsView title="적용 완료" stats={STATS} />);
    expect(screen.getByText('폐기로 미사용 처리')).toBeInTheDocument();
    expect(screen.getByText('3,808')).toBeInTheDocument();
  });
});

describe('ImportFileRow 기존 파일 목록 (Linux 하이드레이션 수정 §3.3)', () => {
  it('업로드일은 KST 기준 날짜 — UTC 20시 업로드가 전날로 표시되지 않는다', () => {
    render(
      <ImportFileRow
        kind="sales"
        label="판매단가 파일"
        uploadLabel="판매단가 업로드"
        options={[{ ...SALES_BATCH, createdAt: '2026-10-01T20:00:00Z' }]}
        selection={{ mode: 'reuse', upload: null, reuseId: SALES_BATCH.id }}
        onChange={() => {}}
      />,
    );
    const option = screen.getByRole('option', { name: /병합_가격_raw\.xlsx/ });
    expect(option).toHaveTextContent('2026-10-02');
    expect(option).not.toHaveTextContent('2026-10-01');
  });
});
