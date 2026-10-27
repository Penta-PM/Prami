import 'server-only';

import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { procurementItemChanges, procurementItems } from '@/db/schema/procurement';
import type { AdminItemSortId } from '@/lib/procurement/admin-items-filter';
import {
  ITEM_ADMIN_PAGE_SIZE,
  ITEM_REVIEW_LIMIT,
  ITEM_TRASH_PAGE_SIZE,
} from '@/lib/procurement/item-admin';

import type { SortDir } from '@/lib/table/compare';
import type { SortState } from '@/lib/table/sort-param';
import { buildOrderBy, byText, byValue } from '@/server/pricing/sort-sql';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { countRows, escapeLike, pageWindow, type Paged } from './shared';

/**
 * 품목 관리 조회 (조달이 통합 UI-7, 관리자 = procurement.write). 일일 신규 품목(검토 대기)·등록 품목·휴지통.
 * 상태(원본 DDL): pending = 제품 미정 검토 대기, active = 등록, excluded = 휴지통. reviewed=false 면 "일일 신규 품목"에 올라온다.
 * 정렬·필터·페이지네이션은 SQL. 각 행의 version(updated_at, 마이크로초)은 저장 시 동시 편집 재검증에 쓴다(item-mutations).
 */

const t = procurementItems;
const c = procurementItemChanges;

export type AdminItemRow = {
  id: number;
  itemId: string;
  product: string;
  productGroup: string | null;
  detailCategory: string | null;
  manufacturer: string | null;
  itemName: string | null;
  registeredOn: string | null;
  collectedOn: string | null;
  status: string;
  reviewed: boolean;
  source: string;
  /** updated_at 의 epoch 마이크로초 (문자열) — 동시 편집 재검증 토큰 */
  version: string;
};

export type ItemTrashRow = AdminItemRow & {
  /** 마지막 exclude 이력의 changed_by (사용자 이메일, 자동 수집이면 system). 이력이 없으면 null */
  deletedBy: string | null;
  /** 마지막 exclude 이력 시각 (ISO) */
  deletedAt: string | null;
};

/** updated_at → epoch 마이크로초 문자열 (JS Date 의 밀리초 정밀도로는 같은 밀리초 안의 두 변경을 구분하지 못한다) */
export function itemVersionSql(): SQL<string> {
  return sql<string>`(extract(epoch from ${t.updatedAt}) * 1000000)::bigint::text`;
}

export const ADMIN_ITEM_SELECTION = {
  id: t.id,
  itemId: t.itemId,
  product: t.product,
  productGroup: t.productGroup,
  detailCategory: t.detailCategory,
  manufacturer: t.manufacturer,
  itemName: t.itemName,
  registeredOn: t.registeredOn,
  collectedOn: t.collectedOn,
  status: t.status,
  reviewed: t.reviewed,
  source: t.source,
  version: itemVersionSql(),
};

/** 일일 신규 품목 = 제품 미정(pending) + 자동 분류됐지만 사람이 아직 확인하지 않은 등록(active, reviewed=false) */
export function reviewQueueWhere(): SQL {
  return or(eq(t.status, 'pending'), and(eq(t.status, 'active'), eq(t.reviewed, false))) as SQL;
}

/** 등록일자 최신순 → 물품식별번호 → id (stable) */
const LATEST_FIRST: SQL[] = [sql`${t.registeredOn} desc nulls last`, asc(t.itemId), asc(t.id)];

export type ItemReviewQueue = { rows: AdminItemRow[]; total: number };

/** 일일 신규 품목 (검토 대기). 최대 ITEM_REVIEW_LIMIT 행 + 전체 건수 */
export async function getItemReviewQueue(
  access: ProcurementAccess,
  db: Db,
): Promise<ItemReviewQueue> {
  assertProcurementAccess(access, 'write');
  const where = reviewQueueWhere();
  const [counted] = await db.select({ total: countRows() }).from(t).where(where);
  const rows = await db
    .select(ADMIN_ITEM_SELECTION)
    .from(t)
    .where(where)
    .orderBy(...LATEST_FIRST)
    .limit(ITEM_REVIEW_LIMIT);
  return { rows, total: counted?.total ?? 0 };
}

export type AdminItemFilter = {
  /** 물품식별번호·품목명·제조사 부분 일치 */
  q?: string;
  /** 제품 하나 (비우면 전체) */
  product?: string | null;
  page?: number;
  /** 없으면 등록일자 최신순 */
  sort?: SortState<AdminItemSortId> | null;
};

