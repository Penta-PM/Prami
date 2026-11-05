/** 클라이언트 컴포넌트가 받는 가격정책 행 (서버 모듈을 import 하지 않도록 분리) */
export type PriceRowView = {
  id: number;
  priceType: string | null;
  major: string;
  mid: string | null;
  minor: string | null;
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  itemStatus: string;
  operationStatus: '운영중' | '미사용';
  remark: string | null;
  source: 'erp' | 'manual';
  /**
   * 코어단가유무·기준코어수·단가(1코어) (D.AMO 코어 단가 스펙 §4) — 코어 적용 행(Y + 기준 1 이상)만 판매가 칸 아래 보조 줄.
   * 서버 행에는 항상 있다(키가 없으면 코어 미적용으로 본다)
   */
  hasCorePrice?: boolean;
  baseCoreCount?: number;
  unitPricePerCore?: string;
  /**
   * 같은 계열 직전 적용시작일 행의 판매가 (첫 시기 = null).
   * 관리 화면 + pricing.write 일 때만 키가 있다 — 조회 화면(/pricing) 행에는 키 자체가 없다(pricing-view-hide-price-change §2)
   */
  previousPrice?: string | null;
  /** 반올림(소수 1자리)한 변동률 %. 첫 시기·직전가 0 = null. previousPrice 와 같이 관리 화면에서만 */
  priceChangeRate?: number | null;
};

export type CategoryOptionsView = {
  majors: string[];
  mids: string[];
  minors: string[];
  hasMaster: boolean;
};

/**
 * 원가 비중 칸 값 (cost-ratio-price-change §2.2) — 비율·원가 적용일 또는 '—' 사유만. **원가 금액 없음**.
 * 서버 모듈(server/cost/price-ratio)의 CostRatio 와 같은 모양(화면은 원가 모듈을 import 하지 않는다).
 */
export type CostRatioReason = 'no-cost' | 'zero-price' | 'currency';
export type CostRatioView =
  { costRatio: number; costFrom: string } | { costRatio: null; reason: CostRatioReason };

/**
 * 원가 매핑 칸 값 (policy-cost-link-column §2.1-4·§2.2-3) — 품목코드마다 1개(같은 품목의 모든 가격 행이 같은 값).
 * 자재번호·자재명·후보 범위 여부만, **원가 금액 없음**. 서버 모듈(server/cost/item-link-types)의 ItemLinkCell 과 같은 모양
 * (화면은 원가 모듈을 import 하지 않는다).
 */
export type CostLinkCellView = {
  /** 매핑 후보 범위(본품 + 대상 제품군) 안 */
  inScope: boolean;
  link: {
    materialCode: string;
    /** 원가표에 자재가 없으면 null */
    materialName: string | null;
    inCostTable: boolean;
  } | null;
};
