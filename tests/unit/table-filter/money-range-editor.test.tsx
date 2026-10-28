import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import {
  DataTableQuickFilterBar,
  MONEY_RANGE_DEBOUNCE_MS,
  type DataTableFilterField,
} from '@/components/ui/data-table';
import type { FilterCondition } from '@/lib/table/filter';
import { moneyCompact, stepValue, valueToStep, type MoneyRange } from '@/lib/table/money-range';

/**
 * money 범위 = 양쪽 슬라이더 (빠른 필터 바 §7.5, 숫자 입력 없음): 통화 라디오 먼저(슬라이더 disabled + 문구), 라디오 = 통화 조건 즉시,
 * 선택지 1개면 미리 선택, 통화 변경 시 범위 초기화, 값 1개뿐·행 없음 문구, 키보드 → 손을 뗀 뒤 400ms 디바운스 적용(팝오버 유지),
 * 양 끝 = 조건 없음, 옛 URL·범위 밖 값은 실제 값 표시 + 움직인 핸들만 다시 기록, 가운데 드래그는 두 핸들 모두 다시 기록.
 */
type Row = { amount: number; currency: string };

const KRW: MoneyRange = { currency: 'KRW', min: 0, max: 1_650_000_000, minPositive: 500 };
const USD: MoneyRange = { currency: 'USD', min: 126, max: 126, minPositive: 126 };

function makeFields(
  currencies: readonly string[] = ['KRW', 'USD'],
  ranges: readonly MoneyRange[] = [KRW, USD],
): DataTableFilterField<Row>[] {
  return [
    {
      id: 'currency',
      label: '통화',
      filter: { kind: 'enum', options: currencies.map((value) => ({ value, label: value })) },
      value: (row) => row.currency,
    },
    {
      id: 'price',
      label: '판매가',
      quick: true,
      filter: { kind: 'money', currencyCol: 'currency' },
      value: (row) => ({ amount: row.amount, currency: row.currency }),
      ranges,
    },
  ];
}

let requests: FilterCondition[][] = [];

function Harness({
  initial = [],
  fields = makeFields(),
  mode = 'server',
}: {
  initial?: FilterCondition[];
  fields?: DataTableFilterField<Row>[];
  mode?: 'client' | 'server';
}) {
  const [filters, setFilters] = useState<readonly FilterCondition[]>(initial);
  return (
    <DataTableQuickFilterBar
      fields={fields}
      filters={filters}
      onFiltersChange={(next) => {
        requests.push([...next]);
        setFilters(next);
      }}
      onReset={() => setFilters([])}
      mode={mode}
      total={10}
    />
  );
}

const KRW_IN: FilterCondition = { col: 'currency', op: 'in', values: ['KRW'] };

const setup = (props: Parameters<typeof Harness>[0] = {}) => {
  render(<Harness {...props} />, { wrapper: MotionProvider });
  fireEvent.click(screen.getByRole('button', { name: /^판매가 필터(,|$)/ }));
  return screen.getByRole('dialog', { name: '판매가 필터' });
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const lower = () => screen.getByRole('slider', { name: '판매가 최소' });
const upper = () => screen.getByRole('slider', { name: '판매가 최대' });
const press = (slider: HTMLElement, key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    fireEvent.keyDown(slider, { key });
    fireEvent.keyUp(slider, { key });
  }
};
const rangeText = () => document.querySelector('[data-money-range-text]')?.textContent;

