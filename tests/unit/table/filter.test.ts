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
  hasControlChar,
  isMoneyRangeActive,
  joinInValues,
  matchesFilters,
  OPS_BY_KIND,
  parseFilterParams,
  serializeFilters,
  splitInValues,
  validateCondition,
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
    const many = Array.from({ length: 21 }, (_, i) => `v${i}`).join(',');
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

  it('쉼표가 든 in 값은 백슬래시로 이스케이프해 직렬화(Plan §7), 잘못된 열 id 는 직렬화하지 않는다', () => {
    expect(
      serializeFilters([
        { col: 'status', op: 'in', values: ['a,b'] },
        { col: 'x;drop', op: 'has', value: '1' },
      ]),
    ).toEqual([['f.status.in', 'a\\,b']]);
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

describe('in 값 백슬래시 이스케이프 (스펙 §2.2 개정, Plan §7)', () => {
  const defs = {
    priceType: {
      kind: 'enum',
      options: [
        { value: 'Standby,DR', label: 'Standby,DR' },
        { value: 'a\\b', label: 'a\\b' },
        { value: 'ASP', label: 'ASP' },
      ],
    },
    remark: { kind: 'text' },
  } as const satisfies Record<string, ColumnFilterDef>;

  it('splitInValues / joinInValues 왕복 — 값 안의 , 와 \\ 를 이스케이프', () => {
    const values = ['Standby,DR', 'a\\b', 'ASP', ''];
    expect(joinInValues(values)).toBe('Standby\\,DR,a\\\\b,ASP,');
    expect(splitInValues(joinInValues(values))).toEqual(values);
    // 기존 URL(쉼표·백슬래시 없는 값)은 그대로 같은 뜻
    expect(splitInValues('운영중,미사용')).toEqual(['운영중', '미사용']);
  });

  it('그 밖의 \\x·끝의 홀로 남은 \\ 는 형식 오류 → 그 조건만 버림', () => {
    expect(splitInValues('a\\xb')).toBeUndefined();
    expect(splitInValues('abc\\')).toBeUndefined();
    expect(
      parseFilterParams({ 'f.priceType.in': 'Standby\\xDR', 'f.remark.has': 'r' }, defs),
    ).toEqual([{ col: 'remark', op: 'has', value: 'r' }]);
  });

  it('URL 왕복: 쉼표·백슬래시 값을 고른 조건이 그대로 돌아온다(URLSearchParams 인코딩 포함)', () => {
    const conds = [{ col: 'priceType', op: 'in', values: ['Standby,DR', 'a\\b'] }] as const;
    const query = withFiltersQuery('', conds as unknown as FilterCondition[]);
    expect(query).toContain('Standby%5C%2CDR');
    expect(parseFilterParams(new URLSearchParams(query.slice(1)), defs)).toEqual(conds);
  });

  it('한도는 언이스케이프한 값 기준 — 이스케이프로 길어져도 100자 이하면 유지', () => {
    const value = `${','.repeat(60)}`;
    const longDefs = {
      priceType: { kind: 'enum', options: [{ value, label: 'commas' }] },
    } as const satisfies Record<string, ColumnFilterDef>;
    const raw = joinInValues([value]);
    expect(raw.length).toBe(120);
    expect(parseFilterParams({ 'f.priceType.in': raw }, longDefs)).toEqual([
      { col: 'priceType', op: 'in', values: [value] },
    ]);
  });
});

describe('제어 문자 값 (BL-1, QA #57 백로그 — NUL 값 → 500)', () => {
  it('hasControlChar: C0(U+0000–U+001F, 탭·줄바꿈 포함)·DEL(U+007F) 만', () => {
    for (const ch of ['\u0000', '\u0001', '\t', '\n', '\r', '\u001F', '\u007F'])
      expect(hasControlChar(`a${ch}b`)).toBe(true);
    for (const value of ['abc', 'a b', '가격', '\u0080', '\u00A0', '—', '\\0', '%00'])
      expect(hasControlChar(value)).toBe(false);
  });

  it('URL 코덱: f.<text>.has=%00abc 등 제어 문자 값은 그 조건만 버리고 나머지는 유지', () => {
    const params = new URLSearchParams(
      'f.name.has=%00abc&f.name.eq=ok&f.qty.gte=1%7F&f.qty.lte=10&f.status.in=active,%01inactive',
    );
    expect(params.get('f.name.has')).toBe('\u0000abc');
    expect(parseFilterParams(params, DEFS)).toEqual([
      { col: 'name', op: 'eq', value: 'ok' },
      { col: 'qty', op: 'lte', value: '10' },
    ]);
  });

  it('앞뒤 탭·줄바꿈도 trim 으로 지우지 않고 형식 오류(값 전체를 버림)', () => {
    for (const value of ['\tabc', 'abc\n', 'a\u0000']) {
      expect(validateCondition({ col: 'name', op: 'has', value }, DEFS)).toBeUndefined();
      expect(parseFilterParams({ 'f.name.has': value }, DEFS)).toEqual([]);
    }
    expect(validateCondition({ col: 'name', op: 'has', value: ' abc ' }, DEFS)).toEqual({
      col: 'name',
      op: 'has',
      value: 'abc',
    });
  });
});

describe('필터 값 경계 (table-column-filter §7 Q1 A)', () => {
  const MANY = Array.from({ length: 25 }, (_, i) => `o${i}`);
  const BOUNDARY_DEFS = {
    name: { kind: 'text' },
    qty: { kind: 'number' },
    from: { kind: 'date' },
    tag: { kind: 'enum', options: MANY.map((value) => ({ value, label: value })) },
    spaced: { kind: 'enum', options: [{ value: ' 앞뒤 공백 ', label: '공백' }] },
  } satisfies Record<string, ColumnFilterDef>;

  it('a) 모든 종류 앞뒤 공백을 지우고 검증 — 날짜 " 2026-10-19 "·숫자 " 7 "·텍스트·in 값', () => {
    expect(
      parseFilterParams(
        {
          'f.name.has': '  abc  ',
          'f.qty.gte': ' 7 ',
          'f.from.gte': ' 2026-10-19',
          'f.from.lte': '2026-10-20 ',
          'f.tag.in': ' o1 , o2',
        },
        BOUNDARY_DEFS,
      ),
    ).toEqual([
      { col: 'name', op: 'has', value: 'abc' },
      { col: 'qty', op: 'gte', value: '7' },
      { col: 'from', op: 'gte', value: '2026-10-19' },
      { col: 'from', op: 'lte', value: '2026-10-20' },
      { col: 'tag', op: 'in', values: ['o1', 'o2'] },
    ]);
    // 선택지 자체가 공백을 품으면 정확히 같은 값은 그대로 통과
    expect(parseFilterParams({ 'f.spaced.in': ' 앞뒤 공백 ' }, BOUNDARY_DEFS)).toEqual([
      { col: 'spaced', op: 'in', values: [' 앞뒤 공백 '] },
    ]);
  });

  it('b) 100자 한도는 trim·언이스케이프 뒤 길이로', () => {
    const hundred = 'a'.repeat(100);
    expect(parseFilterParams({ 'f.name.has': `  ${hundred}  ` }, BOUNDARY_DEFS)).toEqual([
      { col: 'name', op: 'has', value: hundred },
    ]);
    expect(parseFilterParams({ 'f.name.has': ` ${hundred}a ` }, BOUNDARY_DEFS)).toEqual([]);
    // 언이스케이프 뒤 100자(쉼표 이스케이프로 URL 은 더 길다) + 앞뒤 공백 → 유지
    const comma = `${'b'.repeat(49)},${'c'.repeat(50)}`;
    const defs = {
      t: { kind: 'enum', options: [{ value: comma, label: 'c' }] },
    } satisfies Record<string, ColumnFilterDef>;
    expect(parseFilterParams({ 'f.t.in': ` ${joinInValues([comma])} ` }, defs)).toEqual([
      { col: 't', op: 'in', values: [comma] },
    ]);
    expect(validateCondition({ col: 't', op: 'in', values: [`${comma}x`] }, defs)).toBeUndefined();
  });

  it('c) in 20개 한도는 중복 제거(조용히 합침) 뒤 개수로', () => {
    const twenty = MANY.slice(0, 20);
    const withDupes = [...twenty, ...twenty, ' o0 '].join(',');
    expect(parseFilterParams({ 'f.tag.in': withDupes }, BOUNDARY_DEFS)).toEqual([
      { col: 'tag', op: 'in', values: twenty },
    ]);
    expect(parseFilterParams({ 'f.tag.in': MANY.slice(0, 21).join(',') }, BOUNDARY_DEFS)).toEqual(
      [],
    );
  });

  it('d) 0000–0099 년 날짜는 거부(현재 동작 유지), 0100 년부터 허용', () => {
    for (const value of ['0000-01-01', '0001-01-01', '0050-06-15', '0099-12-31', ' 0099-12-31 '])
      expect(parseFilterParams({ 'f.from.gte': value }, BOUNDARY_DEFS)).toEqual([]);
    expect(parseFilterParams({ 'f.from.gte': '0100-01-01' }, BOUNDARY_DEFS)).toEqual([
      { col: 'from', op: 'gte', value: '0100-01-01' },
    ]);
  });
});
