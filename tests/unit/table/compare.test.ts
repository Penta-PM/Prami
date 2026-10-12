// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  compareSortValues,
  compareText,
  isEmptySortValue,
  type MoneyValue,
  type SortValue,
  sortRows,
  STATUS_ORDERS,
} from '@/lib/table/compare';

/** #32 스펙 §2 정렬 규칙 · §7 비교 함수 수용 기준 */
type Row = { id: number; v: SortValue };

const rows = (values: SortValue[]): Row[] => values.map((v, id) => ({ id, v }));
const ids = (list: Row[]) => list.map((row) => row.id);
const vals = (list: Row[]) => list.map((row) => row.v);
const getV = (row: Row) => row.v;

describe('isEmptySortValue', () => {
  it.each<[SortValue]>([
    [null],
    [undefined],
    [''],
    ['   '],
    ['—'],
    [' — '],
    [Number.NaN],
    [new Date('x')],
  ])('%o → 빈 값', (value) => {
    expect(isEmptySortValue(value)).toBe(true);
  });

  it.each<[SortValue]>([[0], ['0'], ['-'], [new Date(0)], [{ amount: 0, currency: 'KRW' }]])(
    '%o → 값 있음',
    (value) => {
      expect(isEmptySortValue(value)).toBe(false);
    },
  );
});

describe('compareText (ASCII 소문자 + 코드포인트)', () => {
  it('ASCII 대소문자를 구분하지 않는다', () => {
    expect(compareText('apple', 'Banana')).toBeLessThan(0);
    expect(compareText('ABC', 'abc')).toBe(0);
  });

  it("'WAPPLES-2700' 이 'WAPPLES-300' 보다 앞 (자연 정렬 아님)", () => {
    expect(compareText('WAPPLES-2700', 'WAPPLES-300')).toBeLessThan(0);
  });

  it('한글은 가나다 순', () => {
    const sorted = ['하나', '가방', '나무', '다리', '가'].sort(compareText);
    expect(sorted).toEqual(['가', '가방', '나무', '다리', '하나']);
  });

  it('비 BMP 문자는 UTF-16 코드 유닛이 아니라 코드포인트로 비교', () => {
    // 코드 유닛으로는 '\uD83D' < '￿' 이지만 코드포인트로는 U+1F600 > U+FFFF
    expect(compareText('\u{1F600}', '￿')).toBeGreaterThan(0);
    expect(compareText('￿', '\u{1F600}')).toBeLessThan(0);
  });

  it('접두사가 같으면 짧은 쪽이 앞', () => {
    expect(compareText('ab', 'abc')).toBeLessThan(0);
    expect(compareText('abc', 'ab')).toBeGreaterThan(0);
  });

  it('ASCII 밖의 대문자(É)는 소문자로 바꾸지 않는다 (서버 COLLATE "C" 와 같은 범위)', () => {
    expect(compareText('É', 'é')).not.toBe(0);
  });
});

describe('compareSortValues', () => {
  it('number: 음수·소수', () => {
    expect(compareSortValues('number', -1.5, 0.25)).toBeLessThan(0);
    expect(compareSortValues('number', 10, 9.99)).toBeGreaterThan(0);
    expect(compareSortValues('number', 3, 3)).toBe(0);
  });

  it('date: Date 와 ISO 문자열을 시각 값으로 비교', () => {
    expect(compareSortValues('date', new Date('2026-01-01'), '2026-01-02T00:00:00Z')).toBeLessThan(
      0,
    );
    expect(
      compareSortValues('date', '2026-10-02T05:03:00Z', new Date('2026-10-02T05:03:00Z')),
    ).toBe(0);
  });

  it('status: 정의 순서, 목록 밖 값은 뒤에서 문자열 순', () => {
    const order = STATUS_ORDERS.partMapping;
    expect(compareSortValues('status', '사용', '미확인', order)).toBeLessThan(0);
    expect(compareSortValues('status', '알수없음', '미확인', order)).toBeGreaterThan(0);
    expect(compareSortValues('status', 'b', 'A', order)).toBeGreaterThan(0);
  });
});

