// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERFORMANCE_VIEW,
  defaultBaseMonth,
  manufacturerKey,
  manufacturerOfKey,
  normalizePerformanceQuery,
  OTHERS_KEY,
  parsePerformanceView,
  performanceHref,
  performanceViewToQuery,
  periodPresets,
  resolvePerformanceView,
  todayMonth,
  UNKNOWN_MANUFACTURER_KEY,
} from '@/lib/procurement/performance-filter';

/**
 * 조달이 통합 UI-5 — 실적 현황 URL 상태(lib/procurement/performance-filter). 화면·조회 상태 정규화(page_key procurement)가
 * 같은 파서·직렬화를 쓴다. 제조사 이름은 합성.
 */
describe('parsePerformanceView · performanceViewToQuery', () => {
  it('빈 URL = 기본 상태, 직렬화는 빈 문자열', () => {
    expect(parsePerformanceView({})).toEqual(DEFAULT_PERFORMANCE_VIEW);
    expect(performanceViewToQuery(DEFAULT_PERFORMANCE_VIEW)).toBe('');
    expect(performanceHref({})).toBe('/procurement');
  });

  it('모든 키 왕복 — 키 순서 고정(tab·group·from·to·month·sel·page·mfr)', () => {
    const query =
      'mfr=m%3A%EA%B0%80%EC%83%81%EB%B3%B4%EC%95%88&page=3&sel=2025-02&month=2025-03&to=2025-06&from=2025-01&group=SSO&tab=iSIGN';
    const view = parsePerformanceView(Object.fromEntries(new URLSearchParams(query)));
    expect(view).toEqual({
      tab: 'iSIGN',
      group: 'SSO',
      from: '2025-01',
      to: '2025-06',
      month: '2025-03',
      sel: '2025-02',
      page: 3,
      mfr: 'm:가상보안',
    });
    expect(performanceViewToQuery(view)).toBe(
      '?tab=iSIGN&group=SSO&from=2025-01&to=2025-06&month=2025-03&sel=2025-02&page=3&mfr=m%3A%EA%B0%80%EC%83%81%EB%B3%B4%EC%95%88',
    );
  });

  it('모르는 값·형식 오류는 버린다', () => {
    expect(
      parsePerformanceView({
        tab: 'NOPE',
        group: 'SSO',
        from: '2025-13',
        to: '2025-02',
        month: '25-01',
        sel: 'x',
        page: '2',
        mfr: 'bad',
      }),
    ).toEqual(DEFAULT_PERFORMANCE_VIEW);
  });

  it('세부 그룹은 iSIGN 탭에서만, 기간은 from ≤ to 둘 다 있을 때만, 페이지는 고른 달이 있을 때만', () => {
    expect(parsePerformanceView({ tab: 'WAPPLES', group: 'SSO' }).group).toBeNull();
    expect(parsePerformanceView({ tab: 'iSIGN', group: '없는그룹' }).group).toBeNull();
    expect(parsePerformanceView({ from: '2025-05', to: '2025-01' })).toMatchObject({
      from: null,
      to: null,
    });
    expect(parsePerformanceView({ from: '2025-05' })).toMatchObject({ from: null, to: null });
    expect(parsePerformanceView({ page: '4' }).page).toBe(1);
    expect(parsePerformanceView({ sel: '2025-01', page: '0' }).page).toBe(1);
    expect(parsePerformanceView({ sel: '2025-01', page: '99999' }).page).toBe(1);
    expect(performanceViewToQuery({ tab: 'WAPPLES', group: 'SSO', page: 2 })).toBe('?tab=WAPPLES');
    expect(performanceViewToQuery({ tab: 'ALL', sel: '2025-01', page: 1 })).toBe('?sel=2025-01');
  });

  it('같은 키 여러 개면 첫 값', () => {
    expect(parsePerformanceView({ tab: ['D.AMO', 'WAPPLES'] }).tab).toBe('D.AMO');
  });

  it('정규화(page_key procurement) = 파싱 후 직렬화, ? 없음', () => {
    expect(normalizePerformanceQuery({ tab: 'D.AMO', x: '1', month: '2025-04' })).toBe(
      'tab=D.AMO&month=2025-04',
    );
    expect(normalizePerformanceQuery({ tab: 'ALL' })).toBe('');
  });
});

