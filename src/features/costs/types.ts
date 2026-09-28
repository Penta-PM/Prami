/** 클라이언트 컴포넌트가 받는 원가 행 (서버 모듈을 import 하지 않도록 분리) */
export type CostRowView = {
  id: number;
  materialCode: string;
  materialName: string;
  unit: string;
  unitCost: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  operationStatus: '운영중' | '미사용';
  productFamily: string | null;
  remark: string | null;
  source: 'erp' | 'manual';
};

export type CostFilterView = {
  family?: string;
  dateMode: 'start' | 'period';
  from?: string;
  to?: string;
  q?: string;
  page: number;
};

export type CostFamilyTab = { family: string; count: number };
