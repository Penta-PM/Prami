import { describe, expect, it } from 'vitest';

import {
  datePresetRange,
  filterDefsOf,
  filterFieldsOf,
  QUICK_FILTER_FIELDS,
  splitQuickFields,
  summarizeField,
  withQuickFields,
  type DataTableColumn,
  type DataTableFilterField,
} from '@/components/ui/data-table';
import { AUDIT_FILTER_IDS } from '@/features/audit/filter';
import { COST_FILTER_IDS } from '@/features/costs/column-filters';
import { NOTICES_ADMIN_FILTER_DEFS } from '@/features/notices/table-state';
import { PARTS_MAPPING_FILTER_DEFS } from '@/features/parts/table-state';
import { PRICE_FILTER_IDS } from '@/features/pricing/column-filters';
import { USERS_FILTER_DEFS } from '@/features/users/table-state';

/** 빠른 필터 바 공용 헬퍼 (표 열 필터 빠른 필터 바 §2.1·§2.2·§2.3) */
type Row = { id: string };

const field = (
  id: string,
  filter: DataTableFilterField<Row>['filter'],
  quick?: boolean,
): DataTableFilterField<Row> => ({
  id,
  label: id.toUpperCase(),
  filter,
  value: () => null,
  ...(quick ? { quick } : {}),
});

const CURRENCY = field('currency', {
  kind: 'enum',
  options: [
    { value: 'KRW', label: 'KRW' },
    { value: 'USD', label: 'USD' },
  ],
});
const PRICE = field('price', { kind: 'money', currencyCol: 'currency' }, true);
const STATUS = field(
  'status',
  {
    kind: 'enum',
    options: [
      { value: 'a', label: '활성' },
      { value: 'b', label: '비활성' },
      { value: 'c', label: '중지' },
    ],
  },
  true,
);
const NAME = field('name', { kind: 'text' });
const EMPTY_ENUM = field('kind', { kind: 'enum', options: [] }, true);

describe('QUICK_FILTER_FIELDS (§2.2 표별 고정 필드)', () => {
  // 내 견적 목록은 CartPanel 안 열 정의(견적 번호·일자·제품·내용·금액 + 통화)
  const MY_QUOTES_IDS = [
    'quoteNo',
    'createdAt',
    'productFamily',
    'summary',
    'totalAmount',
    'currency',
  ];
  const TABLE_IDS: Record<keyof typeof QUICK_FILTER_FIELDS, readonly string[]> = {
    users: Object.keys(USERS_FILTER_DEFS),
    noticesAdmin: Object.keys(NOTICES_ADMIN_FILTER_DEFS),
    partsMapping: Object.keys(PARTS_MAPPING_FILTER_DEFS),
    myQuotes: MY_QUOTES_IDS,
    pricing: PRICE_FILTER_IDS,
    costs: COST_FILTER_IDS,
    audit: AUDIT_FILTER_IDS,
  };

  it.each(Object.entries(TABLE_IDS))('%s: 고정 필드는 모두 그 표의 필터 필드 id', (table, ids) => {
    const quick = QUICK_FILTER_FIELDS[table as keyof typeof QUICK_FILTER_FIELDS];
    expect(quick.length).toBeGreaterThan(0);
    for (const id of quick) expect(ids).toContain(id);
  });

  it('스펙 표와 같은 고정·＋ 더 구성', () => {
    const rest = (table: keyof typeof QUICK_FILTER_FIELDS) =>
      TABLE_IDS[table].filter(
        (id) => !(QUICK_FILTER_FIELDS[table] as readonly string[]).includes(id),
      );
    expect(rest('users')).toEqual(['email', 'lastLoginAt']);
    expect(rest('noticesAdmin')).toEqual([]);
    expect(rest('partsMapping')).toEqual([]);
    expect(rest('myQuotes')).toEqual(['quoteNo', 'totalAmount', 'currency']);
    expect(rest('pricing')).toEqual(['currency', 'priceChange', 'itemStatus', 'remark']);
    expect(rest('costs')).toEqual(['unit']);
    expect(rest('audit')).toEqual(['target', 'ip']);
  });
});

