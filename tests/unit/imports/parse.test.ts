// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  excelSerialToIsoDate,
  flag,
  isoDate,
  money,
  optionalText,
  yesNo,
} from '@/server/imports/cells';
import { detectHeader } from '@/server/imports/header-detect';
import { parseSheet } from '@/server/imports/parse-sheet';
import { pickSheet, readWorkbook, WorkbookReadError } from '@/server/imports/parse-xlsx';
import { COST_SPEC } from '@/server/imports/schemas/costs';
import { ITEM_SPEC } from '@/server/imports/schemas/items';
import { PART_SPEC } from '@/server/imports/schemas/parts';
import { SALES_COLUMNS, SALES_SPEC } from '@/server/imports/schemas/sales';

import { SALES_PRICE_SOURCE_COLUMNS } from '../../fixtures/sales-prices-columns';
import { fixtureSheets } from '../../helpers/imports';

/** §4.4.1 헤더 감지·행 파싱·zod 변환 (§4.3.1 변환 규칙) */
describe('셀 변환', () => {
  it('날짜: 문자열·Date·Excel 직렬값, 잘못된 값은 오류', () => {
    expect(isoDate.parse('2018-01-01')).toBe('2018-01-01');
    expect(isoDate.parse('2018.01.01')).toBe('2018-01-01');
    expect(isoDate.parse(new Date(Date.UTC(2022, 1, 1)))).toBe('2022-02-01');
    expect(isoDate.parse(44593)).toBe('2022-02-01');
    expect(excelSerialToIsoDate(43101)).toBe('2018-01-01');
    expect(isoDate.safeParse('2024-13-45').success).toBe(false);
    expect(isoDate.safeParse(null).success).toBe(false);
  });

  it('금액: 문자열 콤마 허용, 음수·문자·과대값 오류, 2자리 문자열', () => {
    expect(money.parse(9000000)).toBe('9000000.00');
    expect(money.parse('1,650,000,000')).toBe('1650000000.00');
    expect(money.safeParse(-1).error?.issues[0]?.message).toBe('음수는 허용되지 않습니다');
    expect(money.safeParse('abc').success).toBe(false);
    expect(money.safeParse(1e17).success).toBe(false);
  });

  it('불리언·Y/N·선택 텍스트(숫자 셀 문자열화)', () => {
    expect(flag.parse(true)).toBe(true);
    expect(flag.parse('FALSE')).toBe(false);
    expect(flag.parse('y')).toBe(true);
    expect(flag.safeParse('maybe').success).toBe(false);
    expect(yesNo.parse('N')).toBe(false);
    expect(yesNo.safeParse(true).success).toBe(false);
    expect(optionalText.parse(1)).toBe('1');
    expect(optionalText.parse('  ')).toBeNull();
  });
});

describe('헤더 감지', () => {
  it('상위 5행에서 필수 헤더가 모두 있는 첫 행, 추가 컬럼은 extras', () => {
    const match = detectHeader(
      [['제목'], [' 품번 ', '품명', '기타']],
      ['품번', '품명'],
      ['품번', '품명'],
    );
    expect(match).toMatchObject({
      ok: true,
      rowIndex: 1,
      extras: [{ header: '기타', column: 2 }],
    });
  });

  it('없으면 가장 많이 맞은 행 기준 누락 헤더', () => {
    const rows = [['품번'], [], [], [], [], ['품번', '품명']];
    expect(detectHeader(rows, ['품번', '품명'], [])).toEqual({
      ok: false,
      missing: ['품명'],
      bestRowIndex: 0,
    });
  });

  it('판매단가 헤더 20개는 §4.3.1 표와 순서까지 같다', () => {
    expect(SALES_COLUMNS.map((column) => column.header)).toEqual(
      SALES_PRICE_SOURCE_COLUMNS.map((column) => column.excelHeader),
    );
  });
});

describe('parseSheet — 픽스처', () => {
  it('원본 200행 픽스처: parsed, 오류 0, RAW 시트·1행 헤더', async () => {
    const outcome = parseSheet(SALES_SPEC, await fixtureSheets('sales-200.xlsx'));
    expect(outcome).toMatchObject({
      status: 'parsed',
      sheetName: 'RAW',
      headerRowIndex: 0,
      rowCount: 200,
      errorCount: 0,
    });
    const first = outcome.rows[0]!;
    expect(first.rowIndex).toBe(2);
    expect(first.row.currency).toMatch(/^[A-Z]{3}$/);
    expect(outcome.rows.some(({ row }) => row.priceType === null)).toBe(true);
  });

  it('AC-25: 헤더 누락(단가(1코어)) → failed, 누락 헤더명 포함', async () => {
    const outcome = parseSheet(SALES_SPEC, await fixtureSheets('sales-header-missing.xlsx'));
    expect(outcome.status).toBe('failed');
    expect(outcome.errors[0]?.message).toContain('단가(1코어)');
    expect(outcome.rows).toHaveLength(0);
  });

  it('AC-25: 잘못된 날짜·음수 단가·중복 → 행번호·컬럼·값이 있는 오류', async () => {
    const outcome = parseSheet(SALES_SPEC, await fixtureSheets('sales-row-errors.xlsx'));
    expect(outcome.status).toBe('parsed');
    expect(outcome.errorCount).toBe(3);
    expect(outcome.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 4, column: '적용시작일', value: '2024-13-45' }),
        expect.objectContaining({ row: 6, column: '단가', value: -1000 }),
        expect.objectContaining({ row: 202, message: expect.stringContaining('(2행)') }),
      ]),
    );
  });

  it('품목조회: 1행 제목 + 2행 헤더, 추가 컬럼(비고)은 raw 로 보존·경고', async () => {
    const outcome = parseSheet(ITEM_SPEC, await fixtureSheets('items-v1.xlsx'));
    expect(outcome).toMatchObject({ status: 'parsed', headerRowIndex: 1, errorCount: 0 });
    expect(outcome.rows[0]!.row.raw).toEqual({ 비고: '비고 0' });
    expect(outcome.warnings[0]).toMatchObject({ column: '비고' });
  });

  it('원가 12컬럼(제목 행 포함)·파츠 2컬럼', async () => {
    const costs = parseSheet(COST_SPEC, await fixtureSheets('costs-sample.xlsx'));
    expect(costs).toMatchObject({
      status: 'parsed',
      headerRowIndex: 1,
      rowCount: 3,
      errorCount: 0,
    });
    expect(costs.rows[2]!.row).toMatchObject({
      appliesToAllCustomers: true,
      unitCost: '500000.00',
    });
    const parts = parseSheet(PART_SPEC, await fixtureSheets('parts-sample.xlsx'));
    expect(parts).toMatchObject({ status: 'parsed', rowCount: 3, errorCount: 0 });
  });

  it('데이터가 없거나 xlsx 가 아니면 실패', async () => {
    const empty = parseSheet(PART_SPEC, [{ name: 'S', rows: [['모델품번', '파츠품번']] }]);
    expect(empty).toMatchObject({
      status: 'failed',
      errors: [{ message: '데이터 행이 없습니다' }],
    });
    await expect(readWorkbook(Buffer.from('not a zip'))).rejects.toBeInstanceOf(WorkbookReadError);
    expect(() => pickSheet([], [])).toThrow(WorkbookReadError);
    expect(
      pickSheet(
        [
          { name: 'a', rows: [] },
          { name: 'raw', rows: [] },
        ],
        ['RAW'],
      ).name,
    ).toBe('raw');
  });
});
