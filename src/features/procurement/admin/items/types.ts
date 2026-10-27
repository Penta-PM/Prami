import type { ItemTarget } from '@/lib/procurement/item-admin';
import type { AdminItemRow, ItemReviewQueue, ItemTrashRow } from '@/server/procurement/admin-items';
import type { Paged } from '@/server/procurement/shared';

export type { AdminItemRow, ItemTrashRow } from '@/server/procurement/admin-items';

/** 품목 관리 화면 데이터 — 서버 섹션(ItemsAdminSection)이 URL 조건으로 불러와 패널에 넘긴다 */
export type ItemsAdminData = {
  queue: ItemReviewQueue;
  registered: Paged<AdminItemRow>;
  trash: Paged<ItemTrashRow>;
  /** 제품 → 이미 쓰는 세부분류 (입력 제안) */
  detailOptions: Record<string, string[]>;
};

export function toTarget(row: Pick<AdminItemRow, 'id' | 'version'>): ItemTarget {
  return { id: row.id, version: row.version };
}
