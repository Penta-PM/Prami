import type { CostLinkFamily, CostLinkMaterial, CostLinkNoSuggestion } from './item-link-types';

/**
 * 원가 매핑 모델명 휴리스틱 (스펙 cost-ratio-price-change §2.1-3). 순수 함수 — 제안만 만들고 저장하지 않는다.
 * 가격 품목명과 원가 자재명을 같은 모델 키 (제품군, CC 여부, 모델 숫자, 세대 T#, RAID 여부)로 줄여 정확히 같은 것만 제안한다.
 * - 품목명에 `(H1700 T2)`·`(H-5400 T1)` 같은 하드웨어 코드가 있으면 그것을 모델로 읽는다.
 * - 포트 변형 `(~4port)`·`(16~22port)`, Standby·HA·DR·이중화·for Rest API·with DCC 같은 꼬리는 무시한다 → 본체 원가 제안.
 * - S/W 업그레이드 품목은 제안하지 않는다.
 * - 세대(T#) 가 같은 원가가 없을 때, 그 모델 숫자의 원가가 세대 표기 없는 것 하나뿐이면 그것을 제안한다
 *   (예: `Wapples-5400 (H5400 T1)` → `WAPPLES-5400`). 다른 세대 원가가 있으면 제안하지 않는다(오탐 방지).
 * - RAID 는 원가가 다르므로 RAID 여부가 같아야 한다.
 * - 원가 자재명 앞의 `(중복)` 은 원가표의 중복 표시라 제안 대상에서 뺀다.
 */
export type ModelKey = {
  family: 'WAPPLES' | 'KMS' | 'ISIGN';
  cc: boolean;
  model: string;
  generation: string;
  raid: boolean;
};

