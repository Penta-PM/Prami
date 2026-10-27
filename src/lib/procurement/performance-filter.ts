import { isMonthKey, monthRange, parseMonthKey, shiftMonth, type MonthKey } from '@/lib/month';

import {
  ISIGN_PRODUCT_GROUPS,
  PROCUREMENT_PRODUCT_TABS,
  type IsignProductGroup,
  type ProcurementProductTab,
} from './constants';

/**
 * 조달 실적 현황(`/procurement`) 조회 상태 ↔ URL (조달이 통합 UI-5). 순수 모듈 — 서버 page·클라이언트 조작·조회 상태 정규화
 * (page_key `procurement`)가 **같은** 파서·직렬화를 쓴다. URL 이 상태다.
 *
 * - `tab` = WAPPLES | D.AMO | iSIGN (없음 = ALL 전체)
 * - `group` = iSIGN 세부 그룹 (tab=iSIGN 일 때만)
 * - `from`·`to` = 조회 기간 월(YYYY-MM, 둘 다 있고 from ≤ to 일 때만 — 없으면 기본 "올해")
 * - `month` = 월 실적 보고표 기준월 (없으면 기본 — 마지막으로 다 찬 달)
 * - `sel` = 콤보 차트에서 고른 달 → 그 달 계약 목록, `page` = 계약 목록 페이지(2 이상, sel 이 있을 때만)
 * - `mfr` = 강조한 제조사(범례·제조사 표 연동) — manufacturerKey 형식
 * 기본값·모르는 값은 생략한다(URL 을 짧게, 저장 상태도 같은 모양). 데이터 범위에 맞춘 보정은 resolvePerformanceView.
 */

export const PERFORMANCE_PATH = '/procurement';

export type PerformanceView = {
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
  from: MonthKey | null;
  to: MonthKey | null;
  month: MonthKey | null;
  sel: MonthKey | null;
  page: number;
  mfr: string | null;
};

export const DEFAULT_PERFORMANCE_VIEW: PerformanceView = {
  tab: 'ALL',
  group: null,
  from: null,
  to: null,
  month: null,
  sel: null,
  page: 1,
  mfr: null,
};

/** 페이지 번호 상한 (조작된 URL 방어 — 입찰 공고와 같은 값) */
const MAX_PAGE = 10_000;
/** 강조 키 길이 상한 */
const MAX_KEY_LENGTH = 200;

// ── 제조사 강조 키 (콤보 차트 계열 ↔ 제조사 표 행 ↔ URL `mfr`) ─────────────────

/** 상위 N 밖 제조사를 합친 "기타" 계열 */
export const OTHERS_KEY = 'others';
/** 제조사 미기재 */
export const UNKNOWN_MANUFACTURER_KEY = 'none';
const NAMED_PREFIX = 'm:';

/** 제조사명 → 강조 키 (`m:<원문>`, 미기재 = `none`) — 차트·표·URL 공용 */
export function manufacturerKey(manufacturer: string | null): string {
  return manufacturer === null ? UNKNOWN_MANUFACTURER_KEY : `${NAMED_PREFIX}${manufacturer}`;
}

/** 강조 키 → 제조사명 (이름 있는 제조사만, 그 밖 null) — 계약 목록 제조사 한정에 쓴다 */
export function manufacturerOfKey(key: string | null): string | null {
  return key?.startsWith(NAMED_PREFIX) ? key.slice(NAMED_PREFIX.length) : null;
}

function isManufacturerKey(value: string): boolean {
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return false;
  if (value === OTHERS_KEY || value === UNKNOWN_MANUFACTURER_KEY) return true;
  return value.startsWith(NAMED_PREFIX) && value.length > NAMED_PREFIX.length;
}

// ── 파싱·직렬화 ────────────────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isProductTab(value: unknown): value is ProcurementProductTab {
  return (
    typeof value === 'string' && (PROCUREMENT_PRODUCT_TABS as readonly string[]).includes(value)
  );
}

export function isIsignGroup(value: unknown): value is IsignProductGroup {
  return typeof value === 'string' && (ISIGN_PRODUCT_GROUPS as readonly string[]).includes(value);
}

function monthParam(params: Params, key: string): MonthKey | null {
  const value = first(params, key);
  return value && isMonthKey(value) ? value : null;
}

/** URL 파라미터 → 조회 상태 (형식만 검사 — 모르는 값은 기본값) */
export function parsePerformanceView(params: Params): PerformanceView {
  const tabParam = first(params, 'tab');
  const tab = isProductTab(tabParam) ? tabParam : 'ALL';
  const group = first(params, 'group');
  const from = monthParam(params, 'from');
  const to = monthParam(params, 'to');
  const validPeriod = from !== null && to !== null && from <= to;
  const sel = monthParam(params, 'sel');
  const page = Number(first(params, 'page'));
  const mfr = first(params, 'mfr');
  return {
    tab,
    group: tab === 'iSIGN' && isIsignGroup(group) ? group : null,
    from: validPeriod ? from : null,
    to: validPeriod ? to : null,
    month: monthParam(params, 'month'),
    sel,
    page: sel !== null && Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
    mfr: mfr && isManufacturerKey(mfr) ? mfr : null,
  };
}

