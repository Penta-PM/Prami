/** 클라이언트 컴포넌트가 받는 파츠 관리 데이터 (서버 모듈을 import 하지 않도록 분리) */
export type CatalogItemView = { itemCode: string; itemName: string };

export type PartMappingView = {
  modelItemCode: string;
  modelName: string;
  parts: CatalogItemView[];
};

export type PartsMode = 'manual' | 'excel';
