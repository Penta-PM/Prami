/**
 * ERP 품목조회 파일의 `품목 상태` 원문 → items.item_status (PRAMI-003 §4.2.6 **확정**).
 * 실파일 라벨은 임시·폐기·사용 3종뿐이다(원문 = enum). 매핑되지 않는 라벨은 임포트 행 오류(`unmapped_status`).
 */
export const ITEM_STATUSES = ['임시', '폐기', '사용'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_MAP: Readonly<Record<string, ItemStatus>> = {
  임시: '임시',
  폐기: '폐기',
  사용: '사용',
};

/** 마스터에 없는(stub) 품번의 화면 표시 라벨 */
export const ITEM_STATUS_UNKNOWN = '미확인';

export function mapItemStatus(raw: string | null | undefined): ItemStatus | null {
  if (!raw) return null;
  return ITEM_STATUS_MAP[raw.trim()] ?? null;
}
