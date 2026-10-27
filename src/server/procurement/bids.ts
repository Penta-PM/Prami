import 'server-only';

import { and, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { procurementBidNotices } from '@/db/schema/procurement';
import { PROCUREMENT_PRODUCTS, type ProcurementProduct } from '@/lib/procurement/constants';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { countRows, pageSizeOf, pageWindow, type Paged } from './shared';

/**
 * 입찰 공고 (UI-3). 관련 제품(products)이 빈 공고는 숨긴다(원본 화면 규칙).
 * - 진행 중 = 마감 시각이 없거나 기준 시각(now)보다 뒤. "마감 포함"이면 마감된 공고도 보인다.
 * - D-day = 마감일(KST 날짜) − 기준일(KST 날짜). 0 = 오늘 마감, 음수 = 지난 마감, 마감 시각 없음 = null.
 * - 정렬 fit = 적합도 등급(상→중→하→없음) → 점수 높은 순 → 공고 최신순. posted = 공고 최신순.
 */

export const BID_SORTS = ['fit', 'posted'] as const;
export type BidSort = (typeof BID_SORTS)[number];

export type BidNoticeFilter = {
  /** 제품 칩 (null·생략 = 전체) */
  product?: ProcurementProduct | null;
  /** 마감된 공고 포함 (기본 false = 진행 중만) */
  includeClosed?: boolean;
  /** 적합도 '상'만 */
  topGradeOnly?: boolean;
  sort?: BidSort;
  page?: number;
  pageSize?: number;
  /** 진행 중·D-day 기준 시각 (기본 지금 — 테스트에서 고정) */
  now?: Date;
};

export type BidNoticeRow = {
  bidNo: string;
  bidOrd: string;
  title: string;
  products: string[];
  businessType: string | null;
  orderOrg: string | null;
  demandOrg: string | null;
  postedAt: Date | null;
  deadlineAt: Date | null;
  /** 배정예산 (원) */
  budget: number | null;
  /** 추정가격 (원) */
  estPrice: number | null;
  noticeStatus: string | null;
  detailUrl: string | null;
  keywords: string[];
  fitGrade: string | null;
  fitScore: number | null;
  fitReasons: string[];
  /** 마감됨 (deadline_at <= now) */
  closed: boolean;
  /** 마감까지 남은 날 (KST 날짜 기준), 마감 시각 없으면 null */
  daysLeft: number | null;
};

export type BidNoticePage = Paged<BidNoticeRow> & {
  /** 제품 칩 건수 — 진행 중·'상'만 조건은 반영, 제품 선택은 반영하지 않는다 */
  productCounts: { product: ProcurementProduct; count: number }[];
  /** 칩 '전체' 건수 */
  allCount: number;
};

const b = procurementBidNotices;
const KST = 'Asia/Seoul';

function baseConditions(filter: BidNoticeFilter, now: Date): SQL[] {
  const conditions: SQL[] = [sql`cardinality(${b.products}) > 0`];
  if (!filter.includeClosed)
    conditions.push(
      sql`(${b.deadlineAt} is null or ${b.deadlineAt} > ${now.toISOString()}::timestamptz)`,
    );
  if (filter.topGradeOnly) conditions.push(sql`${b.fitGrade} = '상'`);
  return conditions;
}

function productCondition(product: string): SQL {
  return sql`${product} = any(${b.products})`;
}

const FIT_ORDER: SQL[] = [
  sql`(case ${b.fitGrade} when '상' then 0 when '중' then 1 when '하' then 2 end) asc nulls last`,
  sql`${b.fitScore} desc nulls last`,
  sql`${b.postedAt} desc nulls last`,
  sql`${b.bidNo} asc`,
];
const POSTED_ORDER: SQL[] = [sql`${b.postedAt} desc nulls last`, sql`${b.bidNo} asc`];

/** 입찰 공고 표 한 페이지 + 제품 칩 건수 */
export async function getBidNoticeRows(
  access: ProcurementAccess,
  db: Db,
  filter: BidNoticeFilter = {},
): Promise<BidNoticePage> {
  assertProcurementAccess(access, 'read');
  if (filter.product && !(PROCUREMENT_PRODUCTS as readonly string[]).includes(filter.product))
    throw new RangeError(`알 수 없는 제품: ${filter.product}`);
  const now = filter.now ?? new Date();
  const pageSize = pageSizeOf(filter.pageSize);
  const base = baseConditions(filter, now);

  // 칩 건수(제품별·전체)와 현재 선택의 건수를 한 번에
  const perProduct = Object.fromEntries(
    PROCUREMENT_PRODUCTS.map((product) => [
      product,
      sql<number>`count(*) filter (where ${productCondition(product)})::int`.mapWith(Number),
    ]),
  ) as Record<ProcurementProduct, SQL<number>>;
  const [counts] = await db
    .select({ all: countRows(), ...perProduct })
    .from(b)
    .where(and(...base));
  const productCounts = PROCUREMENT_PRODUCTS.map((product) => ({
    product,
    count: counts?.[product] ?? 0,
  }));
  const allCount = counts?.all ?? 0;
  const total = filter.product
    ? (productCounts.find((entry) => entry.product === filter.product)?.count ?? 0)
    : allCount;

  const where = and(...base, ...(filter.product ? [productCondition(filter.product)] : []));
  const { page, pageCount, offset } = pageWindow(total, filter.page ?? 1, pageSize);
  const nowParam = sql`${now.toISOString()}::timestamptz`;
  const rows = await db
    .select({
      bidNo: b.bidNo,
      bidOrd: b.bidOrd,
      title: b.title,
      products: b.products,
      businessType: b.businessType,
      orderOrg: b.orderOrg,
      demandOrg: b.demandOrg,
      postedAt: b.postedAt,
      deadlineAt: b.deadlineAt,
      budget: b.budget,
      estPrice: b.estPrice,
      noticeStatus: b.noticeStatus,
      detailUrl: b.detailUrl,
      keywords: b.keywords,
      fitGrade: b.fitGrade,
      fitScore: b.fitScore,
      fitReasons: b.fitReasons,
      closed: sql<boolean>`coalesce(${b.deadlineAt} <= ${nowParam}, false)`,
      daysLeft: sql<
        number | null
      >`((${b.deadlineAt} at time zone ${KST})::date - (${nowParam} at time zone ${KST})::date)`.mapWith(
        Number,
      ),
    })
    .from(b)
    .where(where)
    .orderBy(...(filter.sort === 'posted' ? POSTED_ORDER : FIT_ORDER))
    .limit(pageSize)
    .offset(offset);
  return { rows, total, page, pageCount, pageSize, productCounts, allCount };
}