const SW_UPGRADE = /업그레이드/;
const HW_CODE = /\(H-?(\d{2,5})(?:\s*(T\d))?/;
const NAMED_MODEL = /(?:WAPPLES|KMS|ATH|IAT|WCA|WVA|ISIGN\+?)[-\s]*(?:CC-)?(\d{2,5})(?:\s*(T\d))?/;
const GENERATION = /(?<![A-Z0-9])T(\d)(?!\d)/;

function familyKey(family: CostLinkFamily): ModelKey['family'] {
  if (family === 'WAPPLES') return 'WAPPLES';
  if (family === 'D.AMO KMS') return 'KMS';
  return 'ISIGN';
}

/** 가격 품목명 → 모델 키. 키가 없으면 제안하지 않는 이유 */
export function itemModelKey(
  itemName: string,
  family: CostLinkFamily,
): { key: ModelKey } | { reason: Exclude<CostLinkNoSuggestion, 'no-cost'> } {
  const name = itemName.toUpperCase();
  if (SW_UPGRADE.test(name)) return { reason: 'sw-upgrade' };
  const raid = name.includes('RAID');
  const cc = /WAPPLES-CC|\bCC-/.test(name);
  const match = HW_CODE.exec(name) ?? NAMED_MODEL.exec(name);
  if (!match?.[1]) return { reason: 'no-model' };
  const generation = match[2] ?? (GENERATION.exec(name) ? `T${GENERATION.exec(name)![1]}` : '');
  return { key: { family: familyKey(family), cc, model: match[1], generation, raid } };
}

/** 원가 자재명 → 모델 키. 대상 제품군이 아니거나 `(중복)` 이면 null */
export function materialModelKey(materialName: string): ModelKey | null {
  const name = materialName.trim().toUpperCase();
  if (name.startsWith('(중복)')) return null;
  let family: ModelKey['family'];
  if (name.startsWith('WAPPLES')) family = 'WAPPLES';
  else if (name.includes('SG-KMS')) family = 'KMS';
  else if (name.startsWith('ISIGN+')) family = 'ISIGN';
  else return null;
  // iSIGN+ 는 '+' 뒤에서 읽는다(제품명 앞부분에 숫자가 없음). 그 밖에는 이름 전체에서 첫 모델 숫자
  const body = family === 'ISIGN' ? name.slice(name.indexOf('+') + 1) : name;
  const match = /(\d{2,5})(?:\s*(T\d))?/.exec(body);
  if (!match?.[1]) return null;
  return {
    family,
    cc: name.startsWith('WAPPLES-CC'),
    model: match[1],
    generation: match[2] ?? '',
    raid: name.includes('RAID'),
  };
}

const keyString = (key: ModelKey) =>
  [key.family, key.cc ? 'CC' : '', key.model, key.generation, key.raid ? 'RAID' : ''].join('|');

export type MaterialIndex = {
  byKey: Map<string, CostLinkMaterial[]>;
  /** family|cc|model|raid → 그 모델 숫자의 세대 표기 목록('' 포함) */
  generations: Map<string, Set<string>>;
};

export function buildMaterialIndex(materials: readonly CostLinkMaterial[]): MaterialIndex {
  const byKey = new Map<string, CostLinkMaterial[]>();
  const generations = new Map<string, Set<string>>();
  for (const material of materials) {
    const key = materialModelKey(material.materialName);
    if (!key) continue;
    const full = keyString(key);
    byKey.set(full, [...(byKey.get(full) ?? []), material]);
    const base = keyString({ ...key, generation: '*' });
    generations.set(base, (generations.get(base) ?? new Set()).add(key.generation));
  }
  return { byKey, generations };
}

/** 제안 1건(같은 키 원가가 정확히 하나일 때만). 없으면 이유 */
export function suggestMaterial(
  itemName: string,
  family: CostLinkFamily,
  index: MaterialIndex,
): { suggestion: CostLinkMaterial } | { reason: CostLinkNoSuggestion } {
  const parsed = itemModelKey(itemName, family);
  if ('reason' in parsed) return parsed;
  const { key } = parsed;
  let hits = index.byKey.get(keyString(key));
  if (!hits && key.generation) {
    const gens = index.generations.get(keyString({ ...key, generation: '*' }));
    // 세대 표기 없는 원가 하나뿐이면 그 모델의 본체로 본다. 다른 세대 원가가 있으면 제안하지 않는다
    if (gens && gens.size === 1 && gens.has('')) {
      hits = index.byKey.get(keyString({ ...key, generation: '' }));
    }
  }
  if (hits?.length === 1) return { suggestion: hits[0]! };
  return { reason: 'no-cost' };
}

export type CostLinkDryRunRow = {
  family: string;
  candidates: number;
  withNormalPrice: number;
  suggested: number;
  suggestedWithNormalPrice: number;
  swUpgrade: number;
  noModel: number;
  noCost: number;
};

/** dry-run 리포트(제품군별 개수만 — 품목명·자재명 없음, §2.1-4) */
export function summarizeSuggestions(
  candidates: readonly {
    family: string;
    hasNormalPrice: boolean;
    suggestion: unknown;
    noSuggestion: CostLinkNoSuggestion | null;
  }[],
): CostLinkDryRunRow[] {
  const rows = new Map<string, CostLinkDryRunRow>();
  for (const candidate of candidates) {
    const row = rows.get(candidate.family) ?? {
      family: candidate.family,
      candidates: 0,
      withNormalPrice: 0,
      suggested: 0,
      suggestedWithNormalPrice: 0,
      swUpgrade: 0,
      noModel: 0,
      noCost: 0,
    };
    row.candidates += 1;
    if (candidate.hasNormalPrice) row.withNormalPrice += 1;
    if (candidate.suggestion) {
      row.suggested += 1;
      if (candidate.hasNormalPrice) row.suggestedWithNormalPrice += 1;
    }
    if (candidate.noSuggestion === 'sw-upgrade') row.swUpgrade += 1;
    if (candidate.noSuggestion === 'no-model') row.noModel += 1;
    if (candidate.noSuggestion === 'no-cost') row.noCost += 1;
    rows.set(candidate.family, row);
  }
  return [...rows.values()];
}
