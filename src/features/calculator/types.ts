/** 클라이언트 컴포넌트가 주고받는 계산기 데이터 (서버 모듈을 import 하지 않도록 분리) */
export type PricedOptionView = { itemCode: string; itemName: string; unitPrice: number };

export type GroupItemLine = PricedOptionView & { qty: number };

/** 장바구니 라인 = 견적 라인 입력 그대로 (가격 스냅샷 포함) */
export type CartLine = {
  id: string;
  kind: 'item' | 'group';
  itemCode?: string;
  groupId?: string;
  name: string;
  priceType?: string;
  qty: number;
  unitPrice: number;
  currency: string;
  parts: PricedOptionView[];
  bundles: PricedOptionView[];
  groupItems: GroupItemLine[];
  discountRate: number;
  /** 화면 표시용(서버가 저장 시 다시 계산한다) */
  preDiscount: number;
  lineTotal: number;
};

export type QuoteItemView = {
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
  priceType: string;
  kind: string;
};

export type PriceTypeView = { priceType: string; count: number };

export type CategoryChipsView = {
  majors: string[];
  mids: string[];
  minors: string[];
  hasMaster: boolean;
};

export type GroupChipView = {
  id: string;
  productFamily: string;
  name: string;
  items: {
    itemCode: string;
    itemName: string;
    defaultQty: number;
    unitPrice: string | null;
    currency: string | null;
  }[];
};

export type SavedQuoteView = {
  id: string;
  quoteNo: string;
  productFamily: string | null;
  title: string;
  summary: string | null;
  totalAmount: string | null;
  currency: string | null;
  createdAt: string;
  ownerUserId: string;
  lines: {
    kind: 'item' | 'group';
    itemCode: string | null;
    groupId: string | null;
    priceType: string | null;
    name: string;
    qty: number;
    unitPrice: string;
    currency: string;
    parts: PricedOptionView[];
    bundles: PricedOptionView[];
    groupItems: GroupItemLine[];
    discountRate: string;
    preDiscount: string;
    lineTotal: string;
  }[];
};

/** 페이지가 제품군별로 미리 내려주는 STEP1·STEP2·그룹 데이터 */
export type FamilyPreload = {
  family: string;
  priceTypes: PriceTypeView[];
  categories: CategoryChipsView;
  groups: GroupChipView[];
  hardware: QuoteItemView[];
};
