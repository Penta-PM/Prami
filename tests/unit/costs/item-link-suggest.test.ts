import { describe, expect, it } from 'vitest';

import {
  buildMaterialIndex,
  itemModelKey,
  materialModelKey,
  suggestMaterial,
  summarizeSuggestions,
} from '@/server/cost/item-link-suggest';
import type { CostLinkFamily } from '@/server/cost/item-link-types';

/**
 * 원가 매핑 모델명 휴리스틱 (스펙 cost-ratio-price-change §2.1-3). 실데이터(main DB 2026-10-15)에서 고른 품목명·자재명.
 * 제안은 같은 모델 키 원가가 정확히 하나일 때만 — 오탐보다 미제안이 낫다.
 */
const MATERIALS = [
  { materialCode: 'W1001010036', materialName: 'WAPPLES-1700 T1' },
  { materialCode: 'W1001010037', materialName: 'WAPPLES-1700 T2' },
  { materialCode: 'W1001010026', materialName: 'WAPPLES-2600' },
  { materialCode: 'W1001010032', materialName: 'WAPPLES-2600 RAID' },
  { materialCode: 'W1001010015', materialName: 'WAPPLES-5400' },
  { materialCode: 'W10100024', materialName: 'WAPPLES-4000 T1' },
  { materialCode: 'W1001010008', materialName: 'WAPPLES-4000 T2' },
  { materialCode: 'W1001010046', materialName: 'Wapples-CC-2700' },
  { materialCode: 'W1001010038', materialName: 'WAPPLES-2700' },
  { materialCode: 'W2007010023', materialName: 'SG-KMS 1700 T1' },
  { materialCode: 'W2007010014', materialName: 'SG-KMS 5600' },
  { materialCode: 'W2007010020', materialName: 'SG-KMS 5600 (RAID)' },
  { materialCode: 'W4001010032', materialName: 'iSIGN+ 1700 T2' },
  { materialCode: 'W4001010034', materialName: 'iSIGN+ 2700 RAID' },
  { materialCode: 'W4001010002', materialName: '(중복) ISign+ SG-WCA 4000 T2' },
  { materialCode: 'W10800017', materialName: '10G_(2Port)_N_52121' },
];
const index = buildMaterialIndex(MATERIALS);

const cases: [string, CostLinkFamily, string | { reason: string }][] = [
  // H-코드 우선, 포트 변형·Standby 는 본체 원가
  ['Wapples-1700 T2 (H1700 T2)', 'WAPPLES', 'W1001010037'],
  ['Wapples-2600 (H2600) (16~22port)', 'WAPPLES', 'W1001010026'],
  ['Wapples-2600 (H2600)-RAID (16~22port)', 'WAPPLES', 'W1001010032'],
  ['Wapples-2600 (H2600) / RAID', 'WAPPLES', 'W1001010032'],
  ['Wapples-4000 (H4000 T1) / Standby', 'WAPPLES', 'W10100024'],
  // 세대 표기 없는 원가 하나뿐이면 본체로 제안
  ['Wapples-5400 (H5400 T1)', 'WAPPLES', 'W1001010015'],
  // 다른 세대 원가가 있으면 세대 없는 품목명은 제안하지 않는다
  ['Wapples-1700', 'WAPPLES', { reason: 'no-cost' }],
  // CC 는 CC 원가만
  ['Wapples-CC-2700', 'WAPPLES', 'W1001010046'],
  // S/W 업그레이드는 제안하지 않는다
  ['Wapples-2600 S/W 업그레이드', 'WAPPLES', { reason: 'sw-upgrade' }],
  ['Wapples-4000 T2 S/W v6.0 업그레이드', 'WAPPLES', { reason: 'sw-upgrade' }],
  ['QUANN WAF-100', 'WAPPLES', { reason: 'no-model' }],
  // KMS: 꼬리(for Rest API·with DCC·Standby)는 무시, RAID 구분
  ['SG-KMS-1700 T1 for Rest API with DCC', 'D.AMO KMS', 'W2007010023'],
  ['SG-KMS-5600 (Standby)', 'D.AMO KMS', 'W2007010014'],
  ['SG-KMS-5600 RAID', 'D.AMO KMS', 'W2007010020'],
  ['AutoCrypt KMS-1600 RAID', 'D.AMO KMS', { reason: 'no-cost' }],
  // iSIGN: 플랫폼 공용 원가(iSIGN+ 1700 T2 를 ATH·IAT·WCA·WVA 가 공유), (중복) 원가는 제안 안 함
  ['SS-ATH-1700 T2 with SS-IAT', 'iSIGN', 'W4001010032'],
  ['SG-WCA-2700 RAID', 'iSIGN', 'W4001010034'],
  ['iSIGN+ SG WCA 4000 T2 / HA', 'iSIGN', { reason: 'no-cost' }],
  ['인증서 발급 라이선스 (100건 발급 당)', 'iSIGN', { reason: 'no-model' }],
];

