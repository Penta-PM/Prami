import { describe, expect, it } from 'vitest';

import type { MoneyValue } from '@/lib/table/compare';
import {
  asciiLowerText,
  type ColumnFilterDef,
  describeCondition,
  type FilterAccessors,
  type FilterCondition,
  filterRows,
  groupConditions,
  isMoneyRangeActive,
  matchesFilters,
  OPS_BY_KIND,
  parseFilterParams,
  serializeFilters,
  withFilters,
  withFiltersQuery,
  withoutColumn,
} from '@/lib/table/filter';

const DEFS = {
  name: { kind: 'text' },
  status: {
    kind: 'enum',
    options: [
      { value: 'active', label: '운영중' },
      { value: 'inactive', label: '미사용' },
    ],
  },
  qty: { kind: 'number' },
  currency: {
    kind: 'enum',
    options: [
      { value: 'KRW', label: 'KRW' },
      { value: 'USD', label: 'USD' },
    ],
  },
  price: { kind: 'money', currencyCol: 'currency' },
  from: { kind: 'date' },
} satisfies Record<string, ColumnFilterDef>;

describe('OPS_BY_KIND', () => {
  it('열 종류별 연산자(첫 항목이 기본)', () => {
    expect(OPS_BY_KIND.text).toEqual(['has', 'eq']);
    expect(OPS_BY_KIND.enum).toEqual(['in']);
    expect(OPS_BY_KIND.money).toEqual(['gte', 'lte']);
  });
});

describe('parseFilterParams', () => {
  it('정상 조건을 defs 순 → 연산자 순으로 받는다', () => {
    const params = new URLSearchParams(
      'f.from.lte=2025-12-31&f.name.has=abc&f.status.in=active,inactive&f.from.gte=2025-01-01&f.qty.gte=1.5',
    );
    expect(parseFilterParams(params, DEFS)).toEqual([
      { col: 'name', op: 'has', value: 'abc' },
      { col: 'status', op: 'in', values: ['active', 'inactive'] },
      { col: 'qty', op: 'gte', value: '1.5' },
      { col: 'from', op: 'gte', value: '2025-01-01' },
      { col: 'from', op: 'lte', value: '2025-12-31' },
    ]);
  });

  it('화이트리스트 밖 열·연산자·주입 키는 무시', () => {
    const params = new URLSearchParams();
    params.set('f.x;drop.has', '1');
    params.set('f.price.like', '%a%');
    params.set('f.unknown.has', 'a');
    params.set('f.constructor.has', 'a');
    params.set('f.__proto__.has', 'a');
    params.set('f.name.in', 'a'); // text 에 in 불가
    params.set('f.qty.has', '1'); // number 에 has 불가
    params.set('F.name.has', 'a');
    params.set('f.name.has.x', 'a');
    params.set('sort', 'name');
    expect(parseFilterParams(params, DEFS)).toEqual([]);
  });

  it('Record 파라미터도 받고, 같은 열+연산자는 마지막 값', () => {
    expect(parseFilterParams({ 'f.name.has': ['a', 'b'], q: 'x' }, DEFS)).toEqual([
      { col: 'name', op: 'has', value: 'b' },
    ]);
    const sp = new URLSearchParams('f.name.has=a&f.name.has=c');
    expect(parseFilterParams(sp, DEFS)).toEqual([{ col: 'name', op: 'has', value: 'c' }]);
  });

  it('값 101자·in 21개·빈 값은 그 조건만 버린다', () => {
    const many = Array.from({ length: 21 }, () => 'active').join(',');
    const params = new URLSearchParams();
    params.set('f.name.has', 'a'.repeat(101));
    params.set('f.name.eq', 'a'.repeat(100));
    params.set('f.status.in', many);
    params.set('f.qty.gte', '   ');
    params.set('f.qty.lte', '10');
    expect(parseFilterParams(params, DEFS)).toEqual([
      { col: 'name', op: 'eq', value: 'a'.repeat(100) },
      { col: 'qty', op: 'lte', value: '10' },
    ]);
    // 20개는 허용(중복 제거)
    const twenty = Array.from({ length: 20 }, () => 'active').join(',');
    expect(parseFilterParams({ 'f.status.in': twenty }, DEFS)).toEqual([
      { col: 'status', op: 'in', values: ['active'] },
    ]);
  });

  it('조건 11개 → 순서상 앞 10개만', () => {
    const defs: Record<string, ColumnFilterDef> = {};
    const params = new URLSearchParams();
    for (const c of 'abcdefghijk') {
      defs[c] = { kind: 'text' };
      params.set(`f.${c}.has`, c);
    }
    const out = parseFilterParams(params, defs);
    expect(out).toHaveLength(10);
    expect(out.map((cond) => cond.col).join('')).toBe('abcdefghij');
  });

  it('잘못된 날짜·숫자는 버린다', () => {
    for (const bad of [
      '2025-02-30',
      '2025-13-01',
      '2025-1-1',
      '20250101',
      '2025-01-01T00:00',
      'x',
    ]) {
      expect(parseFilterParams({ 'f.from.gte': bad }, DEFS)).toEqual([]);
    }
    expect(parseFilterParams({ 'f.from.gte': '2024-02-29' }, DEFS)).toHaveLength(1);
    for (const bad of ['1e3', '0x10', 'Infinity', 'NaN', '1,000', '.5', '1.', '--1', 'abc']) {
      expect(parseFilterParams({ 'f.qty.gte': bad }, DEFS)).toEqual([]);
    }
    expect(parseFilterParams({ 'f.qty.gte': '-12.25', 'f.price.lte': ' 1000 ' }, DEFS)).toEqual([
      { col: 'qty', op: 'gte', value: '-12.25' },
      { col: 'price', op: 'lte', value: '1000' },
    ]);
  });

  it('enum 값은 options 안에서만 (하나라도 밖이면 조건 버림)', () => {
    expect(parseFilterParams({ 'f.status.in': 'active,deleted' }, DEFS)).toEqual([]);
    expect(parseFilterParams({ 'f.status.in': 'Active' }, DEFS)).toEqual([]);
    expect(parseFilterParams({ 'f.status.in': 'active,,inactive' }, DEFS)).toEqual([]);
    expect(parseFilterParams({ 'f.status.in': 'inactive' }, DEFS)).toEqual([
      { col: 'status', op: 'in', values: ['inactive'] },
    ]);
  });
});

