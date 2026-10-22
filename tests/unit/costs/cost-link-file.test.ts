import { describe, expect, it } from 'vitest';

import { readCostLinkFile } from '@/features/costs/cost-link-file-reader';
import {
  COST_LINK_FILE_FORMAT_MESSAGE,
  COST_LINK_FILE_MAX_ROWS,
  COST_LINK_FILE_TOO_LARGE_MESSAGE,
  COST_LINK_FILE_TOO_MANY_ROWS_MESSAGE,
  extractCostLinkPairs,
  looksLikeCostLinkFile,
} from '@/lib/imports/cost-link-file';

import { costLinkRow, costLinkXlsx } from '../../helpers/cost-link-file';

/**
 * 품목-원가 매칭 파일 브라우저 파서 (erp-upload-guide §6.2-2) — 합성 xlsx 만(실제 품목코드·품번 없음).
 * read-excel-file 브라우저 빌드로 첫 시트를 읽어 품번·원자재품번 두 열만 쌍으로, 빈 값 행은 건너뛴 건수만.
 */
const blobOf = (bytes: Buffer) => new Blob([new Uint8Array(bytes)]);

describe('readCostLinkFile (브라우저 빌드)', () => {
  it('1행 제목 · 2행 헤더 · 3행부터: 두 열만 쌍으로, 빈 품번·빈 원자재품번 행은 건너뜀', async () => {
    const bytes = await costLinkXlsx([
      costLinkRow('TEST-ITEM-001', 'TEST-MAT-001'),
      costLinkRow('TEST-ITEM-002', null),
      costLinkRow(null, 'TEST-MAT-002'),
      [null, null, null, null, null],
      costLinkRow(' TEST-ITEM-003 ', 'TEST-MAT-003'),
    ]);
    const result = await readCostLinkFile(blobOf(bytes));
    expect(result).toEqual({
      ok: true,
      pairs: [
        { itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' },
        { itemCode: 'TEST-ITEM-003', materialCode: 'TEST-MAT-003' },
      ],
      rowCount: 4,
      skipped: 2,
    });
    // 다른 열(품명·대체품·추가자재) 값은 결과 어디에도 없다
    expect(JSON.stringify(result)).not.toMatch(/TEST 품목|TEST-ALT|TEST-EXTRA/);
  });

  it('숫자 셀 품번은 문자열로', async () => {
    const bytes = await costLinkXlsx([
      costLinkRow(null, null).map((v, i) => (i === 1 ? 1001 : i === 2 ? 2002 : v)),
    ]);
    expect(await readCostLinkFile(blobOf(bytes))).toMatchObject({
      ok: true,
      pairs: [{ itemCode: '1001', materialCode: '2002' }],
    });
  });

  it('필수 헤더 없음(일반 품목조회 파일 등) → 형식 거부', async () => {
    const bytes = await costLinkXlsx([['TEST 품목', 'TEST-ITEM-001', '사용']], {
      title: '품목조회',
      header: ['품명', '품번', '품목 상태'],
    });
    expect(await readCostLinkFile(blobOf(bytes))).toEqual({
      ok: false,
      message: COST_LINK_FILE_FORMAT_MESSAGE,
    });
  });

  it('xlsx 가 아닌 파일 → 형식 거부, 10MB 초과 → 크기 거부(읽지 않음)', async () => {
    expect(await readCostLinkFile(new Blob(['not an xlsx']))).toEqual({
      ok: false,
      message: COST_LINK_FILE_FORMAT_MESSAGE,
    });
    const huge = { size: 10 * 1024 * 1024 + 1 } as Blob;
    expect(await readCostLinkFile(huge)).toEqual({
      ok: false,
      message: COST_LINK_FILE_TOO_LARGE_MESSAGE,
    });
  });
});

describe('extractCostLinkPairs · looksLikeCostLinkFile (순수)', () => {
  const header = ['품번', '원자재품번(필수)'];

  it('행 상한 5,000 초과 → 거부, 정확히 5,000 은 통과', () => {
    const rows = (n: number) => [
      ['품목조회(추가정보)'],
      header,
      ...Array.from({ length: n }, (_, i) => [`TEST-ITEM-${i}`, 'TEST-MAT-001']),
    ];
    expect(extractCostLinkPairs(rows(COST_LINK_FILE_MAX_ROWS))).toMatchObject({
      ok: true,
      rowCount: COST_LINK_FILE_MAX_ROWS,
    });
    expect(extractCostLinkPairs(rows(COST_LINK_FILE_MAX_ROWS + 1))).toEqual({
      ok: false,
      message: COST_LINK_FILE_TOO_MANY_ROWS_MESSAGE,
    });
  });

  it('제목 없이 1행이 헤더여도 읽는다. 데이터 행이 모두 비면 거부', () => {
    expect(extractCostLinkPairs([header, ['TEST-ITEM-001', 'TEST-MAT-001']])).toMatchObject({
      ok: true,
      pairs: [{ itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' }],
    });
    expect(extractCostLinkPairs([header, ['TEST-ITEM-001', '']])).toMatchObject({ ok: false });
  });

  it('매칭 파일 판별: 1행 제목 또는 "원자재품번(필수)" 헤더', () => {
    expect(looksLikeCostLinkFile([['품목조회(추가정보)'], ['품명']])).toBe(true);
    expect(looksLikeCostLinkFile([['품목조회'], ['품번', '원자재품번(필수)']])).toBe(true);
    expect(looksLikeCostLinkFile([['품목조회'], ['품명', '품번', '품목 상태']])).toBe(false);
  });
});
