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
