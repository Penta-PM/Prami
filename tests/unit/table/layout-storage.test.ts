import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLayout,
  defaultLayout,
  isDefaultLayout,
  type LayoutColumn,
  layoutStorageKey,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  normalizeLayout,
  parseLayout,
  readLayoutRaw,
  subscribeLayout,
  writeLayout,
} from '@/lib/table/layout-storage';

/** #32 스펙 §5 저장 — localStorage(jsdom) 기반 너비·순서 */
const COLUMNS: LayoutColumn[] = [
  { id: 'row', pinned: 'start' },
  { id: 'name' },
  { id: 'email' },
  { id: 'role' },
  { id: 'actions', pinned: 'end' },
];

const KEY = layoutStorageKey('users', 'u-1');

describe('키·기본값', () => {
  it('키 형식', () => {
    expect(layoutStorageKey('pricing-view', 'abc')).toBe('prami:table:pricing-view:v1:abc');
  });

  it('defaultLayout = columns 순서, 너비 없음', () => {
    expect(defaultLayout(COLUMNS)).toEqual({
      order: ['row', 'name', 'email', 'role', 'actions'],
      widths: {},
    });
  });

  it('isDefaultLayout', () => {
    expect(isDefaultLayout(defaultLayout(COLUMNS), COLUMNS)).toBe(true);
    expect(
      isDefaultLayout({ order: ['row', 'email', 'name', 'role', 'actions'], widths: {} }, COLUMNS),
    ).toBe(false);
    expect(isDefaultLayout({ ...defaultLayout(COLUMNS), widths: { name: 100 } }, COLUMNS)).toBe(
      false,
    );
  });
});

describe('normalizeLayout', () => {
  it('모르는 colId·중복을 버린다', () => {
    const result = normalizeLayout(
      { order: ['role', 'ghost', 'role', 'email', 'name'], widths: {} },
      COLUMNS,
    );
    expect(result?.order).toEqual(['row', 'role', 'email', 'name', 'actions']);
  });

  it('새 열은 기본 순서상 바로 앞 열 뒤에, 앞 열이 없으면 맨 앞에 끼운다', () => {
    // 저장 당시 email·name 만 있었고 role 이 새로 생김 → 기본 순서상 앞 열 email 뒤
    expect(normalizeLayout({ order: ['email', 'name'], widths: {} }, COLUMNS)?.order).toEqual([
      'row',
      'email',
      'role',
      'name',
      'actions',
    ]);
    // name(가운데 첫 열)이 새로 생김 → 맨 앞
    expect(normalizeLayout({ order: ['role', 'email'], widths: {} }, COLUMNS)?.order).toEqual([
      'row',
      'name',
      'role',
      'email',
      'actions',
    ]);
  });

  it('고정 열은 저장 순서와 무관하게 start 맨 앞, end 맨 뒤', () => {
    const result = normalizeLayout(
      { order: ['actions', 'email', 'row', 'name', 'role'], widths: {} },
      COLUMNS,
    );
    expect(result?.order).toEqual(['row', 'email', 'name', 'role', 'actions']);
  });

  it('reorderable:false 열은 기본 위치에 고정', () => {
    const columns: LayoutColumn[] = [
      { id: 'a' },
      { id: 'b', reorderable: false },
      { id: 'c' },
      { id: 'd' },
    ];
    expect(normalizeLayout({ order: ['d', 'c', 'b', 'a'], widths: {} }, columns)?.order).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
  });

  it('너비: 모르는 열·유한수 아님 제거, clamp, 정수 반올림, 열별 min/max', () => {
    const columns: LayoutColumn[] = [...COLUMNS, { id: 'memo', minWidth: 120, maxWidth: 300 }];
    const result = normalizeLayout(
      {
        order: [],
        widths: {
          name: 10,
          email: 9999,
          role: 123.6,
          ghost: 200,
          row: 'wide',
          actions: null,
          memo: 50,
        },
      },
      columns,
    );
    expect(result?.widths).toEqual({
      name: MIN_COL_WIDTH,
      email: MAX_COL_WIDTH,
      role: 124,
      memo: 120,
    });
    expect(normalizeLayout({ order: [], widths: { memo: 1000 } }, columns)?.widths).toEqual({
      memo: 300,
    });
  });

  it.each<[unknown]>([
    [null],
    ['x'],
    [42],
    [{ order: 'x' }],
    [{ order: [1, 2] }],
    [{ order: [], widths: [] }],
    [{}],
  ])('형태가 틀리면 null: %o', (raw) => {
    expect(normalizeLayout(raw, COLUMNS)).toBeNull();
  });
});

