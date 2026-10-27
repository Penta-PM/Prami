import 'server-only';

import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { procurementDeliveries, procurementDeliveryChanges } from '@/db/schema/procurement';
import {
  DELIVERY_EDIT_FIELDS,
  DELIVERY_HISTORY_LIMIT,
  EXCLUDED_COLUMN,
  type DeliveryValues,
} from '@/features/procurement/admin/deliveries/fields';
import {
  DELIVERY_NO_PRODUCT,
  DELIVERY_PAGE_SIZE,
  type DeliveryListQuery,
  type DeliverySortId,
} from '@/lib/procurement/admin-deliveries-filter';
import type { SortDir } from '@/lib/table/compare';
import { buildOrderBy, byText, byValue } from '@/server/pricing/sort-sql';
import { filterSqlConditions, type FilterSpec } from '@/server/table/filter-sql';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { countRows, escapeLike, pageSizeOf, pageWindow, type Paged } from './shared';

/**
 * 조달 관리 · 실적 관리 조회 (조달이 통합 UI-6, procurement.write = ADMIN). 통계용 뷰(v_deliveries — 첫 차수·제외 숨김)가 아니라
 * deliveries 원 행(변경차수마다 한 줄)을 그대로 본다 — 편집·제외·복원 대상이 행 하나이고, 휴지통(excluded = true)도 보여야 하므로.
 * 정렬·필터·페이지네이션은 전부 SQL. 금액은 원 단위 정수(number).
 *
 * 제품 = 같은 물품식별번호의 등록 물품(items.status 'active') 제품. 연결된 등록 물품이 없으면 null(화면 '미등록').
 */

const d = procurementDeliveries;
const c = procurementDeliveryChanges;

/**
 * 바깥 deliveries 행 참조 — 상관 서브쿼리 안에서 Drizzle 열(`"item_id"`)은 표 이름 없이 그려져 안쪽 표의 같은 이름 열로 묶이므로
 * 표 이름을 붙인 고정 SQL 로 쓴다(바깥 FROM 은 별칭 없는 procurement.deliveries).
 */
const OUTER_ITEM_ID = sql.raw('"deliveries"."item_id"');
const OUTER_ID = sql.raw('"deliveries"."id"');

/** 제품 — 등록 물품(active) 중 가장 먼저 등록된 줄의 제품(물품식별번호 하나에 제품이 여럿인 경우는 원본에도 없다) */
const PRODUCT_SQL = sql<string | null>`(select i.product from procurement.items i
  where i.item_id = ${OUTER_ITEM_ID} and i.status = 'active' order by i.id limit 1)`;

/** 마지막 휴지통 이동 기록 (after.excluded = true 인 가장 최근 이력) — 휴지통의 삭제 시각·삭제한 사람 */
const LAST_EXCLUDE = sql`(select ch.changed_at, ch.changed_by from procurement.delivery_changes ch
  where ch.delivery_id = ${OUTER_ID} and (ch.after ->> ${EXCLUDED_COLUMN}) = 'true'
  order by ch.changed_at desc, ch.id desc limit 1)`;
const EXCLUDED_AT_SQL = sql<string | null>`(select x.changed_at from ${LAST_EXCLUDE} x)`;
const EXCLUDED_BY_SQL = sql<string | null>`(select x.changed_by from ${LAST_EXCLUDE} x)`;

export type DeliveryAdminRow = {
  id: number;
  dlvrReqNo: string;
  changeOrd: string;
  dlvrReqDate: string | null;
  product: string | null;
  demandOrg: string | null;
  vendor: string | null;
  itemId: string;
  itemName: string | null;
  /** 납품수량 (numeric 문자열) */
  quantity: string | null;
  /** 계약단가 (원) */
  unitPrice: number | null;
  /** 납품금액 (원) */
  amount: number | null;
  excluded: boolean;
  /** 휴지통: 마지막 삭제 시각 (ISO) — 이력이 없으면 null */
  excludedAt: string | null;
  /** 휴지통: 마지막 삭제한 사람 (이메일) */
  excludedBy: string | null;
};

export type DeliveryAdminFacets = {
  /** 제품 선택지 (연결 없음 = '미등록') */
  products: string[];
  vendors: string[];
};

export type DeliveryAdminPage = Paged<DeliveryAdminRow> & {
  /** 휴지통 건수 (하위 탭 배지) */
  trashCount: number;
};

