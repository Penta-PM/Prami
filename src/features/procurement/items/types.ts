/**
 * 클라이언트 표가 받는 등록 품목 행 (server/procurement ProcurementItemRow 와 같은 모양 — 클라이언트가 서버 모듈을 import 하지 않도록 분리).
 * 금액은 원 단위 정수, 날짜는 'YYYY-MM-DD'.
 */
export type ItemRowView = {
  id: number;
  itemId: string;
  product: string;
  detailCategory: string | null;
  manufacturer: string | null;
  itemName: string | null;
  registeredOn: string | null;
  /** 계약단가 (원) — 납품 이력이 없으면 null */
  unitPrice: number | null;
};