describe('serializeFilters / withFilters', () => {
  const conds: FilterCondition[] = [
    { col: 'name', op: 'has', value: 'a b&c' },
    { col: 'status', op: 'in', values: ['active', 'inactive'] },
    { col: 'from', op: 'gte', value: '2025-01-01' },
  ];

  it('직렬화 → 파싱 왕복', () => {
    expect(serializeFilters(conds)).toEqual([
      ['f.name.has', 'a b&c'],
      ['f.status.in', 'active,inactive'],
      ['f.from.gte', '2025-01-01'],
    ]);
    const qs = new URLSearchParams(serializeFilters(conds)).toString();
    expect(parseFilterParams(new URLSearchParams(qs), DEFS)).toEqual(conds);
  });

  it('쉼표가 든 in 값·잘못된 열 id 는 직렬화하지 않는다', () => {
    expect(
      serializeFilters([
        { col: 'status', op: 'in', values: ['a,b'] },
        { col: 'x;drop', op: 'has', value: '1' },
      ]),
    ).toEqual([]);
  });

  it('기존 f.* 교체, page 제거, 무관 파라미터 유지, sort·dir 맨 뒤', () => {
    const current = new URLSearchParams(
      'sort=name&dir=desc&family=isign&f.old.has=x&page=3&q=hello&f.name.eq=y',
    );
    const next = withFilters(current, conds);
    expect(next.toString()).toBe(
      'family=isign&q=hello&f.name.has=a+b%26c&f.status.in=active%2Cinactive&f.from.gte=2025-01-01&sort=name&dir=desc',
    );
    // 원본은 변하지 않는다
    expect(current.get('page')).toBe('3');
  });

  it('dir 이 sort 보다 앞에 있어도 sort, dir 순으로 맨 뒤', () => {
    expect(withFilters('dir=asc&sort=qty&q=1', []).toString()).toBe('q=1&sort=qty&dir=asc');
  });

  it('조건 비우기 + 쿼리스트링 헬퍼', () => {
    expect(withFiltersQuery({ 'f.name.has': 'a', page: '2' }, [])).toBe('');
    expect(withFiltersQuery({ family: 'x' }, [{ col: 'qty', op: 'lte', value: '5' }])).toBe(
      '?family=x&f.qty.lte=5',
    );
  });
});