const ADMIN_ITEM_SORT_SQL: Record<AdminItemSortId, (dir: SortDir) => SQL[]> = {
  registeredOn: (dir) => [byValue(t.registeredOn, dir)],
  product: (dir) => byText(t.product, dir),
  detailCategory: (dir) => byText(t.detailCategory, dir),
  manufacturer: (dir) => byText(t.manufacturer, dir),
  itemId: (dir) => byText(t.itemId, dir),
  itemName: (dir) => byText(t.itemName, dir),
};

/** 등록 품목 관리 표 (status active) 한 페이지 */
export async function getAdminItemRows(
  access: ProcurementAccess,
  db: Db,
  filter: AdminItemFilter = {},
): Promise<Paged<AdminItemRow>> {
  assertProcurementAccess(access, 'write');
  const conditions: SQL[] = [eq(t.status, 'active') as SQL];
  if (filter.product) conditions.push(eq(t.product, filter.product) as SQL);
  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      sql`(${t.itemId} ilike ${pattern} or ${t.itemName} ilike ${pattern} or ${t.manufacturer} ilike ${pattern})`,
    );
  }
  const where = and(...conditions);
  const [counted] = await db.select({ total: countRows() }).from(t).where(where);
  const total = counted?.total ?? 0;
  const pageSize = ITEM_ADMIN_PAGE_SIZE;
  const { page, pageCount, offset } = pageWindow(total, filter.page ?? 1, pageSize);
  const rows = await db
    .select(ADMIN_ITEM_SELECTION)
    .from(t)
    .where(where)
    .orderBy(...buildOrderBy(filter.sort ?? undefined, ADMIN_ITEM_SORT_SQL, LATEST_FIRST))
    .limit(pageSize)
    .offset(offset);
  return { rows, total, page, pageCount, pageSize };
}

/**
 * 휴지통 (status excluded) 한 페이지 — 삭제자·삭제 시각은 그 물품의 마지막 exclude 이력(item_changes)이다(원본 TrashPanel 과 같은 규칙).
 * 삭제 시각 최신순(이력이 없는 행은 뒤).
 */
export async function getItemTrash(
  access: ProcurementAccess,
  db: Db,
  requestedPage = 1,
): Promise<Paged<ItemTrashRow>> {
  assertProcurementAccess(access, 'write');
  const where = eq(t.status, 'excluded');
  const [counted] = await db.select({ total: countRows() }).from(t).where(where);
  const total = counted?.total ?? 0;
  const pageSize = ITEM_TRASH_PAGE_SIZE;
  const { page, pageCount, offset } = pageWindow(total, requestedPage, pageSize);
  const lastExclude = db
    .selectDistinctOn([c.itemPk], {
      itemPk: c.itemPk,
      changedBy: c.changedBy,
      changedAt: c.changedAt,
    })
    .from(c)
    .where(eq(c.action, 'exclude'))
    .orderBy(c.itemPk, desc(c.changedAt), desc(c.id))
    .as('last_exclude');
  const rows = await db
    .select({
      ...ADMIN_ITEM_SELECTION,
      deletedBy: lastExclude.changedBy,
      deletedAt: lastExclude.changedAt,
    })
    .from(t)
    .leftJoin(lastExclude, eq(lastExclude.itemPk, t.id))
    .where(where)
    .orderBy(sql`${lastExclude.changedAt} desc nulls last`, desc(t.updatedAt), asc(t.id))
    .limit(pageSize)
    .offset(offset);
  return {
    rows: rows.map((row) => ({
      ...row,
      deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    })),
    total,
    page,
    pageCount,
    pageSize,
  };
}

/** 세부분류 입력 제안 (datalist) — 제품별로 이미 쓰는 세부분류(휴지통 제외), 가나다순 */
export async function getItemDetailOptions(
  access: ProcurementAccess,
  db: Db,
): Promise<Record<string, string[]>> {
  assertProcurementAccess(access, 'write');
  const rows = await db
    .selectDistinct({ product: t.product, detailCategory: sql<string>`btrim(${t.detailCategory})` })
    .from(t)
    .where(
      and(ne(t.status, 'excluded'), sql`coalesce(btrim(${t.detailCategory}), '') <> ''`) as SQL,
    );
  const byProduct: Record<string, string[]> = {};
  for (const row of rows) (byProduct[row.product] ??= []).push(row.detailCategory);
  for (const list of Object.values(byProduct)) list.sort((a, b) => a.localeCompare(b, 'ko'));
  return byProduct;
}

/** id 목록의 현재 행 (잠금 없이 — 화면 갱신·테스트용) */
export async function getAdminItemsByIds(
  access: ProcurementAccess,
  db: Db,
  ids: readonly number[],
): Promise<AdminItemRow[]> {
  assertProcurementAccess(access, 'write');
  if (ids.length === 0) return [];
  return db
    .select(ADMIN_ITEM_SELECTION)
    .from(t)
    .where(inArray(t.id, [...ids]))
    .orderBy(asc(t.id));
}