const SORT_SQL: Record<DeliverySortId, (dir: SortDir) => SQL[]> = {
  dlvrReqDate: (dir) => [byValue(d.dlvrReqDate, dir)],
  product: (dir) => byText(PRODUCT_SQL, dir),
  demandOrg: (dir) => byText(d.demandOrg, dir),
  vendor: (dir) => byText(d.vendor, dir),
  itemId: (dir) => byText(d.itemId, dir),
  itemName: (dir) => byText(d.itemName, dir),
  quantity: (dir) => [byValue(d.quantity, dir)],
  unitPrice: (dir) => [byValue(d.unitPrice, dir)],
  amount: (dir) => [byValue(d.amount, dir)],
  excludedAt: (dir) => [byValue(EXCLUDED_AT_SQL, dir)],
};

/** 기본: 납품요구일자 최신순(휴지통은 삭제 시각 최신순) → 요구번호 → 차수 → id */
const ACTIVE_ORDER: SQL[] = [
  sql`${d.dlvrReqDate} desc nulls last`,
  desc(d.dlvrReqNo),
  asc(d.changeOrd),
  asc(d.id),
];
const TRASH_ORDER: SQL[] = [sql`${EXCLUDED_AT_SQL} desc nulls last`, ...ACTIVE_ORDER];

type ListFilter = Omit<DeliveryListQuery, 'page' | 'sort'>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEMAND_ORG_FILTER: FilterSpec = { demandOrg: { def: { kind: 'text' }, expr: d.demandOrg } };

function productCondition(products: readonly string[]): SQL {
  const named = products.filter((product) => product !== DELIVERY_NO_PRODUCT);
  const parts: SQL[] = [];
  if (named.length > 0)
    parts.push(
      sql`${PRODUCT_SQL} in (${sql.join(
        named.map((p) => sql`${p}`),
        sql`, `,
      )})`,
    );
  if (named.length !== products.length) parts.push(sql`${PRODUCT_SQL} is null`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

function buildWhere(filter: ListFilter, view = filter.view): SQL | undefined {
  const conditions: SQL[] = [eq(d.excluded, view === 'trash') as SQL];
  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      sql`(${d.dlvrReqNo} ilike ${pattern} or ${d.itemId} ilike ${pattern} or ${d.itemName} ilike ${pattern}
        or ${d.demandOrg} ilike ${pattern} or ${d.businessName} ilike ${pattern})`,
    );
  }
  if (filter.products?.length) conditions.push(productCondition(filter.products));
  if (filter.vendors?.length) conditions.push(inArray(d.vendor, [...filter.vendors]) as SQL);
  // 수요기관 '포함'·'같음' = 다른 서버 표와 같은 열 필터 SQL(server/table/filter-sql — ASCII 대소문자 무시, 빈 값 제외)
  if (filter.demandOrg)
    conditions.push(
      ...filterSqlConditions(
        [{ col: 'demandOrg', op: filter.demandOrg.op, value: filter.demandOrg.value.trim() }],
        DEMAND_ORG_FILTER,
      ),
    );
  for (const [value, op] of [
    [filter.dateFrom, sql.raw('>=')],
    [filter.dateTo, sql.raw('<=')],
  ] as const) {
    if (!value) continue;
    if (!DATE_RE.test(value)) throw new RangeError(`날짜 형식이 아닙니다 (YYYY-MM-DD): ${value}`);
    conditions.push(sql`${d.dlvrReqDate} ${op} ${value}::date`);
  }
  return and(...conditions);
}