type Row = {
  name: string | null;
  status: string;
  qty: number | null;
  price: MoneyValue | null;
  from: string | Date | null;
  tags: string[];
};

const ACC: FilterAccessors<Row> = {
  name: (r) => r.name,
  status: (r) => r.status,
  qty: (r) => r.qty,
  currency: (r) => r.price?.currency ?? null,
  price: (r) => r.price,
  from: (r) => r.from,
};

function row(partial: Partial<Row>): Row {
  return {
    name: 'ABC',
    status: 'active',
    qty: 10,
    price: { amount: 1000, currency: 'KRW' },
    from: '2025-06-01',
    tags: [],
    ...partial,
  };
}

const has = (value: string): FilterCondition => ({ col: 'name', op: 'has', value });
const eq = (value: string): FilterCondition => ({ col: 'name', op: 'eq', value });

describe('matchesFilters', () => {
  it('asciiLowerText 는 A-Z 만 소문자로', () => {
    expect(asciiLowerText('ABCÄİ')).toBe('abcÄİ');
  });

  it('text has/eq — ASCII 소문자화만', () => {
    expect(matchesFilters(row({}), [has('b')], ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({}), [has('Bc')], ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({}), [eq('abc')], ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({}), [eq('ab')], ACC, DEFS)).toBe(false);
    // 'Ä' 는 소문자화하지 않는다
    expect(matchesFilters(row({ name: 'ÄRGER' }), [has('ä')], ACC, DEFS)).toBe(false);
    expect(matchesFilters(row({ name: 'ÄRGER' }), [has('Är')], ACC, DEFS)).toBe(true);
  });

  it('빈 값은 어떤 조건에도 맞지 않는다', () => {
    for (const name of [null, '', '  ', '—']) {
      expect(matchesFilters(row({ name }), [has('')], ACC, DEFS)).toBe(false);
      expect(matchesFilters(row({ name }), [eq('—')], ACC, DEFS)).toBe(false);
    }
    expect(
      matchesFilters(row({ qty: null }), [{ col: 'qty', op: 'lte', value: '100' }], ACC, DEFS),
    ).toBe(false);
    expect(
      matchesFilters(row({ qty: Number.NaN }), [{ col: 'qty', op: 'gte', value: '0' }], ACC, DEFS),
    ).toBe(false);
    expect(
      matchesFilters(
        row({ from: null }),
        [{ col: 'from', op: 'lte', value: '2030-01-01' }],
        ACC,
        DEFS,
      ),
    ).toBe(false);
    expect(
      matchesFilters(row({ status: '' }), [{ col: 'status', op: 'in', values: [''] }], ACC, DEFS),
    ).toBe(false);
  });

  it('enum in = 포함 여부, 배열 값은 하나라도 겹치면', () => {
    const cond: FilterCondition = { col: 'status', op: 'in', values: ['inactive'] };
    expect(matchesFilters(row({}), [cond], ACC, DEFS)).toBe(false);
    expect(matchesFilters(row({ status: 'inactive' }), [cond], ACC, DEFS)).toBe(true);
    const defs = { tags: DEFS.status };
    const acc: FilterAccessors<Row> = { tags: (r) => r.tags };
    expect(
      matchesFilters(row({ tags: ['active', 'inactive'] }), [{ ...cond, col: 'tags' }], acc, defs),
    ).toBe(true);
    expect(matchesFilters(row({ tags: [] }), [{ ...cond, col: 'tags' }], acc, defs)).toBe(false);
  });

  it('number gte/lte (경계 포함)', () => {
    const range: FilterCondition[] = [
      { col: 'qty', op: 'gte', value: '10' },
      { col: 'qty', op: 'lte', value: '20.5' },
    ];
    expect(matchesFilters(row({ qty: 10 }), range, ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({ qty: 20.5 }), range, ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({ qty: 9.99 }), range, ACC, DEFS)).toBe(false);
    expect(matchesFilters(row({ qty: 21 }), range, ACC, DEFS)).toBe(false);
  });

  it('date gte/lte — ISO 문자열·Date(KST 날짜)', () => {
    const range: FilterCondition[] = [
      { col: 'from', op: 'gte', value: '2025-01-01' },
      { col: 'from', op: 'lte', value: '2025-12-31' },
    ];
    expect(matchesFilters(row({ from: '2025-01-01' }), range, ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({ from: '2025-12-31' }), range, ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({ from: '2026-01-01' }), range, ACC, DEFS)).toBe(false);
    // 2024-12-31T15:00Z = KST 2025-01-01 00:00
    expect(matchesFilters(row({ from: new Date('2024-12-31T15:00:00Z') }), range, ACC, DEFS)).toBe(
      true,
    );
    expect(matchesFilters(row({ from: new Date('2024-12-31T14:59:59Z') }), range, ACC, DEFS)).toBe(
      false,
    );
    expect(matchesFilters(row({ from: 'not a date' }), range, ACC, DEFS)).toBe(false);
  });

  it('money 범위 — 통화가 하나로 정해졌을 때만 활성, 그 통화 행만 금액 비교', () => {
    const gte: FilterCondition = { col: 'price', op: 'gte', value: '500' };
    const usd = row({ price: { amount: 10, currency: 'USD' } });
    const krwLow = row({ price: { amount: 100, currency: 'KRW' } });

    // 통화 조건 없음 → 범위 무시(모두 통과)
    expect(isMoneyRangeActive([gte], DEFS.price)).toBe(false);
    expect(filterRows([usd, krwLow], [gte], ACC, DEFS)).toEqual([usd, krwLow]);

    // 통화 2개 선택 → 여전히 비활성
    const two: FilterCondition = { col: 'currency', op: 'in', values: ['KRW', 'USD'] };
    expect(isMoneyRangeActive([gte, two], DEFS.price)).toBe(false);
    expect(filterRows([usd, krwLow], [two, gte], ACC, DEFS)).toEqual([usd, krwLow]);

    // KRW 하나 → 활성, KRW 행만 금액 비교
    const krw: FilterCondition = { col: 'currency', op: 'in', values: ['KRW'] };
    expect(isMoneyRangeActive([gte, krw], DEFS.price)).toBe(true);
    const krwHigh = row({ price: { amount: 1000, currency: 'KRW' } });
    expect(filterRows([usd, krwLow, krwHigh], [krw, gte], ACC, DEFS)).toEqual([krwHigh]);
    // eq 로 통화를 정해도 활성 — 다른 통화 행은 금액을 비교하지 않는다
    expect(
      matchesFilters(usd, [gte, { col: 'currency', op: 'eq', value: 'KRW' }], ACC, {
        ...DEFS,
        currency: { kind: 'text' },
      }),
    ).toBe(false);

    // 통화 열이 없는 money 는 항상 활성
    expect(isMoneyRangeActive([gte], { kind: 'money' })).toBe(true);
    expect(isMoneyRangeActive([], { kind: 'number' })).toBe(true);
  });

  it('금액 접근자가 숫자만 주면 통화 열 값으로 통화를 본다', () => {
    const acc: FilterAccessors<Row> = { ...ACC, price: (r) => r.price?.amount ?? null };
    const krw: FilterCondition = { col: 'currency', op: 'in', values: ['KRW'] };
    const gte: FilterCondition = { col: 'price', op: 'gte', value: '500' };
    expect(matchesFilters(row({}), [krw, gte], acc, DEFS)).toBe(true);
    expect(
      matchesFilters(row({ price: { amount: 100, currency: 'KRW' } }), [krw, gte], acc, DEFS),
    ).toBe(false);
  });

  it('모든 조건 AND, defs·접근자 없는 열은 불일치', () => {
    const conds: FilterCondition[] = [has('a'), { col: 'qty', op: 'gte', value: '5' }];
    expect(matchesFilters(row({}), conds, ACC, DEFS)).toBe(true);
    expect(matchesFilters(row({ qty: 1 }), conds, ACC, DEFS)).toBe(false);
    expect(matchesFilters(row({ name: 'zzz' }), conds, ACC, DEFS)).toBe(false);
    expect(matchesFilters(row({}), [{ col: 'nope', op: 'has', value: 'a' }], ACC, DEFS)).toBe(
      false,
    );
    expect(matchesFilters(row({}), [], ACC, DEFS)).toBe(true);
  });
});