beforeEach(() => {
  localStorage.clear();
  requests = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('통화 (§7.5 — 라디오 먼저, 즉시 적용)', () => {
  it('통화 미지정: 라디오 + "통화를 먼저 선택하세요" + 슬라이더 disabled, 숫자 입력 없음', () => {
    const dialog = setup();
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['KRW', 'USD']);
    expect(within(dialog).getByText('통화를 먼저 선택하세요')).toBeInTheDocument();
    expect(lower()).toBeDisabled();
    expect(upper()).toBeDisabled();
    expect(lower()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: '적용' })).toBeNull();
  });

  it('라디오 선택 = 통화 조건 즉시 적용(서버 표 디바운스 경로), 팝오버 열린 채 슬라이더 활성 + 로그 눈금 안내', () => {
    const dialog = setup();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'KRW' }));
    expect(lower()).toBeEnabled();
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([[KRW_IN]]);
    expect(screen.getByRole('dialog', { name: '판매가 필터' })).toBeInTheDocument();
    expect(within(dialog).getByText(/로그 눈금/)).toBeInTheDocument();
    expect(lower()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(upper()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(rangeText()).toBe('제한 없음');
  });

  it('선택지가 1개면 미리 선택 — 범위를 기록할 때 통화 조건도 함께', () => {
    const dialog = setup({ fields: makeFields(['KRW'], [KRW]) });
    expect(within(dialog).getByRole('radio', { name: 'KRW' })).toBeChecked();
    expect(lower()).toBeEnabled();
    press(lower(), 'PageUp');
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [KRW_IN, { col: 'price', op: 'gte', value: stepValue(10, 'lower', KRW) }],
    ]);
  });

  it('통화 변경 → 범위 초기화(그 열 조건 제거), 값이 하나뿐인 통화는 슬라이더 대신 문구', () => {
    const dialog = setup({
      initial: [KRW_IN, { col: 'price', op: 'gte', value: '1300000' }],
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'USD' }));
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([[{ col: 'currency', op: 'in', values: ['USD'] }]]);
    expect(within(dialog).queryByRole('slider')).toBeNull();
    expect(within(dialog).getByText(/값이 하나뿐입니다 \(\$126\)/)).toBeInTheDocument();
  });

  it('행 없는 통화 → 슬라이더 대신 "데이터가 없습니다"', () => {
    const dialog = setup({ fields: makeFields(['JPY', 'KRW'], [KRW]) });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'JPY' }));
    expect(within(dialog).queryByRole('slider')).toBeNull();
    expect(within(dialog).getByText(/데이터가 없습니다/)).toBeInTheDocument();
  });
});

describe('슬라이더 적용 (§7.5 — 손을 뗀 뒤 400ms, 팝오버 유지)', () => {
  it('키보드로 하한 이동 → 디바운스 1회 → gte(유효숫자 2자리), 버튼 compact, aria 는 전체 금액', () => {
    const dialog = setup({ initial: [KRW_IN] });
    press(lower(), 'PageUp', 10); // 칸 100
    press(lower(), 'ArrowRight', 3); // 칸 103
    expect(requests).toEqual([]);
    advance(MONEY_RANGE_DEBOUNCE_MS - 1);
    expect(requests).toEqual([]);
    advance(1);
    const value = stepValue(103, 'lower', KRW);
    expect(requests).toEqual([[KRW_IN, { col: 'price', op: 'gte', value }]]);
    expect(screen.getByRole('dialog', { name: '판매가 필터' })).toBe(dialog);
    expect(lower()).toHaveAttribute('aria-valuenow', '103');
    expect(lower()).toHaveAttribute('aria-valuetext', `₩${Number(value).toLocaleString('ko-KR')}`);
    expect(screen.getByRole('button', { name: /^판매가 필터,/ })).toHaveTextContent(
      `판매가: KRW ${moneyCompact(value, 'KRW')} 이상`,
    );
  });

  it('드래그 중(키를 누르는 동안)은 표시만 — keyup·blur 전에는 요청 없음', () => {
    setup({ initial: [KRW_IN] });
    fireEvent.keyDown(lower(), { key: 'PageUp' });
    fireEvent.keyDown(lower(), { key: 'PageUp' });
    advance(MONEY_RANGE_DEBOUNCE_MS * 3);
    expect(requests).toEqual([]);
    expect(rangeText()).toBe(
      `₩${Number(stepValue(20, 'lower', KRW)).toLocaleString('ko-KR')} 이상`,
    );
    fireEvent.blur(lower());
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toHaveLength(1);
  });

  it('양 끝 = 조건 없음 — 하한 Home·상한 End 로 범위 조건이 사라지고 통화만 남는다', () => {
    setup({
      initial: [
        KRW_IN,
        { col: 'price', op: 'gte', value: '1300000' },
        { col: 'price', op: 'lte', value: '5000000' },
      ],
    });
    expect(rangeText()).toBe('₩1,300,000 ~ ₩5,000,000');
    press(lower(), 'Home');
    press(upper(), 'End');
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([[KRW_IN]]);
    expect(lower()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(upper()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(screen.getByRole('button', { name: /^판매가 필터(,|$)/ })).toHaveAccessibleName(
      '판매가 필터',
    );
  });

  it('클라이언트 표도 같은 디바운스(손을 뗀 뒤 400ms)', () => {
    setup({ initial: [KRW_IN], mode: 'client' });
    press(upper(), 'PageDown');
    expect(requests).toEqual([]);
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [KRW_IN, { col: 'price', op: 'lte', value: stepValue(190, 'upper', KRW) }],
    ]);
  });
});

