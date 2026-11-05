import {
  coreApplies,
  coreUnitPrice,
  MAX_CORES,
  type CorePriceRow,
  type CoreSnapshot,
} from '@/lib/pricing/quote';

import type { QuoteItemView } from './types';

/**
 * 계산기 코어 수 (D.AMO 코어 단가 스펙 §2–§4). 단가 계산은 공용 `coreUnitPrice` 하나 — 서버 재가격화와 같은 함수다.
 * 입력은 원문 문자열로 들고 있다가 여기서 정수·범위(기준 이상 1,024 이하, D1·D2)를 판정한다.
 */
type CoreItem = Pick<
  QuoteItemView,
  'unitPrice' | 'hasCorePrice' | 'baseCoreCount' | 'unitPricePerCore'
>;

export function coreRowOf(item: CoreItem): CorePriceRow {
  return {
    unitPrice: Number(item.unitPrice),
    hasCorePrice: item.hasCorePrice,
    baseCoreCount: item.baseCoreCount,
    unitPricePerCore: Number(item.unitPricePerCore),
  };
}

/** 코어 입력을 보여 줄 품목인가 (Y + 기준 1 이상, D4) */
export function hasCoreInput(item: CoreItem | null | undefined): item is CoreItem {
  return !!item && coreApplies(item);
}

/** 품목 선택·복원 시 코어 수 입력 원문: 코어 품목이면 저장값(기준 미만·없음 = 기준), 아니면 빈 값 (D1·D5) */
export function defaultCores(item: CoreItem | null | undefined, saved?: number): string {
  if (!hasCoreInput(item)) return '';
  return String(Math.max(item.baseCoreCount, Math.min(MAX_CORES, saved ?? item.baseCoreCount)));
}

export type CoresInput = { cores: number; error: null } | { cores: null; error: string };

/** 코어 수 입력 판정. 코어 품목이 아니면 쓰지 않는다 */
export function parseCores(text: string, baseCoreCount: number): CoresInput {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { cores: null, error: '코어 수는 정수로 입력하세요' };
  const cores = Number(trimmed);
  if (cores < baseCoreCount) {
    return { cores: null, error: `기준 ${baseCoreCount}코어 이상으로 입력하세요` };
  }
  if (cores > MAX_CORES) {
    return { cores: null, error: `${MAX_CORES.toLocaleString('ko-KR')}코어 이하로 입력하세요` };
  }
  return { cores, error: null };
}

/** 코어 반영 단가 + 스냅샷. 코어 품목이 아니면 단가 그대로·스냅샷 없음 */
export function corePricing(
  item: CoreItem,
  cores: number | undefined,
): { unitPrice: number; core?: CoreSnapshot } {
  const row = coreRowOf(item);
  if (!coreApplies(row) || cores === undefined) return { unitPrice: row.unitPrice };
  return {
    unitPrice: coreUnitPrice(row, cores),
    core: {
      cores,
      baseCoreCount: row.baseCoreCount,
      unitPricePerCore: row.unitPricePerCore,
      baseUnitPrice: row.unitPrice,
    },
  };
}

/** 추가 코어 수 (기준 초과분) */
export function extraCores(core: Pick<CoreSnapshot, 'cores' | 'baseCoreCount'>): number {
  return Math.max(0, core.cores - core.baseCoreCount);
}