describe('sortRows', () => {
  it('null·undefined·""·"—" 는 오름·내림 모두 맨 뒤 (원래 순서 유지)', () => {
    const input = rows([3, null, 1, '—', undefined, 2, '']);
    expect(ids(sortRows(input, getV, 'number', 'asc'))).toEqual([2, 5, 0, 1, 3, 4, 6]);
    expect(ids(sortRows(input, getV, 'number', 'desc'))).toEqual([0, 5, 2, 1, 3, 4, 6]);
  });

  it('숫자: 음수·소수', () => {
    const input = rows([2.5, -3, 0, 10, -0.5]);
    expect(vals(sortRows(input, getV, 'number', 'asc'))).toEqual([-3, -0.5, 0, 2.5, 10]);
    expect(vals(sortRows(input, getV, 'number', 'desc'))).toEqual([10, 2.5, 0, -0.5, -3]);
  });

  it('날짜: Date 와 ISO 문자열 혼합', () => {
    const input = rows([
      '2026-03-01',
      new Date('2025-12-31T00:00:00Z'),
      '2026-01-15T09:00:00Z',
      null,
    ]);
    expect(ids(sortRows(input, getV, 'date', 'asc'))).toEqual([1, 2, 0, 3]);
    expect(ids(sortRows(input, getV, 'date', 'desc'))).toEqual([0, 2, 1, 3]);
  });

  it('텍스트: 대소문자 무시 + 한글', () => {
    const input = rows(['나무', 'banana', '가방', 'Apple', 'cherry']);
    expect(vals(sortRows(input, getV, 'text', 'asc'))).toEqual([
      'Apple',
      'banana',
      'cherry',
      '가방',
      '나무',
    ]);
  });

  it('통화 혼합: 통화(compareText)로 묶고 같은 통화 안에서 금액순', () => {
    const m = (amount: number, currency: string): MoneyValue => ({ amount, currency });
    const input = rows([m(100, 'USD'), m(5000, 'KRW'), m(20, 'USD'), m(1000, 'KRW'), null]);
    expect(vals(sortRows(input, getV, 'number', 'asc'))).toEqual([
      m(1000, 'KRW'),
      m(5000, 'KRW'),
      m(20, 'USD'),
      m(100, 'USD'),
      null,
    ]);
    // 내림차순은 비교만 뒤집는다 — 통화 묶음 순서도 뒤집힌다
    expect(vals(sortRows(input, getV, 'number', 'desc'))).toEqual([
      m(100, 'USD'),
      m(20, 'USD'),
      m(5000, 'KRW'),
      m(1000, 'KRW'),
      null,
    ]);
  });

  it('상태: STATUS_ORDERS 정의 순서, 모르는 값은 뒤', () => {
    const input = rows(['오류', '성공', '기타', '거부', '성공']);
    expect(ids(sortRows(input, getV, 'status', 'asc', STATUS_ORDERS.auditResult))).toEqual([
      1, 4, 3, 0, 2,
    ]);
    expect(
      vals(sortRows(rows(['미사용', '운영중']), getV, 'status', 'asc', STATUS_ORDERS.pricingState)),
    ).toEqual(['운영중', '미사용']);
    expect(
      vals(sortRows(rows(['USER', 'ADMIN']), getV, 'status', 'asc', STATUS_ORDERS.role)),
    ).toEqual(['ADMIN', 'USER']);
  });

  it('stable: 같은 값은 오름·내림 모두 원래 순서 유지', () => {
    const input = rows(['b', 'a', 'B', 'A', 'a']);
    expect(ids(sortRows(input, getV, 'text', 'asc'))).toEqual([1, 3, 4, 0, 2]);
    expect(ids(sortRows(input, getV, 'text', 'desc'))).toEqual([0, 2, 1, 3, 4]);
  });

  it("type 'none' 은 복사본을 그대로 반환", () => {
    const input = rows([3, 1, 2]);
    const result = sortRows(input, getV, 'none', 'asc');
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input = rows([3, 1, null, 2]);
    const snapshot = [...input];
    const result = sortRows(input, getV, 'number', 'asc');
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });
});