/** 실적 관리 표 한 페이지 (기본 50행) + 휴지통 건수 */
export async function getDeliveryAdminRows(
  access: ProcurementAccess,
  db: Db,
  query: DeliveryListQuery,
  pageSize: number = DELIVERY_PAGE_SIZE,
): Promise<DeliveryAdminPage> {
  assertProcurementAccess(access, 'write');
  const size = pageSizeOf(pageSize);
  const where = buildWhere(query);
  const [counted] = await db
    .select({
      total: countRows(),
      trash:
        sql<number>`(select count(*)::int from procurement.deliveries t where t.excluded)`.mapWith(
          Number,
        ),
    })
    .from(d)
    .where(where);
  const total = counted?.total ?? 0;
  // 표가 비어도 휴지통 건수는 따로 센다(위 select 는 결과가 0행이면 count(*) 1행 — 항상 한 줄)
  const trashCount = counted?.trash ?? 0;
  const { page, pageCount, offset } = pageWindow(total, query.page ?? 1, size);
  const rows = await db
    .select({
      id: d.id,
      dlvrReqNo: d.dlvrReqNo,
      changeOrd: d.changeOrd,
      dlvrReqDate: d.dlvrReqDate,
      product: PRODUCT_SQL,
      demandOrg: d.demandOrg,
      vendor: d.vendor,
      itemId: d.itemId,
      itemName: d.itemName,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      amount: d.amount,
      excluded: d.excluded,
      excludedAt: sql<
        string | null
      >`to_char(${EXCLUDED_AT_SQL} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      excludedBy: EXCLUDED_BY_SQL,
    })
    .from(d)
    .where(where)
    .orderBy(
      ...buildOrderBy(query.sort, SORT_SQL, query.view === 'trash' ? TRASH_ORDER : ACTIVE_ORDER),
    )
    .limit(size)
    .offset(offset);
  return { rows, total, page, pageCount, pageSize: size, trashCount };
}

/** 빠른 필터 바 선택지 (제품·납품업체) — 그 하위 화면(납품요구/휴지통) 전체 기준, 값 오름차순 */
export async function getDeliveryAdminFacets(
  access: ProcurementAccess,
  db: Db,
  view: DeliveryListQuery['view'],
): Promise<DeliveryAdminFacets> {
  assertProcurementAccess(access, 'write');
  const base = eq(d.excluded, view === 'trash');
  const [productRows, vendorRows] = await Promise.all([
    db
      .selectDistinct({ value: sql<string>`coalesce(${PRODUCT_SQL}, ${DELIVERY_NO_PRODUCT})` })
      .from(d)
      .where(base),
    db
      .select({ value: sql<string>`${d.vendor}` })
      .from(d)
      .where(and(base, sql`coalesce(btrim(${d.vendor}), '') <> ''`))
      .groupBy(d.vendor)
      .orderBy(sql`${d.vendor} collate "C"`),
  ]);
  const products = productRows.map((row) => row.value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { products, vendors: vendorRows.map((row) => row.value) };
}

// ── 단건 (편집) ─────────────────────────────────────────────────────────

/** 편집 대상 열 선택 (DELIVERY_EDIT_FIELDS 순서) */
export const DELIVERY_EDIT_SELECTION = Object.fromEntries(
  DELIVERY_EDIT_FIELDS.map((field) => [field.key, d[field.key]]),
) as { [K in (typeof DELIVERY_EDIT_FIELDS)[number]['key']]: (typeof d)[K] };

export type DeliveryHistoryEntry = {
  id: number;
  /** 바뀐 칸만 (키 = DB 열 이름) */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedBy: string | null;
  /** ISO */
  changedAt: string;
};

export type DeliveryDetail = {
  id: number;
  excluded: boolean;
  values: DeliveryValues;
  /** 최근 변경 이력 (최신순, 최대 DELIVERY_HISTORY_LIMIT 건) */
  history: DeliveryHistoryEntry[];
};

/** 납품요구 한 행의 변경 이력 (최신순) */
export async function getDeliveryHistory(
  access: ProcurementAccess,
  db: Db,
  id: number,
  limit: number = DELIVERY_HISTORY_LIMIT,
): Promise<DeliveryHistoryEntry[]> {
  assertProcurementAccess(access, 'write');
  const rows = await db
    .select({
      id: c.id,
      before: c.before,
      after: c.after,
      changedBy: c.changedBy,
      changedAt: c.changedAt,
    })
    .from(c)
    .where(eq(c.deliveryId, id))
    .orderBy(desc(c.changedAt), desc(c.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, changedAt: row.changedAt.toISOString() }));
}

/** 편집 화면 데이터: 전 필드 + 최근 이력 10건. 없으면 null */
export async function getDeliveryDetail(
  access: ProcurementAccess,
  db: Db,
  id: number,
): Promise<DeliveryDetail | null> {
  assertProcurementAccess(access, 'write');
  const [row] = await db
    .select({ id: d.id, excluded: d.excluded, ...DELIVERY_EDIT_SELECTION })
    .from(d)
    .where(eq(d.id, id))
    .limit(1);
  if (!row) return null;
  const { id: rowId, excluded, ...values } = row;
  return {
    id: rowId,
    excluded,
    values: values as DeliveryValues,
    history: await getDeliveryHistory(access, db, id),
  };
}