describe('제조사 강조 키', () => {
  it('이름 ↔ 키, 미기재·기타', () => {
    expect(manufacturerKey('가상보안')).toBe('m:가상보안');
    expect(manufacturerKey(null)).toBe(UNKNOWN_MANUFACTURER_KEY);
    expect(manufacturerOfKey('m:가상보안')).toBe('가상보안');
    expect(manufacturerOfKey(OTHERS_KEY)).toBeNull();
    expect(manufacturerOfKey(UNKNOWN_MANUFACTURER_KEY)).toBeNull();
    expect(manufacturerOfKey(null)).toBeNull();
    expect(parsePerformanceView({ mfr: OTHERS_KEY }).mfr).toBe(OTHERS_KEY);
    expect(parsePerformanceView({ mfr: 'm:' }).mfr).toBeNull();
    expect(parsePerformanceView({ mfr: `m:${'가'.repeat(300)}` }).mfr).toBeNull();
  });
});

describe('데이터 범위·오늘에 맞춘 보정', () => {
  const today = { month: '2026-10', isMonthEnd: false };

  it('todayMonth: 말일 판정 (윤년 2월 포함)', () => {
    expect(todayMonth('2026-10-27')).toEqual({ month: '2026-10', isMonthEnd: false });
    expect(todayMonth('2026-10-31')).toEqual({ month: '2026-10', isMonthEnd: true });
    expect(todayMonth('2028-02-29')).toEqual({ month: '2028-02', isMonthEnd: true });
    expect(todayMonth('2027-02-28')).toEqual({ month: '2027-02', isMonthEnd: true });
  });

  it('기본 기준월 = 마지막으로 다 찬 달 (원본 defaultReportMonth)', () => {
    expect(defaultBaseMonth('2026-10', false)).toBe('2026-09');
    expect(defaultBaseMonth('2026-10', true)).toBe('2026-10');
    expect(defaultBaseMonth('2026-01', false)).toBe('2025-12');
  });

  it('프리셋: 올해·최근 3개월·최근 1년·전체 — 시작은 데이터 첫 달 이후로', () => {
    expect(periodPresets('2026-10', '2024-03')).toEqual([
      { label: '올해', from: '2026-01', to: '2026-10' },
      { label: '최근 3개월', from: '2026-08', to: '2026-10' },
      { label: '최근 1년', from: '2025-11', to: '2026-10' },
      { label: '전체', from: '2024-03', to: '2026-10' },
    ]);
    expect(periodPresets('2026-10', '2026-09')[0]).toEqual({
      label: '올해',
      from: '2026-09',
      to: '2026-10',
    });
  });

  it('기간 없음 → "올해", 기준월 없음 → 직전 달, 선택지 = 첫 달 ~ 이번 달', () => {
    const resolved = resolvePerformanceView(
      DEFAULT_PERFORMANCE_VIEW,
      { first: '2025-01', last: '2026-08' },
      today,
    );
    expect(resolved).toMatchObject({ from: '2026-01', to: '2026-10', month: '2026-09' });
    expect(resolved.months[0]).toBe('2025-01');
    expect(resolved.months.at(-1)).toBe('2026-10');
    expect(resolved.periodMonths).toHaveLength(10);
  });

  it('범위 밖 기간·기준월은 범위 안으로, 기간 밖의 고른 달은 버리고 페이지도 1로', () => {
    const view = parsePerformanceView({
      from: '2020-01',
      to: '2030-01',
      month: '2019-05',
      sel: '2026-02',
      page: '3',
    });
    const resolved = resolvePerformanceView(view, { first: '2025-01', last: '2026-08' }, today);
    expect(resolved).toMatchObject({
      from: '2025-01',
      to: '2026-10',
      month: '2025-01',
      sel: '2026-02',
      page: 3,
    });
    const narrowed = resolvePerformanceView(
      { ...view, from: '2026-03', to: '2026-05' },
      { first: '2025-01', last: '2026-08' },
      today,
    );
    expect(narrowed).toMatchObject({ sel: null, page: 1 });
  });

  it('데이터 없음 → 이번 달만 고를 수 있다', () => {
    const resolved = resolvePerformanceView(
      DEFAULT_PERFORMANCE_VIEW,
      { first: null, last: null },
      today,
    );
    expect(resolved.months).toEqual(['2026-10']);
    expect(resolved).toMatchObject({ from: '2026-10', to: '2026-10', month: '2026-10' });
  });
});
