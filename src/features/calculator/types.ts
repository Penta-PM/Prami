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
  /** 중분류 → 소분류 (서버가 미리 적재, 선택한 중분류의 소분류는 클라이언트에서 파생) */
  minorsByMid: Record<string, string[]>;
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

/** 공유 링크 (서버 QuoteShareView 와 동일 형태) */
export type QuoteShareView = {
  id: string;
  quoteId: string;
  quoteNo: string;
  token: string;
  path: string;
  expiresAt: string;
  createdAt: string;
  isActive: boolean;
};

/** 읽기 전용 견적서 문서 (서버 QuoteDocument 와 동일 형태, 원가 없음) */
export type QuoteDocumentView = {
  id: string;
  quoteNo: string;
  title: string;
  productFamily: string | null;
  summary: string | null;
  totalAmount: string | null;
  currency: string | null;
  subtotals: { currency: string; amount: number }[];
  createdAt: string;
  ownerName: string;
  lines: {
    lineNo: number;
    kind: 'item' | 'group';
    name: string;
    itemCode: string | null;
    priceType: string | null;
    qty: number;
    unitPrice: string;
    currency: string;
    discountRate: string;
    preDiscount: string;
    lineTotal: string;
    options: {
      label: '파츠' | '결합형' | '상세';
      itemCode: string;
      name: string;
      unitPrice: number;
      qty: number;
    }[];
  }[];
};

/** 서버 재가격화 보정 항목 (saveQuote 응답) */
export type PriceAdjustmentView = {
  lineNo: number;
  name: string;
  itemCode: string;
  field: 'unitPrice' | 'currency' | 'name';
  client: string;
  server: string;
};

/** 장바구니에 담는 라인 입력 (id·표시용 금액 제외 — 담을 때·복원할 때 계산) */
export type CartLineInput = Omit<CartLine, 'id' | 'preDiscount' | 'lineTotal'>;

/** 견적 계산기 선택 상태 (입력 초안 quote 의 화면 형태 — 품목은 재조회한 최신 행) */
export type QuoteFormState = {
  family: string;
  priceType: string | null;
  mid: string | null;
  minor: string | null;
  selected: QuoteItemView | null;
  qty: number;
  parts: string[];
  bundles: string[];
  rate: number;
  target: string;
};

/** 그룹 솔루션 선택 상태 (제품군별 — 다른 제품군의 그룹은 보이지 않는다) */
export type GroupItemState = { checked: boolean; qty: number };
export type GroupSelection = {
  family: string;
  groupId: string | null;
  hardwareCode: string;
  items: Record<string, GroupItemState>;
};

/** 순매출 계산기 저장 대상 입력 (원가 입력 제외 — page-state-memory §2.1-3) */
export type MarginDraftValues = { sellingPrice: string; quantity: string; discountRate: string };

/** 복원한 입력 초안 공통 정보 (page-state-memory §2.4·§2.6) */
export type DraftRestoreMeta = {
  /** 서버 초안의 마지막 수정 시각 (ISO) */
  updatedAt: string;
  /** 복원 배너 시각 `MM-DD HH:mm` (서버가 만든 문자열 — 하이드레이션 안전) */
  restoredAt: string;
  /** 복원 안내(최신가 갱신·판매 중지 제외·단계 멈춤) */
  notices: string[];
  /** 저장값과 화면 값이 달라졌다(최신가 갱신·제외·멈춤) — 복원 직후 화면 값을 다시 저장한다 */
  dirty: boolean;
};

export type QuoteDraftRestore = DraftRestoreMeta & { form: QuoteFormState };
export type CartDraftRestore = DraftRestoreMeta & { lines: CartLineInput[] };
export type MarginDraftRestore = DraftRestoreMeta & { values: MarginDraftValues };
export type GroupDraftRestore = DraftRestoreMeta & { selection: GroupSelection };

/** 초안 키 → 복원 형태 */
export type DraftRestoreMap = {
  quote: QuoteDraftRestore;
  cart: CartDraftRestore;
  margin: MarginDraftRestore;
  'group-solution': GroupDraftRestore;
};

/** 계산기 페이지가 RSC 에서 읽어 넘기는 초안 (없으면 그 키 없음) */
export type CalculatorDrafts = { [K in keyof DraftRestoreMap]?: DraftRestoreMap[K] };
