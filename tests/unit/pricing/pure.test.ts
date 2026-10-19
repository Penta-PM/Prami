// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { columnsFor, PRICE_TABLE_COLUMNS } from '@/features/pricing/columns';
import { activeYear, filterToQuery, parsePriceFilter, yearRange } from '@/features/pricing/filter';
import { EMPTY_POLICY_FORM, formFromRow, formToInput } from '@/features/pricing/policy-form';
import { formatAmount, priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { operationYearsLabel, periodLabel, previousDay } from '@/lib/pricing/period';

describe('적용기간·운영 연도 (§4.4.4, AC-13)', () => {
  it('2022-04-01 ~ (2026-01-01 배타) → 2022-04-01 ~ 2025-12-31 / 2022 ~ 2025', () => {
    expect(periodLabel('2022-04-01', '2026-01-01')).toBe('2022-04-01 ~ 2025-12-31');
    expect(operationYearsLabel('2022-04-01', '2026-01-01')).toBe('2022 ~ 2025');
  });

  it('종료일 없음 → ~ 현재, 같은 연도면 연도 하나', () => {
    expect(periodLabel('2026-01-01', null)).toBe('2026-01-01 ~ 현재');
    // r4 §4.4.7: 원가 같은 날짜 중복의 앞 행은 종료일 = 시작일(기간 0일) → 없음
    expect(periodLabel('2025-01-01', '2025-01-01')).toBe('없음');
    expect(operationYearsLabel('2026-01-01', null)).toBe('2026 ~ 현재');
    expect(operationYearsLabel('2024-03-01', '2024-09-01')).toBe('2024');
    expect(operationYearsLabel('2024-03-01', '2025-01-01')).toBe('2024');
    expect(previousDay('2024-03-01')).toBe('2024-02-29');
  });
});

describe('판매가 표시 (§4.5.3)', () => {
  it('KRW 12,000,000원 · USD 126 USD · JPY 168,000 JPY · 단가유형 NULL → —', () => {
    expect(priceLabel('12000000.00', 'KRW')).toBe('12,000,000원');
    expect(priceLabel('126.00', 'USD')).toBe('126 USD');
    expect(priceLabel(168000, 'JPY')).toBe('168,000 JPY');
    expect(formatAmount('abc')).toBe('abc');
    expect(priceTypeLabel(null)).toBe('—');
  });
});

describe('PRICE_TABLE_COLUMNS (AC-12, R-03·R-12)', () => {
  const labels = (mode: 'view' | 'admin') => columnsFor(mode).map((column) => column.label);

  it('조회 표 순서', () => {
    expect(labels('view')).toEqual([
      '단가 유형',
      '대분류',
      '중분류',
      '소분류',
      '품목명',
      '판매가',
      '적용기간',
      '가격 변동',
      '품목상태',
      '상태',
      '비고',
    ]);
  });

  it('관리 표 = 조회 표 + 적용시작일(판매가 뒤)·운영 연도(적용기간 뒤)·관리(끝) 외 동일', () => {
    const admin = labels('admin');
    expect(admin).toEqual([
      '단가 유형',
      '대분류',
      '중분류',
      '소분류',
      '품목명',
      '판매가',
      '적용시작일',
      '적용기간',
      '운영 연도',
      '가격 변동',
      '품목상태',
      '상태',
      '비고',
      '관리',
    ]);
    expect(admin.filter((label) => !['적용시작일', '운영 연도', '관리'].includes(label))).toEqual(
      labels('view'),
    );
    // 공용 배열 15 = 관리 14 + 원가 비중(관리 표 + cost.read 일 때만, columnsFor('admin', true))
    expect(PRICE_TABLE_COLUMNS).toHaveLength(15);
    expect(PRICE_TABLE_COLUMNS.filter((column) => column.cost).map((column) => column.key)).toEqual(
      ['costRatio'],
    );
  });
});

describe('필터 URL 상태 (§4.5.1·§4.5.2)', () => {
  it('기본값·전체·잘못된 값 정규화, 상위 분류 없으면 하위 무시', () => {
    expect(parsePriceFilter({})).toEqual({
      filter: { dateMode: 'start', page: 1 },
      errors: {},
    });
    const { filter } = parsePriceFilter({ mid: 'Parts', minor: 'NIC', major: '전체', page: 'x' });
    expect(filter).toMatchObject({ major: undefined, mid: undefined, minor: undefined, page: 1 });
  });

  it('from > to 는 폼 오류, 날짜 조건 미적용 / 잘못된 날짜 형식 오류', () => {
    const swapped = parsePriceFilter({ from: '2024-12-31', to: '2024-01-01' });
    expect(swapped.errors.to).toContain('종료일');
    expect(swapped.filter.from).toBeUndefined();
    expect(parsePriceFilter({ from: '2024-13-01' }).errors.from).toContain('형식');
  });

  it('쿼리스트링 왕복·연도 칩', () => {
    const query = filterToQuery({
      major: 'WAPPLES',
      mid: 'Parts',
      minor: 'NIC',
      dateMode: 'period',
      ...yearRange(2024),
      q: 'H500',
      page: 2,
    });
    expect(query).toBe(
      '?major=WAPPLES&mid=Parts&minor=NIC&dateMode=period&from=2024-01-01&to=2024-12-31&q=H500&page=2',
    );
    const parsed = parsePriceFilter(Object.fromEntries(new URLSearchParams(query.slice(1))));
    expect(parsed.filter).toMatchObject({ dateMode: 'period', from: '2024-01-01', page: 2 });
    expect(activeYear(parsed.filter)).toBe(2024);
    expect(activeYear({ from: '2024-01-01', to: '2024-06-30' })).toBeNull();
    expect(filterToQuery({ dateMode: 'start', page: 1 })).toBe('');
  });

  it('정렬 sort·dir 왕복 — 쿼리 맨 뒤, 화이트리스트 밖(id;drop)은 무시 (#32 §3)', () => {
    const { filter } = parsePriceFilter({ q: 'H500', page: '3', sort: 'price', dir: 'desc' });
    expect(filter).toMatchObject({ q: 'H500', page: 3, sort: { id: 'price', dir: 'desc' } });
    const query = filterToQuery(filter);
    expect(query).toBe('?q=H500&page=3&sort=price&dir=desc');
    expect(query.endsWith('&sort=price&dir=desc')).toBe(true);
    const back = parsePriceFilter(Object.fromEntries(new URLSearchParams(query.slice(1))));
    expect(back.filter.sort).toEqual({ id: 'price', dir: 'desc' });
    expect(filterToQuery({ dateMode: 'start', page: 1, sort: { id: 'remark', dir: 'asc' } })).toBe(
      '?sort=remark&dir=asc',
    );
    expect(parsePriceFilter({ sort: 'id;drop', dir: 'asc' }).filter.sort).toBeUndefined();
    expect(parsePriceFilter({ sort: 'actions' }).filter.sort).toBeUndefined();
    expect(parsePriceFilter({ sort: 'itemStatus', dir: 'x' }).filter.sort).toEqual({
      id: 'itemStatus',
      dir: 'asc',
    });
  });
});

describe('등록 모달 폼 변환', () => {
  it('행 → 폼 (사유는 비움), 폼 → 입력 기본값', () => {
    const form = formFromRow({
      productFamily: 'WAPPLES',
      itemCode: 'P1',
      itemName: '품목',
      spec: null,
      unit: 'EA',
      priceType: null,
      priceCategory: '일반',
      currency: 'KRW',
      hasCorePrice: false,
      unitPrice: '12000000.00',
      remark: null,
      effectiveFrom: '2026-01-01',
      appliesToAllCustomers: false,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      customerNo: null,
      customerName: null,
    });
    expect(form).toMatchObject({ unitPrice: '12000000', priceType: '', reason: '' });
    expect(
      formToInput({ ...EMPTY_POLICY_FORM, baseCoreCount: '', unitPricePerCore: '' }),
    ).toMatchObject({ baseCoreCount: '0', unitPricePerCore: '0' });
  });
});

describe('AC-15: 소스에 "신규등록" 문자열이 없다 (R-10)', () => {
  it('grep -r "신규등록" src = 0', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (readFileSync(full, 'utf8').includes('신규등록')) hits.push(full);
      }
    };
    walk(path.resolve(process.cwd(), 'src'));
    expect(hits).toEqual([]);
  });
});