/** 조회 상태 → 쿼리스트링 (`?…`, 기본 상태면 '') — 키 순서 고정(tab·group·from·to·month·sel·page·mfr) */
export function performanceViewToQuery(view: Partial<PerformanceView>): string {
  const params = new URLSearchParams();
  if (view.tab && view.tab !== 'ALL' && isProductTab(view.tab)) params.set('tab', view.tab);
  if (view.tab === 'iSIGN' && view.group && isIsignGroup(view.group))
    params.set('group', view.group);
  if (
    view.from &&
    view.to &&
    isMonthKey(view.from) &&
    isMonthKey(view.to) &&
    view.from <= view.to
  ) {
    params.set('from', view.from);
    params.set('to', view.to);
  }
  if (view.month && isMonthKey(view.month)) params.set('month', view.month);
  const sel = view.sel && isMonthKey(view.sel) ? view.sel : null;
  if (sel) params.set('sel', sel);
  if (sel && view.page && Number.isInteger(view.page) && view.page > 1 && view.page <= MAX_PAGE)
    params.set('page', String(view.page));
  if (view.mfr && isManufacturerKey(view.mfr)) params.set('mfr', view.mfr);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function performanceHref(view: Partial<PerformanceView>): string {
  return `${PERFORMANCE_PATH}${performanceViewToQuery(view)}`;
}

/** 조회 상태 정규화(page_key `procurement`) — 화면과 같은 파서·직렬화, '?' 없는 쿼리 */
export function normalizePerformanceQuery(params: Params): string {
  return performanceViewToQuery(parsePerformanceView(params)).replace(/^\?/, '');
}

// ── 데이터 범위에 맞춘 보정 (서버 page) ────────────────────────────────

export type MonthPeriodValue = { from: MonthKey; to: MonthKey };

/** 기준 날짜 (KST `YYYY-MM-DD`) → 이번 달·말일 여부 */
export function todayMonth(todayYmd: string): { month: MonthKey; isMonthEnd: boolean } {
  const month = todayYmd.slice(0, 7);
  const { year, month: mon } = parseMonthKey(month);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { month, isMonthEnd: Number(todayYmd.slice(8, 10)) === lastDay };
}

export type PeriodPreset = { label: string; from: MonthKey; to: MonthKey };

const clampMonth = (value: MonthKey, lo: MonthKey, hi: MonthKey) =>
  value < lo ? lo : value > hi ? hi : value;

/**
 * 조회 기간 프리셋 (조달이 원본 PeriodFilter — 올해·최근 3개월·최근 1년·전체). 끝 = 이번 달, 시작은 고를 수 있는 첫 달 이후로.
 */
export function periodPresets(current: MonthKey, firstMonth: MonthKey): PeriodPreset[] {
  const start = (value: MonthKey) => (value < firstMonth ? firstMonth : value);
  return [
    { label: '올해', from: start(`${current.slice(0, 4)}-01`), to: current },
    { label: '최근 3개월', from: start(shiftMonth(current, -2)), to: current },
    { label: '최근 1년', from: start(shiftMonth(current, -11)), to: current },
    { label: '전체', from: firstMonth <= current ? firstMonth : current, to: current },
  ];
}

/** 기본 기준월 — 오늘이 그 달 말일이 아니면 진행 중인 달이므로 직전 달(원본 defaultReportMonth) */
export function defaultBaseMonth(current: MonthKey, isMonthEnd: boolean): MonthKey {
  return isMonthEnd ? current : shiftMonth(current, -1);
}

export type ResolvedPerformanceView = PerformanceView & {
  from: MonthKey;
  to: MonthKey;
  month: MonthKey;
  /** 슬라이더·기준월 선택지 — 데이터 첫 달 ~ max(마지막 달, 이번 달) */
  months: MonthKey[];
  /** 조회 기간의 월 목록 */
  periodMonths: MonthKey[];
  presets: PeriodPreset[];
  current: MonthKey;
};

/**
 * URL 상태를 데이터 범위(getMonthVolumes first·last)와 오늘에 맞춘다: 기간은 범위 안으로(없으면 "올해"), 기준월도 범위 안,
 * 고른 달은 기간 밖이면 버린다(원본: 기간이 바뀌면 계약 목록을 닫는다).
 */
export function resolvePerformanceView(
  view: PerformanceView,
  range: { first: MonthKey | null; last: MonthKey | null },
  today: { month: MonthKey; isMonthEnd: boolean },
): ResolvedPerformanceView {
  const current = today.month;
  const firstMonth = range.first && range.first < current ? range.first : current;
  const lastMonth = range.last && range.last > current ? range.last : current;
  const months = monthRange(firstMonth, lastMonth);
  const presets = periodPresets(current, firstMonth);
  const fallback = presets[0]!;
  let from = view.from ? clampMonth(view.from, firstMonth, lastMonth) : fallback.from;
  let to = view.to ? clampMonth(view.to, firstMonth, lastMonth) : fallback.to;
  if (from > to) [from, to] = [fallback.from, fallback.to];
  const month = clampMonth(
    view.month ?? defaultBaseMonth(current, today.isMonthEnd),
    firstMonth,
    lastMonth,
  );
  const periodMonths = monthRange(from, to);
  const sel = view.sel && periodMonths.includes(view.sel) ? view.sel : null;
  return {
    ...view,
    group: view.tab === 'iSIGN' ? view.group : null,
    from,
    to,
    month,
    sel,
    page: sel ? view.page : 1,
    months,
    periodMonths,
    presets,
    current,
  };
}
