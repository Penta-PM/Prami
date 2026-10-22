/**
 * 원가 매핑(cost_item_links) 화면 계약 (스펙 cost-ratio-price-change §2.1). 순수 타입 — 서버·화면이 함께 쓴다.
 * 원가 금액은 이 계약 어디에도 없다(매핑은 품목코드 ↔ 자재번호·자재명만).
 */

/** 매핑 후보 제품군 (§2.1-3 대상 제품군) */
export const COST_LINK_FAMILIES = ['WAPPLES', 'D.AMO KMS', 'iSIGN'] as const;
export type CostLinkFamily = (typeof COST_LINK_FAMILIES)[number];

/** 제안이 없을 때의 이유 — 화면 안내 문구용 */
export type CostLinkNoSuggestion =
  /** S/W 업그레이드 품목은 제안하지 않는다(§2.1-3) */
  | 'sw-upgrade'
  /** 품목명에서 모델(숫자)을 읽지 못함 */
  | 'no-model'
  /** 모델은 읽었지만 같은 모델의 원가 자재가 없음 */
  | 'no-cost'
  /** 같은 모델 키의 원가 자재가 둘 이상 — 직접 선택 */
  | 'ambiguous';

export type CostLinkMaterial = { materialCode: string; materialName: string };

export type CostLinkCandidate = {
  itemCode: string;
  itemName: string;
  family: CostLinkFamily;
  /** 소분류(분류 표시용) */
  categoryMinor: string | null;
  /** 품목 상태 원문(사용·폐기·임시 등) */
  itemStatus: string | null;
  /** 정상판매 가격 행(삭제 제외)이 있는지 — 원가 비중이 실제로 표시될 품목 */
  hasNormalPrice: boolean;
  /** 확정된 매핑. 자재가 원가표에서 사라졌으면 materialName 은 null */
  link: {
    materialCode: string;
    materialName: string | null;
    updatedAt: string;
  } | null;
  /** 모델명 휴리스틱 제안(저장되지 않음). 없으면 noSuggestion 에 이유 */
  suggestion: CostLinkMaterial | null;
  noSuggestion: CostLinkNoSuggestion | null;
};

/** 품목이 가격 임포트로 사라진 매핑 — '품목 없음' 표시, 자동 삭제하지 않는다(§2.1-3) */
export type CostLinkOrphan = {
  itemCode: string;
  materialCode: string;
  materialName: string | null;
  updatedAt: string;
};

export type CostLinkView = {
  candidates: CostLinkCandidate[];
  orphans: CostLinkOrphan[];
  /**
   * 품목은 있지만 후보 범위 밖인 링크(Plan Q1 A) — 분류가 바뀌었거나 확정 검사 도입 전에 저장된 것.
   * 원가 비중 계산에 쓰이지 않으며 화면에서 해제만 할 수 있다
   */
  outOfScope: (CostLinkOrphan & { itemName: string })[];
  /** 수동 선택용 원가 자재 목록(표준구매원가·일반, 삭제 제외, 자재명 순) */
  materials: CostLinkMaterial[];
};

/** 확정(일괄 포함) 입력 — 한 번에 최대 500건 */
export type ConfirmCostLinksInput = {
  links: { itemCode: string; materialCode: string }[];
};
export type ConfirmCostLinksResult = { saved: number; unchanged: number };

export type DeleteCostLinkInput = { itemCode: string };
export type DeleteCostLinkResult = { deleted: boolean };

/**
 * 가격정책 관리 표의 '원가 매핑' 칸 (스펙 policy-cost-link-column §2.2-1) — 품목코드마다 1개. 원가 금액 없음.
 * inScope = 매핑 후보 범위(본품 + 대상 제품군 분류) 안. inCostTable = 자재번호가 원가표(표준구매원가·일반, 삭제 제외)에 있음.
 */
export type ItemLinkCell = {
  inScope: boolean;
  link: { materialCode: string; materialName: string | null; inCostTable: boolean } | null;
};

/** 가격정책 관리 매핑 수정 모달이 여는 한 품목의 매핑 정보 (§2.3-2) — 원가 금액 없음 */
export type CostLinkPickerData = {
  item: {
    itemCode: string;
    itemName: string;
    /** 후보 제품군. 후보 범위 밖이면 null */
    family: CostLinkFamily | null;
    categoryMinor: string | null;
    itemStatus: string | null;
    inScope: boolean;
  };
  link: { materialCode: string; materialName: string | null; inCostTable: boolean } | null;
  /** 후보 범위 안 품목만 — 범위 밖이면 둘 다 null */
  suggestion: CostLinkMaterial | null;
  noSuggestion: CostLinkNoSuggestion | null;
  materials: CostLinkMaterial[];
  /** 같은 매핑이 적용되는 가격 행(삭제 제외)·그중 정상판매 건수 */
  impact: { priceRows: number; normalPriceRows: number };
};

/**
 * 품목-원가 매칭 파일 업로드 (스펙 erp-upload-guide §6.2, 분류 규칙 cost-ratio-price-change §9).
 * 브라우저가 파일에서 읽은 {품목코드, 자재번호} 쌍만 받는다 — 파일·파일명·다른 열은 서버에 오지 않는다.
 * 미리보기 결과는 응답(화면)에만 있고 DB·로그에 남지 않는다.
 */
export const COST_LINK_IMPORT_REASONS = [
  'no-item',
  'out-of-scope',
  'no-cost',
  'multiple',
  'format',
] as const;
export type CostLinkImportReason = (typeof COST_LINK_IMPORT_REASONS)[number];

export const COST_LINK_IMPORT_REASON_TEXT: Record<CostLinkImportReason, string> = {
  'no-item': '품목 마스터 없음',
  'out-of-scope': '후보 범위 밖',
  'no-cost': '원가표에 없는 품번',
  multiple: '한 품목에 품번 2개 이상',
  format: '형식 오류',
};

export type CostLinkImportInput = { pairs: { itemCode: string; materialCode: string }[] };

export type CostLinkImportMaterial = { materialCode: string; materialName: string | null };

export type CostLinkImportEntry = {
  itemCode: string;
  itemName: string;
  family: CostLinkFamily;
  /** 변경이면 지금 매핑, 추가면 null */
  before: CostLinkImportMaterial | null;
  after: CostLinkImportMaterial;
};

export type CostLinkImportFailure = {
  itemCode: string;
  /** 파일의 원자재품번(한 품목에 2개 이상이면 모두) */
  materialCodes: string[];
  reason: CostLinkImportReason;
};

export type CostLinkImportPreview = {
  /** 중복을 뺀 쌍 수 · 품목 수 */
  pairs: number;
  items: number;
  /** 이미 같은 자재로 매핑됨 */
  same: number;
  changed: CostLinkImportEntry[];
  added: CostLinkImportEntry[];
  failed: CostLinkImportFailure[];
  failedByReason: Record<CostLinkImportReason, number>;
  /** 파일에 없는 기존 링크 — 해제하지 않고 유지(Q-F1). family null = 품목 없음·후보 범위 밖 링크 */
  kept: { family: CostLinkFamily | null; count: number }[];
};

/** 확정: 미리보기 때의 변경·추가 건수 — 서버가 다시 분류한 결과와 다르면 '다시 미리보기'(CONFLICT) */
export type ApplyCostLinkImportInput = CostLinkImportInput & {
  expected: { changed: number; added: number };
};

export type ApplyCostLinkImportResult = {
  saved: number;
  unchanged: number;
  failedByReason: Record<CostLinkImportReason, number>;
};