describe('suggestMaterial', () => {
  it.each(cases)('%s (%s)', (itemName, family, expected) => {
    const result = suggestMaterial(itemName, family, index);
    if (typeof expected === 'string') {
      expect(result).toEqual({
        suggestion: MATERIALS.find((m) => m.materialCode === expected),
      });
    } else {
      expect(result).toEqual(expected);
    }
  });

  it('같은 모델 키 원가가 둘 이상이면 제안하지 않는다(모호함)', () => {
    const doubled = buildMaterialIndex([
      { materialCode: 'A', materialName: 'WAPPLES-700' },
      { materialCode: 'B', materialName: 'WAPPLES 700' },
    ]);
    expect(suggestMaterial('Wapples-700 (H700)', 'WAPPLES', doubled)).toEqual({
      reason: 'no-cost',
    });
  });
});

describe('모델 키', () => {
  it('품목명: H-코드·세대·RAID·CC 를 읽는다', () => {
    expect(itemModelKey('Wapples-4000 (H4000 T2)-RAID', 'WAPPLES')).toEqual({
      key: { family: 'WAPPLES', cc: false, model: '4000', generation: 'T2', raid: true },
    });
    expect(itemModelKey('SG-KMS-4000 RAID T2 (DR)', 'D.AMO KMS')).toEqual({
      key: { family: 'KMS', cc: false, model: '4000', generation: 'T2', raid: true },
    });
    expect(itemModelKey('Wapples-CC-5400 (H-5400 T1)', 'WAPPLES')).toEqual({
      key: { family: 'WAPPLES', cc: true, model: '5400', generation: 'T1', raid: false },
    });
  });

  it('자재명: 대상 제품군이 아니거나 (중복)이면 null', () => {
    expect(materialModelKey('10G_(2Port)_N_52121')).toBeNull();
    expect(materialModelKey('(중복) ISign+ SG-WVA 700')).toBeNull();
    expect(materialModelKey('ISign+ STD (IP-100 T4)')).toEqual({
      family: 'ISIGN',
      cc: false,
      model: '100',
      generation: 'T4',
      raid: false,
    });
  });
});

describe('summarizeSuggestions (dry-run 리포트)', () => {
  it('제품군별 개수만 — 후보·정상판매·제안·이유', () => {
    const rows = summarizeSuggestions([
      { family: 'WAPPLES', hasNormalPrice: true, suggestion: {}, noSuggestion: null },
      { family: 'WAPPLES', hasNormalPrice: false, suggestion: null, noSuggestion: 'sw-upgrade' },
      { family: 'iSIGN', hasNormalPrice: true, suggestion: null, noSuggestion: 'no-cost' },
      { family: 'iSIGN', hasNormalPrice: false, suggestion: null, noSuggestion: 'no-model' },
    ]);
    expect(rows).toEqual([
      {
        family: 'WAPPLES',
        candidates: 2,
        withNormalPrice: 1,
        suggested: 1,
        suggestedWithNormalPrice: 1,
        swUpgrade: 1,
        noModel: 0,
        noCost: 0,
      },
      {
        family: 'iSIGN',
        candidates: 2,
        withNormalPrice: 1,
        suggested: 0,
        suggestedWithNormalPrice: 0,
        swUpgrade: 0,
        noModel: 1,
        noCost: 1,
      },
    ]);
  });
});