describe('칩 표시', () => {
  it('groupConditions — 열별로 묶고 연산자 순', () => {
    const groups = groupConditions([
      { col: 'from', op: 'lte', value: '2025-12-31' },
      has('a'),
      { col: 'from', op: 'gte', value: '2025-01-01' },
    ]);
    expect(groups.map((g) => g.col)).toEqual(['from', 'name']);
    expect(groups[0]?.conds.map((c) => c.op)).toEqual(['gte', 'lte']);
  });

  it('describeCondition 문구', () => {
    expect(describeCondition(has('abc'), '품목명', DEFS.name)).toBe('품목명: "abc" 포함');
    expect(describeCondition(eq('abc'), '품목명', DEFS.name)).toBe('품목명: "abc" 같음');
    expect(
      describeCondition(
        { col: 'status', op: 'in', values: ['active', 'inactive'] },
        '상태',
        DEFS.status,
      ),
    ).toBe('상태: 운영중, 미사용');
    expect(
      describeCondition({ col: 'price', op: 'gte', value: '1000' }, '판매가', DEFS.price),
    ).toBe('판매가: ≥ 1,000');
    expect(describeCondition({ col: 'qty', op: 'lte', value: '2.5' }, '수량', DEFS.qty)).toBe(
      '수량: ≤ 2.5',
    );
    expect(
      describeCondition({ col: 'from', op: 'gte', value: '2025-01-01' }, '적용시작일', DEFS.from),
    ).toBe('적용시작일: 2025-01-01 ~');
    expect(
      describeCondition({ col: 'from', op: 'lte', value: '2025-12-31' }, '적용시작일', DEFS.from),
    ).toBe('적용시작일: ~ 2025-12-31');
    const [group] = groupConditions([
      { col: 'from', op: 'lte', value: '2025-12-31' },
      { col: 'from', op: 'gte', value: '2025-01-01' },
    ]);
    expect(describeCondition(group!.conds, '적용시작일', DEFS.from)).toBe(
      '적용시작일: 2025-01-01 ~ 2025-12-31',
    );
    expect(
      describeCondition(
        [
          { col: 'price', op: 'gte', value: '1000' },
          { col: 'price', op: 'lte', value: '5000' },
        ],
        '판매가',
        DEFS.price,
      ),
    ).toBe('판매가: 1,000 ~ 5,000');
  });

  it('withoutColumn — 칩 × 는 그 열 조건 전부 해제', () => {
    const conds: FilterCondition[] = [
      has('a'),
      { col: 'from', op: 'gte', value: '2025-01-01' },
      { col: 'from', op: 'lte', value: '2025-12-31' },
    ];
    expect(withoutColumn(conds, 'from')).toEqual([has('a')]);
  });
});