describe('filter.quick 플래그', () => {
  it('열의 filter.quick 은 필드 quick 으로 옮기고 화이트리스트(ColumnFilterDef)에는 넣지 않는다', () => {
    const columns: DataTableColumn<Row>[] = [
      {
        id: 'name',
        header: '이름',
        type: 'text',
        filter: { kind: 'text', quick: true },
        cell: () => '',
      },
      { id: 'memo', header: '메모', type: 'text', filter: { kind: 'text' }, cell: () => '' },
    ];
    const fields = filterFieldsOf(columns);
    expect(fields.map((f) => [f.id, f.quick])).toEqual([
      ['name', true],
      ['memo', undefined],
    ]);
    expect(filterDefsOf(fields)).toEqual({ name: { kind: 'text' }, memo: { kind: 'text' } });
    // quick 이 없는 열은 정의 객체를 그대로 쓴다(메모 의존 유지)
    expect(fields[1]?.filter).toBe(columns[1]?.filter);
  });

  it('withQuickFields: ids 에 있는 필드만 quick (순서 유지, 원본 불변)', () => {
    const fields = [NAME, CURRENCY];
    const marked = withQuickFields(fields, ['currency']);
    expect(marked.map((f) => [f.id, f.quick ?? false])).toEqual([
      ['name', false],
      ['currency', true],
    ]);
    expect(CURRENCY.quick).toBeUndefined();
  });
});

describe('splitQuickFields', () => {
  const fields = [CURRENCY, PRICE, STATUS, NAME, EMPTY_ENUM];

  it('바 = 고정 + 조건 걸린 필드(필드 순), ＋ 더 = 나머지 중 고를 수 있는 것', () => {
    const none = splitQuickFields(fields, []);
    expect(none.bar.map((f) => f.id)).toEqual(['price', 'status']);
    expect(none.more.map((f) => f.id)).toEqual(['currency', 'name']);

    const active = splitQuickFields(fields, [{ col: 'name', op: 'has', value: 'x' }]);
    expect(active.bar.map((f) => f.id)).toEqual(['price', 'status', 'name']);
    expect(active.more.map((f) => f.id)).toEqual(['currency']);
  });

  it('선택지 없는 enum 은 고정이어도 숨기지만, 조건이 걸려 있으면 바에 보인다(× 로 풀 수 있게)', () => {
    expect(splitQuickFields([EMPTY_ENUM], []).bar).toEqual([]);
    expect(
      splitQuickFields([EMPTY_ENUM], [{ col: 'kind', op: 'in', values: ['x'] }]).bar.map(
        (f) => f.id,
      ),
    ).toEqual(['kind']);
  });
});

describe('summarizeField (버튼 요약·접근성 이름)', () => {
  it('조건 없으면 null, enum 은 쉼표·넘치면 +N, 전체 문구는 모두', () => {
    expect(summarizeField(STATUS, [])).toBeNull();
    expect(summarizeField(STATUS, [{ col: 'status', op: 'in', values: ['b', 'c'] }])).toEqual({
      text: '비활성,중지',
      full: '비활성, 중지',
    });
    expect(summarizeField(STATUS, [{ col: 'status', op: 'in', values: ['a', 'b', 'c'] }])).toEqual({
      text: '활성,비활성 +1',
      full: '활성, 비활성, 중지',
    });
  });

  it('text·range 는 기존 칩 문구 본문', () => {
    expect(summarizeField(NAME, [{ col: 'name', op: 'eq', value: 'kim' }])?.text).toBe(
      '"kim" 같음',
    );
    const date = field('created', { kind: 'date' });
    expect(
      summarizeField(date, [
        { col: 'created', op: 'gte', value: '2026-01-01' },
        { col: 'created', op: 'lte', value: '2026-01-31' },
      ])?.text,
    ).toBe('2026-01-01 ~ 2026-01-31');
  });

  it('money: 통화가 하나로 정해지면 앞에 통화(통화 필드가 ＋ 더에 있어도), 아니면 "(통화 선택 시 적용)"', () => {
    const range = { col: 'price', op: 'gte', value: '1000' } as const;
    expect(
      summarizeField(PRICE, [{ col: 'currency', op: 'in', values: ['KRW'] }, range])?.text,
    ).toBe('KRW ≥ 1,000');
    expect(summarizeField(PRICE, [range])?.text).toBe('≥ 1,000 (통화 선택 시 적용)');
  });
});

describe('datePresetRange (§2.3 날짜 프리셋 — 한국 시간 기준일)', () => {
  // 2026-10-22 01:00 KST = 2026-10-21 16:00 UTC — 기준일은 KST 날짜
  const now = new Date('2026-10-21T16:00:00Z');

  it('오늘·최근 7일·최근 30일·이번 달', () => {
    expect(datePresetRange('today', now)).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(datePresetRange('last7', now)).toEqual({ from: '2026-10-16', to: '2026-10-22' });
    expect(datePresetRange('last30', now)).toEqual({ from: '2026-09-23', to: '2026-10-22' });
    expect(datePresetRange('thisMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('월·연 경계와 윤년', () => {
    const march1 = new Date('2028-03-01T03:00:00Z');
    expect(datePresetRange('last7', march1)).toEqual({ from: '2028-02-24', to: '2028-03-01' });
    expect(datePresetRange('thisMonth', new Date('2028-02-10T03:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(datePresetRange('last30', new Date('2027-01-05T03:00:00Z')).from).toBe('2026-12-07');
  });
});
