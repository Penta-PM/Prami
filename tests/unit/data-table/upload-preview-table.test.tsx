import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ImportFileKind, UploadSummaryData } from '@/features/admin-policies/types';
import { UploadSummary } from '@/features/admin-policies/UploadSummary';

/** #32 PR-2: 업로드 미리보기 표가 공용 DataTable(클라이언트 정렬)로 동작한다 — '행' 열은 앞에 고정 */

const base: Omit<UploadSummaryData, 'preview'> = {
  batchId: '33333333-3333-4333-8333-333333333333',
  status: 'parsed',
  fileName: 'new.xlsx',
  sheetName: 'RAW',
  headerRowIndex: 0,
  rowCount: 4,
  errorCount: 0,
  errors: [],
  warnings: [],
  duplicateWarnings: { sameDateDuplicates: [], conflictingDuplicates: [] },
};

const SALES: UploadSummaryData = {
  ...base,
  preview: [
    { rowIndex: 2, row: { itemCode: 'P2', unitPrice: '300.00', currency: 'KRW' } },
    { rowIndex: 3, row: { itemCode: 'P1', unitPrice: '20.00', currency: 'USD' } },
    { rowIndex: 4, row: { itemCode: 'p3', unitPrice: null, currency: 'KRW' } },
    { rowIndex: 5, row: { itemCode: 'P4', unitPrice: '100.00', currency: 'KRW' } },
    { rowIndex: 6, row: { itemCode: null, unitPrice: '5.00', currency: 'USD' } },
  ],
};

function renderSummary(data: UploadSummaryData = SALES, kind: ImportFileKind = 'sales') {
  return render(<UploadSummary kind={kind} data={data} userId="u1" />);
}

const table = () => screen.getByRole('table', { name: '미리보기 (상위 20행)' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);
const rowNumbers = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

const SALES_HEADERS = [
  '행',
  '품번',
  '품명',
  '단가유형',
  '단가구분',
  '화폐',
  '단가',
  '적용시작일',
  '거래처코드',
];

beforeEach(() => {
  localStorage.clear();
});

describe('업로드 미리보기 표 (DataTable)', () => {
  it("'상위 20행 안에서 정렬' 안내가 보이고, 헤더 텍스트·순서는 그대로다", () => {
    renderSummary();
    expect(screen.getByText('상위 20행 안에서 정렬')).toBeVisible();
    expect(headers()).toEqual(SALES_HEADERS);
  });

  it('헤더 클릭 시 aria-sort 가 오름 → 내림 → 없음, 기본 순서로 돌아오고 빈 값은 맨 뒤', async () => {
    renderSummary();
    const button = within(th('품번')).getByRole('button');
    await userEvent.click(button);
    expect(th('품번')).toHaveAttribute('aria-sort', 'ascending');
    // ASCII 대소문자 무시: P1 < P2 < p3 < P4, 빈 값(null)은 맨 뒤
    expect(rowNumbers()).toEqual(['3', '2', '4', '5', '6']);
    await userEvent.click(button);
    expect(th('품번')).toHaveAttribute('aria-sort', 'descending');
    expect(rowNumbers()).toEqual(['5', '4', '2', '3', '6']);
    await userEvent.click(button);
    expect(th('품번')).not.toHaveAttribute('aria-sort');
    expect(rowNumbers()).toEqual(['2', '3', '4', '5', '6']);
  });

  it('단가는 화폐로 먼저 묶고 같은 화폐 안에서 금액순 (통화 혼합)', async () => {
    renderSummary();
    const button = within(th('단가')).getByRole('button');
    await userEvent.click(button);
    expect(rowNumbers()).toEqual(['5', '2', '6', '3', '4']);
    await userEvent.click(button);
    expect(rowNumbers()).toEqual(['3', '6', '2', '5', '4']);
  });

  it("'행' 열은 숫자로 정렬되고 앞에 고정 — Alt+Shift+← 로 다른 열이 그 앞에 갈 수 없고 자신도 움직이지 않는다", async () => {
    renderSummary({
      ...SALES,
      preview: [SALES.preview[1]!, SALES.preview[0]!, ...SALES.preview.slice(2)],
    });
    const rowButton = within(th('행')).getByRole('button');
    await userEvent.click(rowButton);
    expect(rowNumbers()).toEqual(['2', '3', '4', '5', '6']);

    rowButton.focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(SALES_HEADERS);

    within(th('품번')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(headers()).toEqual(SALES_HEADERS);
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it("'열 초기화'는 기본 상태에서 비활성이고, 열을 옮기면 켜진다 — 저장 키는 종류·사용자별", async () => {
    renderSummary();
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
    within(th('품명')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(headers()?.slice(0, 3)).toEqual(['행', '품명', '품번']);
    expect(localStorage.getItem('prami:table:upload-preview-sales:v1:u1')).not.toBeNull();
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeEnabled();
  });

  it('품목 상태는 사용 → 임시 → 폐기 → 미확인 정의 순서', async () => {
    renderSummary(
      {
        ...base,
        preview: [
          { rowIndex: 2, row: { itemStatus: '폐기' } },
          { rowIndex: 3, row: { itemStatus: '미확인' } },
          { rowIndex: 4, row: { itemStatus: '사용' } },
          { rowIndex: 5, row: { itemStatus: '임시' } },
        ],
      },
      'items',
    );
    await userEvent.click(within(th('품목 상태')).getByRole('button'));
    expect(rowNumbers()).toEqual(['4', '5', '2', '3']);
  });
});
