/**
 * 품목 종류 판정 규칙표 (PRAMI-003 §4.2.7). 품목 마스터(ERP 품목조회) 적용 시 `items.item_kind`·`item_kind_rule` 로 저장하고,
 * 조회 SQL 은 저장값만 읽는다. **품명으로 판정하지 않는다**(이전 품명 정규식 fallback 은 PR-1 에서 삭제, AC-313).
 * 위에서부터 첫 일치. 대·중·소분류는 ERP 원문 그대로 비교한다(원문 오탈자 `Acceleator` 포함).
 * 규칙·예외표 변경은 코드 PR 로만 한다(관리 화면 편집 없음).
 */
export type ItemKind = '본품' | '파츠' | '결합형' | '서비스' | '기타';
export type ItemKindRule = 'K0' | 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7';

export type ItemKindInput = {
  itemCode: string;
  /** ERP 품목대분류 원문 */
  major: string | null;
  mid: string | null;
  minor: string | null;
};

/**
 * K0 품번 예외표 — ERP 분류와 실제 성격이 다른 품목 (2026-10-01 실데이터 5파일로 재확인).
 * 값을 바꾸면 AC-312 분포 고정값도 함께 갱신한다.
 */
export const ITEM_KIND_OVERRIDES: Readonly<Record<string, ItemKind>> = {
  // iSIGN+ / Parts / NIC 로 분류됐지만 소프트웨어(PKI Agent ISSAC-Web Pro)
  P40460013: '본품',
  P40420018: '본품',
  // WAPPLES / Wapples Product / 기타 — 운송비
  P10900001: '서비스',
  // WAPPLES / Wapples-SA / S/W Appliance — SA 구축지원·긴급 장애지원·보안정책설정·정기점검·Full Package
  P1004010001: '서비스',
  P1004010002: '서비스',
  P1004010003: '서비스',
  P1004010004: '서비스',
  P1004010005: '서비스',
  // Cloudbric / Cloudbric WAAP / Cloudbric WAF+ — 유지보수
  P8001010048: '서비스',
  // WAPPLES / Cloudbric SECaaS / Cloudbric — 기술지원비
  P1005040001: '서비스',
  // D'Amo / 거래처단가 / 현대엠엔소프트 — 기술지원 초기 셋업 (0.5MM)
  P20010003: '서비스',
  // iSIGN+ / 기타 / 커스텀 — 컨설팅 및 기술지원
  P40440011: '서비스',
};

const K2_PART_MINORS = new Set(['NIC', 'Disk Upgrade Options', 'SSL/TLS Acceleator Options']);
const K4_SERVICE_MINORS = new Set(['인력', 'Install Fee', '보안관제서비스']);

type Rule = { id: ItemKindRule; kind: ItemKind | null; test: (input: ItemKindInput) => boolean };

/** 규칙표 (K0 은 예외표 조회라 kind 가 표에서 온다) */
export const ITEM_KIND_RULES: readonly Rule[] = [
  { id: 'K0', kind: null, test: ({ itemCode }) => itemCode in ITEM_KIND_OVERRIDES },
  { id: 'K1', kind: '파츠', test: ({ mid }) => mid === 'Parts' },
  { id: 'K2', kind: '파츠', test: ({ minor }) => minor !== null && K2_PART_MINORS.has(minor) },
  {
    id: 'K3',
    kind: '파츠',
    test: ({ major, mid, minor }) =>
      major === 'WAPPLES' && mid === 'Wapples Product' && minor === '기타',
  },
  {
    id: 'K4',
    kind: '서비스',
    test: ({ mid, minor }) =>
      mid === '유지보수' ||
      (minor !== null && (K4_SERVICE_MINORS.has(minor) || minor.endsWith('유지보수'))),
  },
  {
    id: 'K5',
    kind: '결합형',
    test: ({ mid, minor }) => mid === '번들용 패키지' || minor === 'SG-KMS(Optional Package)',
  },
  { id: 'K6', kind: '기타', test: ({ minor }) => minor === '타사제품' },
  { id: 'K7', kind: '본품', test: () => true },
];

/** 규칙표의 첫 일치 → { 종류, 규칙 ID } */
export function classifyItemKind(input: ItemKindInput): { kind: ItemKind; rule: ItemKindRule } {
  const normalized: ItemKindInput = {
    itemCode: input.itemCode.trim(),
    major: input.major?.trim() ?? null,
    mid: input.mid?.trim() ?? null,
    minor: input.minor?.trim() ?? null,
  };
  for (const rule of ITEM_KIND_RULES) {
    if (!rule.test(normalized)) continue;
    const kind = rule.kind ?? ITEM_KIND_OVERRIDES[normalized.itemCode]!;
    return { kind, rule: rule.id };
  }
  return { kind: '본품', rule: 'K7' };
}

/** 마스터에 없는(stub) 품번의 표시 종류 — 파츠·결합형으로 오인하지 않게 STEP3(기타)에 둔다 */
export const STUB_ITEM_KIND: ItemKind = '기타';
