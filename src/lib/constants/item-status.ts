/**
 * ERP 품목조회 파일의 품목상태 원문 라벨 → items.item_status (§4.3.2, Q-02).
 * 실제 파일이 아직 없어 스펙의 3개 라벨(임시/폐기/사용)을 그대로 쓴다. 파일 도착 후 원문 라벨만 여기에 추가한다.
 * 매핑되지 않는 값은 item_status=NULL + item_status_raw 보존 + 경고로 집계한다.
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

/** 품목 종류 1차 규칙 (§4.3.2): 중분류 'Parts' → 파츠. 나머지는 Q-02 답변 후 확정 */
export function deriveItemKind(categoryMid: string | null | undefined): '파츠' | null {
  return categoryMid?.trim().toLowerCase() === 'parts' ? '파츠' : null;
}
