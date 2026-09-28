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
};

export type CategoryOptionsView = {
  majors: string[];
  mids: string[];
  minors: string[];
  hasMaster: boolean;
};