describe('옛 URL·범위 밖 값 (§7.5)', () => {
  it('핸들은 가까운 칸, 글자·aria 는 URL 실제 값 + "현재 데이터 범위 밖" — 움직인 핸들만 다시 기록', () => {
    setup({
      initial: [
        KRW_IN,
        { col: 'price', op: 'gte', value: '100' },
        { col: 'price', op: 'lte', value: '9999999999' },
      ],
    });
    expect(rangeText()).toBe('₩100 ~ ₩9,999,999,999 · 현재 데이터 범위 밖');
    expect(lower()).toHaveAttribute('aria-valuenow', '1');
    expect(lower()).toHaveAttribute('aria-valuetext', '₩100');
    expect(upper()).toHaveAttribute('aria-valuenow', '200');
    expect(upper()).toHaveAttribute('aria-valuetext', '₩9,999,999,999 (현재 데이터 범위 밖)');

    // 하한만 움직인다 → 상한(범위 밖 옛 값)은 그대로
    press(lower(), 'ArrowRight');
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [
        KRW_IN,
        { col: 'price', op: 'gte', value: stepValue(2, 'lower', KRW) },
        { col: 'price', op: 'lte', value: '9999999999' },
      ],
    ]);
  });

  it('포커스만 왔다 가면(blur) 아무것도 다시 기록하지 않는다', () => {
    setup({ initial: [KRW_IN, { col: 'price', op: 'gte', value: '5000000000' }] });
    expect(rangeText()).toBe('₩5,000,000,000 이상 · 현재 데이터 범위 밖');
    fireEvent.blur(lower());
    fireEvent.blur(upper());
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([]);
  });
});

describe('가운데 드래그 (두 핸들이 함께)', () => {
  // 트랙 244px → usable 200px = 200칸, 1px = 1칸, x = 22 + 칸
  const rect = { left: 0, width: 244, top: 0, height: 44, right: 244, bottom: 44, x: 0, y: 0 };
  const track = () => {
    const el = document.querySelector<HTMLElement>('[data-range-slider]')!;
    el.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    return el;
  };
  const middle = () => document.querySelector<HTMLElement>('[data-range-middle]')!;
  // 옛 URL 값(칸 경계에 맞지 않는 값)
  const initial: FilterCondition[] = [
    KRW_IN,
    { col: 'price', op: 'gte', value: '1234567' },
    { col: 'price', op: 'lte', value: '98765432' },
  ];
  const l0 = valueToStep(1234567, 'lower', KRW);
  const u0 = valueToStep(98765432, 'upper', KRW);

  it('두 값 모두 새 칸 값으로 URL 에 반영(옛 값 잔존 없음), 손을 뗀 뒤 디바운스 1회, 범위 글자는 output', () => {
    setup({ initial });
    expect(u0 - l0).toBeGreaterThanOrEqual(44); // 핸들 터치 영역보다 넓은 구간
    expect(rangeText()).toBe('₩1,234,567 ~ ₩98,765,432');
    expect(document.querySelector('[data-money-range-text]')?.tagName).toBe('OUTPUT');
    const el = track();
    const x = 22 + Math.round((l0 + u0) / 2);
    fireEvent.pointerDown(middle(), { clientX: x });
    fireEvent.pointerMove(el, { clientX: x - 10 });
    fireEvent.pointerUp(el, { clientX: x - 10 });
    expect(lower()).toHaveAttribute('aria-valuenow', String(l0 - 10));
    expect(upper()).toHaveAttribute('aria-valuenow', String(u0 - 10));
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [
        KRW_IN,
        { col: 'price', op: 'gte', value: stepValue(l0 - 10, 'lower', KRW) },
        { col: 'price', op: 'lte', value: stepValue(u0 - 10, 'upper', KRW) },
      ],
    ]);
  });

  it('끝까지 밀면 그쪽은 "제한 없음"(조건 없음)', () => {
    setup({ initial });
    const el = track();
    const x = 22 + Math.round((l0 + u0) / 2);
    fireEvent.pointerDown(middle(), { clientX: x });
    fireEvent.pointerMove(el, { clientX: x + 400 });
    fireEvent.pointerUp(el, { clientX: x + 400 });
    expect(upper()).toHaveAttribute('aria-valuetext', '제한 없음');
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [KRW_IN, { col: 'price', op: 'gte', value: stepValue(200 - (u0 - l0), 'lower', KRW) }],
    ]);
  });

  it('가운데 탭(4px 이하) — 가까운 핸들만 그 칸으로, 확정 값도 새 값(다른 핸들의 옛 값은 그대로)', () => {
    setup({ initial });
    const el = track();
    fireEvent.pointerDown(middle(), { clientX: 22 + l0 + 5 });
    fireEvent.pointerUp(el, { clientX: 22 + l0 + 5 });
    advance(MONEY_RANGE_DEBOUNCE_MS);
    expect(requests).toEqual([
      [
        KRW_IN,
        { col: 'price', op: 'gte', value: stepValue(l0 + 5, 'lower', KRW) },
        { col: 'price', op: 'lte', value: '98765432' },
      ],
    ]);
  });
});
