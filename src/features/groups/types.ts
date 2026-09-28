/** 클라이언트 컴포넌트가 받는 솔루션 그룹 데이터 (서버 모듈을 import 하지 않도록 분리) */
export type GroupItemView = {
  itemCode: string;
  itemName: string;
  defaultQty: number;
  unitPrice: string | null;
  currency: string | null;
};

export type SolutionGroupView = {
  id: string;
  productFamily: string;
  name: string;
  items: GroupItemView[];
};

export type GroupCandidateView = {
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
};