describe('localStorage 왕복', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('write → read → parse 왕복, clear 로 삭제', () => {
    const layout = { order: ['row', 'role', 'name', 'email', 'actions'], widths: { name: 180 } };
    writeLayout(KEY, layout, COLUMNS);
    expect(parseLayout(readLayoutRaw(KEY), COLUMNS)).toEqual(layout);
    clearLayout(KEY);
    expect(readLayoutRaw(KEY)).toBeNull();
  });

  it('기본 레이아웃을 쓰면 키를 지운다', () => {
    writeLayout(KEY, { order: ['row', 'role', 'name', 'email', 'actions'], widths: {} }, COLUMNS);
    expect(readLayoutRaw(KEY)).not.toBeNull();
    writeLayout(KEY, defaultLayout(COLUMNS), COLUMNS);
    expect(readLayoutRaw(KEY)).toBeNull();
  });

  it('없는 키·손상된 JSON·검증 실패 → null', () => {
    expect(parseLayout(readLayoutRaw(KEY), COLUMNS)).toBeNull();
    expect(parseLayout('{not json', COLUMNS)).toBeNull();
    expect(parseLayout('"string"', COLUMNS)).toBeNull();
  });

  it('localStorage 가 던져도 예외 없이 동작하고 read 는 null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readLayoutRaw(KEY)).toBeNull();
    expect(() => writeLayout(KEY, { order: [], widths: { name: 100 } }, COLUMNS)).not.toThrow();
    expect(() => writeLayout(KEY, defaultLayout(COLUMNS), COLUMNS)).not.toThrow();
    expect(() => clearLayout(KEY)).not.toThrow();
    // 쓰기가 다시 성공하면 메모리 폴백을 비운다 — 다음 테스트로 새지 않게
    vi.restoreAllMocks();
    clearLayout(KEY);
  });

  it('setItem 이 던지면 메모리 폴백으로 이번 탭 안에서 값을 유지하고, 다시 성공하면 저장소로 돌아간다 (#32 §9 Q3)', () => {
    const layout = { order: ['row', 'email', 'name', 'role', 'actions'], widths: { name: 120 } };
    const onChange = vi.fn();
    const unsubscribe = subscribeLayout(KEY, onChange);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    writeLayout(KEY, layout, COLUMNS);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(parseLayout(readLayoutRaw(KEY), COLUMNS)?.widths).toEqual({ name: 120 });

    setItem.mockRestore();
    writeLayout(KEY, { ...layout, widths: { name: 140 } }, COLUMNS);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')?.widths).toEqual({ name: 140 });
    expect(parseLayout(readLayoutRaw(KEY), COLUMNS)?.widths).toEqual({ name: 140 });
    clearLayout(KEY);
    expect(readLayoutRaw(KEY)).toBeNull();
    unsubscribe();
  });
});

describe('subscribeLayout', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('같은 키의 storage 이벤트와 같은 탭 이벤트에 반응, 다른 키는 무시, unsubscribe 후 멈춤', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeLayout(KEY, onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent('storage', { key: 'prami:table:other:v1:u-1' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    writeLayout(KEY, { order: [], widths: { name: 100 } }, COLUMNS);
    expect(onChange).toHaveBeenCalledTimes(2);

    clearLayout(layoutStorageKey('users', 'u-2'));
    expect(onChange).toHaveBeenCalledTimes(2);

    clearLayout(KEY);
    expect(onChange).toHaveBeenCalledTimes(3);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    writeLayout(KEY, { order: [], widths: { name: 120 } }, COLUMNS);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
