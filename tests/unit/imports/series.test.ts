// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deriveItemKind, mapItemStatus } from '@/lib/constants/item-status';
import { computeSeries, salesSeriesKey } from '@/server/imports/series';

/** §4.4.3 계열 규칙 (순수 함수) + 품목상태 매핑 상수 (Q-02) */
const base = {
  itemCode: 'P2002030005',
  priceType: 'DBMS변경',
  priceCategory: '일반',
  currency: 'KRW',
  customerCode: '0',
};

describe('series', () => {
  it('계열 키 = 품번|단가유형|단가구분|화폐|거래처코드, 단가유형 NULL 은 빈 문자열', () => {
    expect(salesSeriesKey(base)).toBe('P2002030005|DBMS변경|일반|KRW|0');
    expect(salesSeriesKey({ ...base, priceType: null })).toBe('P2002030005||일반|KRW|0');
  });

  it('스펙 예시: 2018 행은 2022-02-01 까지(배타), 최신은 2022 행 — 입력 순서와 무관', () => {
    const result = computeSeries([
      { ...base, effectiveFrom: '2022-02-01' },
      { ...base, effectiveFrom: '2018-01-01' },
      { ...base, priceType: '정상판매', effectiveFrom: '2018-01-01' },
    ]);
    expect(result).toEqual([
      { seriesKey: salesSeriesKey(base), effectiveTo: null, isLatest: true },
      { seriesKey: salesSeriesKey(base), effectiveTo: '2022-02-01', isLatest: false },
      {
        seriesKey: salesSeriesKey({ ...base, priceType: '정상판매' }),
        effectiveTo: null,
        isLatest: true,
      },
    ]);
  });
});

describe('item-status', () => {
  it('원문 라벨 매핑, 매핑 불가·빈 값은 null, 중분류 Parts → 파츠', () => {
    expect(mapItemStatus(' 폐기 ')).toBe('폐기');
    expect(mapItemStatus('보류')).toBeNull();
    expect(mapItemStatus(null)).toBeNull();
    expect(deriveItemKind('Parts')).toBe('파츠');
    expect(deriveItemKind('WAPPLES')).toBeNull();
  });
});

describe('ImportPanel 선택 규칙', () => {
  it('선택 파일은 미선택을 허용하고 오류 업로드는 막는다, 필수 파일은 배치가 있어야 한다', async () => {
    const { selectionBlocksApply, selectedBatchId } =
      await import('@/features/admin-policies/types');
    const empty = { mode: 'new' as const, upload: null, reuseId: '' };
    expect(selectionBlocksApply(empty, true)).toBe(false);
    expect(selectionBlocksApply(empty, false)).toBe(true);
    const bad = {
      ...empty,
      upload: {
        batchId: 'b',
        status: 'parsed' as const,
        fileName: 'f',
        sheetName: 's',
        headerRowIndex: 0,
        rowCount: 1,
        errorCount: 1,
        preview: [],
        errors: [],
        warnings: [],
        duplicateWarnings: { sameDateDuplicates: [], conflictingDuplicates: [] },
      },
    };
    expect(selectionBlocksApply(bad, true)).toBe(true);
    expect(selectedBatchId({ ...bad, upload: { ...bad.upload, errorCount: 0 } })).toBe('b');
    expect(selectionBlocksApply({ mode: 'reuse', upload: null, reuseId: '' }, false)).toBe(true);
  });
});
