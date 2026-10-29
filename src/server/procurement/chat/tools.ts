import 'server-only';

import { z } from 'zod';

import { hasPermission } from '@/lib/constants/permissions';
import {
  PROCUREMENT_PRODUCTS,
  isOurManufacturer,
  type ProcurementProductTab,
} from '@/lib/procurement/constants';
import { formatEokMan } from '@/lib/procurement/format';
import type { ChatFeature, ChatToolDef, ToolActor } from '@/server/chat/features/types';

import { grantProcurementAccess, type ProcurementAccess } from '../access-token';
import { getBidNoticeRows, type BidNoticeRow } from '../bids';
import { getCollectionStatus } from '../collection';
import { getProcurementItemRows } from '../items';
import {
  getManufacturerPerformance,
  getMonthContracts,
  getMonthVolumes,
  getPerformanceKpis,
  limitKeepingOurs,
} from '../performance';
import { PROCUREMENT_MAX_PAGE_SIZE, type MonthPeriod } from '../shared';

/**
 * 조달 챗봇 도구 (UX 4건 §4.2, PR-C3) — **읽기 전용**. 화면(실적 현황·등록 품목·입찰 공고·실적 월 계약 목록)이 쓰는 조회 함수를
 * 그대로 재사용하고, procurement.read 사용자가 화면에서 이미 볼 수 있는 범위만 돌려준다.
 * - 권한: 기능 permission = procurement.read(그래프가 노출·실행 2중 검사) + 실행 시 여기서 한 번 더 확인한 뒤에만 read 토큰을 만든다.
 * - 출력은 **필드 화이트리스트**(strict zod) + 행 상한(ROW_MAX) + 텍스트 길이 상한. DB 행을 그대로 넘기지 않는다.
 *   공고명·기관명 등은 외부에서 수집한 텍스트라 프롬프트 인젝션 대비로 제어·서식 문자를 지우고 잘라 낸다(지시가 들어 있어도 데이터).
 * - 금액은 조달 계약·납품 금액(원)이다 — 원가가 아니다. 응답 키 이름에 'cost' 를 쓰지 않는다(assertNoCostKeys).
 */
export const PROCUREMENT_CHAT_ROW_MAX = 10;
export const PROCUREMENT_CHAT_TOP_MANUFACTURERS = 5;
export const PROCUREMENT_CHAT_TEXT_MAX = {
  title: 120,
  name: 80,
  org: 60,
  manufacturer: 40,
  reason: 60,
  code: 40,
  label: 30,
} as const;
const REASON_MAX = 3;

/** 조달 도구 실행 토큰 — 권한을 다시 확인하고 read 토큰만 만든다(감사 actor = 사용자 id) */
export function chatProcurementAccess(actor: ToolActor): ProcurementAccess {
  if (!hasPermission(actor.role, 'procurement.read')) {
    throw new Error('procurement.read 권한이 없습니다');
  }
  return grantProcurementAccess({ id: actor.userId, email: 'chatbot' }, 'read');
}

// ── 공통: 텍스트 정리·금액 표기 ───────────────────────────────────────

/** 제어 문자·제로폭·양방향 서식 문자 (외부 수집 텍스트에서 지운다) */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const ELLIPSIS = '\u2026';

/**
 * 표 칸 구분 `|` → 전각 `｜` (챗봇 마크다운 렌더 §2.2): 모델이 외부 문구를 표 칸에 그대로 옮겨도 칸이 갈라지지 않는다.
 * 이스케이프(`\|`)가 아니라 글자 치환이라 가드의 품명 가림이 그대로 맞고(NFKC 가 판정용 사본에서 `|` 로 되돌림), 보이는 모양도 같다.
 */
const TABLE_PIPE = /\|/g;

/** 공백 정리 + 숨은 문자 제거 + 표 칸 구분 치환 + 길이 상한(UTF-16 길이 기준, 코드 포인트를 가르지 않음). 빈 값은 null */
export function clipText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.replace(HIDDEN, ' ').replace(/\s+/g, ' ').replace(TABLE_PIPE, '｜').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  let out = '';
  for (const char of clean) {
    if (out.length + char.length > max - ELLIPSIS.length) break;
    out += char;
  }
  return `${out}${ELLIPSIS}`;
}

const text = (max: number) => z.string().max(max).nullable();

/** 원 → `12억 3,400만원` (조달 화면 KPI 표기 + 원). 값 없음 = null */
export function wonText(won: number | null | undefined): string | null {
  if (typeof won !== 'number' || !Number.isFinite(won)) return null;
  const formatted = formatEokMan(won);
  return formatted.endsWith('원') ? formatted : `${formatted}원`;
}

/** 비율(0~1) → 퍼센트 소수 1자리 */
function percent(ratio: number | null | undefined): number | null {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? Math.round(ratio * 1000) / 10 : null;
}

const KST = 'Asia/Seoul';
const kstDateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Date → KST `YYYY-MM-DD HH:mm` */
function kstText(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return kstDateTime.format(value).replace('T', ' ');
}

/** 지금(KST)의 연·월 */
function kstYearMonth(now: Date): { year: number; month: number } {
  const [year, month] = (kstText(now) ?? '1970-01').slice(0, 7).split('-').map(Number);
  return { year: year!, month: month! };
}

const MONTH = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM')
  .nullable();
const PRODUCT = z.enum(PROCUREMENT_PRODUCTS).nullable();
const PRODUCT_TAB = z.enum(['ALL', ...PROCUREMENT_PRODUCTS]);

// ── 1. 실적 현황 요약 ──────────────────────────────────────────────

const performanceInput = z
  .object({
    product: PRODUCT.describe('WAPPLES·D.AMO·iSIGN 중 하나, 전체면 null'),
    from: MONTH.describe('시작 월 YYYY-MM, 모르면 null(올해 1월)'),
    to: MONTH.describe('끝 월 YYYY-MM, 모르면 null(이번 달)'),
  })
  .strict();

const ManufacturerSchema = z
  .object({
    manufacturer: text(PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
    isOurs: z.boolean(),
    amountText: z.string().nullable(),
    contractCount: z.number().int(),
    sharePct: z.number().nullable(),
  })
  .strict();

const performanceOutput = z
  .object({
    status: z.enum(['ok', 'invalid_period']),
    product: PRODUCT_TAB,
    period: z.object({ from: z.string(), to: z.string() }).strict(),
    amountWon: z.number(),
    amountText: z.string().nullable(),
    contractCount: z.number().int(),
    deliveryCount: z.number().int(),
    ourAmountText: z.string().nullable(),
    ourSharePct: z.number().nullable(),
    previousAmountText: z.string().nullable(),
    amountChangePct: z.number().nullable(),
    topManufacturers: z.array(ManufacturerSchema).max(PROCUREMENT_CHAT_TOP_MANUFACTURERS),
    collectedAt: z.string().nullable(),
  })
  .strict();

function defaultPeriod(from: string | null, to: string | null, now: Date): MonthPeriod {
  const { year, month } = kstYearMonth(now);
  const current = `${year}-${String(month).padStart(2, '0')}`;
  return { from: from ?? (to ? `${to.slice(0, 4)}-01` : `${year}-01`), to: to ?? current };
}

export const procurementPerformanceTool: ChatToolDef<
  typeof performanceInput,
  typeof performanceOutput
> = {
  name: 'procurement_performance_summary',
  description:
    '조달 실적 현황(납품요구 기준) 요약: 기간 합계 금액·계약 건수·자사 금액과 점유율·전년 같은 기간 대비, 상위 제조사.',
  statusLabel: '조달 실적 확인 중',
  input: performanceInput,
  output: performanceOutput,
  run: async ({ product, from, to }, { db, actor }) => {
    const access = chatProcurementAccess(actor);
    const tab: ProcurementProductTab = product ?? 'ALL';
    const period = defaultPeriod(from, to, new Date());
    const empty = {
      product: tab,
      period,
      amountWon: 0,
      amountText: null,
      contractCount: 0,
      deliveryCount: 0,
      ourAmountText: null,
      ourSharePct: null,
      previousAmountText: null,
      amountChangePct: null,
      topManufacturers: [],
      collectedAt: null,
    };
    if (period.from > period.to) return { data: { status: 'invalid_period', ...empty } };
    const scope = { product: tab };
    const [kpis, makers, collection] = await Promise.all([
      getPerformanceKpis(access, db, { scope, period }),
      getManufacturerPerformance(access, db, { scope, period }),
      getCollectionStatus(access, db),
    ]);
    const top = limitKeepingOurs(
      makers.rows.filter((row) => row.amount > 0),
      PROCUREMENT_CHAT_TOP_MANUFACTURERS,
    );
    return {
      data: {
        status: 'ok',
        product: tab,
        period,
        amountWon: kpis.amount,
        amountText: wonText(kpis.amount),
        contractCount: kpis.contractCount,
        deliveryCount: kpis.deliveryCount,
        ourAmountText: wonText(kpis.ourAmount),
        ourSharePct: percent(kpis.ourShare),
        previousAmountText: wonText(kpis.previous.amount),
        amountChangePct: percent(kpis.amountChangeRate),
        topManufacturers: top.map((row) => ({
          manufacturer: clipText(row.manufacturer, PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
          isOurs: row.isOurs,
          amountText: wonText(row.amount),
          contractCount: row.contractCount,
          sharePct: percent(row.share),
        })),
        collectedAt: kstText(collection.daily.collectedAt),
      },
    };
  },
};

// ── 2. 등록 품목 검색 ───────────────────────────────────────────────

const itemInput = z
  .object({
    query: z
      .string()
      .min(1)
      .max(50)
      .nullable()
      .describe('물품식별번호 또는 품목명 일부, 없으면 null'),
    product: PRODUCT.describe('WAPPLES·D.AMO·iSIGN 중 하나, 전체면 null'),
  })
  .strict();

const ItemRowSchema = z
  .object({
    itemId: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.code),
    itemName: text(PROCUREMENT_CHAT_TEXT_MAX.name),
    product: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.label),
    detailCategory: text(PROCUREMENT_CHAT_TEXT_MAX.label),
    manufacturer: text(PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
    isOurs: z.boolean(),
    registeredOn: z.string().nullable(),
    unitPriceText: z.string().nullable(),
    unitPriceDate: z.string().nullable(),
  })
  .strict();

const itemOutput = z
  .object({
    status: z.enum(['found', 'not_found']),
    total: z.number().int(),
    items: z.array(ItemRowSchema).max(PROCUREMENT_CHAT_ROW_MAX),
  })
  .strict();

export const procurementItemSearchTool: ChatToolDef<typeof itemInput, typeof itemOutput> = {
  name: 'procurement_item_search',
  description:
    '조달 등록 품목(나라장터 등록 물품)을 물품식별번호·품목명·제품으로 검색한다. 계약단가(최근 납품 기준)와 등록일자를 준다.',
  statusLabel: '등록 품목 검색 중',
  input: itemInput,
  output: itemOutput,
  run: async ({ query, product }, { db, actor }) => {
    const access = chatProcurementAccess(actor);
    const page = await getProcurementItemRows(access, db, {
      q: query ?? undefined,
      products: product ? [product] : undefined,
      pageSize: PROCUREMENT_CHAT_ROW_MAX,
    });
    const items = page.rows.slice(0, PROCUREMENT_CHAT_ROW_MAX).map((row) => ({
      itemId: clipText(row.itemId, PROCUREMENT_CHAT_TEXT_MAX.code) ?? '',
      itemName: clipText(row.itemName, PROCUREMENT_CHAT_TEXT_MAX.name),
      product: clipText(row.product, PROCUREMENT_CHAT_TEXT_MAX.label) ?? '',
      detailCategory: clipText(row.detailCategory, PROCUREMENT_CHAT_TEXT_MAX.label),
      manufacturer: clipText(row.manufacturer, PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
      isOurs: isOurManufacturer(row.manufacturer),
      registeredOn: row.registeredOn,
      unitPriceText: wonText(row.unitPrice),
      unitPriceDate: row.priceDate,
    }));
    return {
      data: { status: items.length > 0 ? 'found' : 'not_found', total: page.total, items },
    };
  },
};

// ── 3. 입찰 공고 검색 ───────────────────────────────────────────────

const bidInput = z
  .object({
    query: z
      .string()
      .min(1)
      .max(50)
      .nullable()
      .describe('공고명·기관명·공고번호에 들어간 말, 없으면 null'),
    product: PRODUCT.describe('관련 제품 WAPPLES·D.AMO·iSIGN, 전체면 null'),
    includeClosed: z.boolean().describe('마감된 공고도 포함하면 true (기본 false = 진행 중만)'),
    topGradeOnly: z.boolean().describe('적합도 상 등급만이면 true'),
    deadlineWithinDays: z
      .number()
      .int()
      .min(0)
      .max(60)
      .nullable()
      .describe('오늘부터 N일 안에 마감되는 공고만 (예: 이번 주 7), 없으면 null'),
    sort: z
      .enum(['fit', 'deadline', 'posted'])
      .nullable()
      .describe('fit=적합도순(기본), deadline=마감 임박순, posted=최근 공고순'),
  })
  .strict();

const BidRowSchema = z
  .object({
    bidNo: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.code),
    title: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.title),
    products: z.array(z.string().max(PROCUREMENT_CHAT_TEXT_MAX.label)).max(3),
    businessType: text(PROCUREMENT_CHAT_TEXT_MAX.label),
    demandOrg: text(PROCUREMENT_CHAT_TEXT_MAX.org),
    postedAt: z.string().nullable(),
    deadlineAt: z.string().nullable(),
    daysLeft: z.number().int().nullable(),
    closed: z.boolean(),
    budgetText: z.string().nullable(),
    estimatedPriceText: z.string().nullable(),
    fitGrade: text(4),
    fitScore: z.number().nullable(),
    fitReasons: z.array(z.string().max(PROCUREMENT_CHAT_TEXT_MAX.reason)).max(REASON_MAX),
  })
  .strict();

const bidOutput = z
  .object({
    status: z.enum(['found', 'not_found']),
    total: z.number().int(),
    /** 조회 범위(최대 200건)를 넘어 일부 공고만 검색했는지 */
    partial: z.boolean(),
    bids: z.array(BidRowSchema).max(PROCUREMENT_CHAT_ROW_MAX),
  })
  .strict();

function includesText(row: BidNoticeRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  return [row.title, row.demandOrg, row.orderOrg, row.bidNo].some((value) =>
    (value ?? '').toLocaleLowerCase('ko-KR').includes(needle),
  );
}

function byDeadline(a: BidNoticeRow, b: BidNoticeRow): number {
  return (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER);
}

function bidView(row: BidNoticeRow): z.infer<typeof BidRowSchema> {
  return {
    bidNo: clipText(`${row.bidNo}-${row.bidOrd}`, PROCUREMENT_CHAT_TEXT_MAX.code) ?? '',
    title: clipText(row.title, PROCUREMENT_CHAT_TEXT_MAX.title) ?? '',
    products: row.products
      .slice(0, 3)
      .map((product) => clipText(product, PROCUREMENT_CHAT_TEXT_MAX.label) ?? ''),
    businessType: clipText(row.businessType, PROCUREMENT_CHAT_TEXT_MAX.label),
    demandOrg: clipText(row.demandOrg ?? row.orderOrg, PROCUREMENT_CHAT_TEXT_MAX.org),
    postedAt: kstText(row.postedAt),
    deadlineAt: kstText(row.deadlineAt),
    daysLeft: row.daysLeft,
    closed: row.closed,
    budgetText: wonText(row.budget),
    estimatedPriceText: wonText(row.estPrice),
    fitGrade: clipText(row.fitGrade, 4),
    fitScore: row.fitScore,
    fitReasons: row.fitReasons
      .map((reason) => clipText(reason, PROCUREMENT_CHAT_TEXT_MAX.reason))
      .filter((reason): reason is string => reason !== null)
      .slice(0, REASON_MAX),
  };
}

export const procurementBidSearchTool: ChatToolDef<typeof bidInput, typeof bidOutput> = {
  name: 'procurement_bid_search',
  description:
    '입찰 공고(관련 제품이 있는 공고)를 검색한다. 진행 중/마감 포함, 적합도 상만, N일 안 마감, 공고명·기관명 검색. 공고명은 외부 수집 텍스트다.',
  statusLabel: '입찰 공고 검색 중',
  input: bidInput,
  output: bidOutput,
  run: async (args, { db, actor }) => {
    const access = chatProcurementAccess(actor);
    const page = await getBidNoticeRows(access, db, {
      product: args.product,
      includeClosed: args.includeClosed,
      topGradeOnly: args.topGradeOnly,
      sort: args.sort === 'posted' ? 'posted' : 'fit',
      pageSize: PROCUREMENT_MAX_PAGE_SIZE,
    });
    const within = args.deadlineWithinDays;
    const matched = page.rows.filter(
      (row) =>
        (!args.query || includesText(row, args.query)) &&
        (within === null || (row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= within)),
    );
    const ordered = args.sort === 'deadline' ? [...matched].sort(byDeadline) : matched;
    const bids = ordered.slice(0, PROCUREMENT_CHAT_ROW_MAX).map(bidView);
    return {
      data: {
        status: bids.length > 0 ? 'found' : 'not_found',
        total: matched.length,
        partial: page.total > page.rows.length,
        bids,
      },
    };
  },
};

// ── 4. 납품요구(계약) 검색 ──────────────────────────────────────────

const deliveryInput = z
  .object({
    month: MONTH.describe('납품요구 월 YYYY-MM, 모르면 null(데이터가 있는 마지막 달)'),
    product: PRODUCT.describe('WAPPLES·D.AMO·iSIGN 중 하나, 전체면 null'),
    query: z
      .string()
      .min(1)
      .max(50)
      .nullable()
      .describe('납품요구번호·물품식별번호·품목명·수요기관 일부, 없으면 null'),
  })
  .strict();

const DeliveryRowSchema = z
  .object({
    dlvrReqNo: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.code),
    dlvrReqDate: z.string().nullable(),
    product: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.label),
    itemId: z.string().max(PROCUREMENT_CHAT_TEXT_MAX.code),
    itemName: text(PROCUREMENT_CHAT_TEXT_MAX.name),
    manufacturer: text(PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
    isOurs: z.boolean(),
    demandOrg: text(PROCUREMENT_CHAT_TEXT_MAX.org),
    vendor: text(PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
    quantity: text(20),
    unitPriceText: z.string().nullable(),
    amountText: z.string().nullable(),
  })
  .strict();

const deliveryOutput = z
  .object({
    status: z.enum(['found', 'not_found', 'no_data']),
    month: z.string().nullable(),
    total: z.number().int(),
    totalAmountText: z.string().nullable(),
    deliveries: z.array(DeliveryRowSchema).max(PROCUREMENT_CHAT_ROW_MAX),
  })
  .strict();

export const procurementDeliverySearchTool: ChatToolDef<
  typeof deliveryInput,
  typeof deliveryOutput
> = {
  name: 'procurement_delivery_search',
  description:
    '한 달의 납품요구(계약) 목록을 검색한다(실적 현황 월별 계약 목록과 같은 범위). 날짜 최신·금액 큰 순, 그 달 합계 금액 포함.',
  statusLabel: '납품요구 검색 중',
  input: deliveryInput,
  output: deliveryOutput,
  run: async ({ month, product, query }, { db, actor }) => {
    const access = chatProcurementAccess(actor);
    const scope = { product: product ?? 'ALL' } as const;
    const target = month ?? (await getMonthVolumes(access, db, { scope })).last;
    if (!target) {
      return {
        data: { status: 'no_data', month: null, total: 0, totalAmountText: null, deliveries: [] },
      };
    }
    const page = await getMonthContracts(access, db, {
      scope,
      month: target,
      q: query ?? undefined,
      pageSize: PROCUREMENT_CHAT_ROW_MAX,
    });
    const deliveries = page.rows.slice(0, PROCUREMENT_CHAT_ROW_MAX).map((row) => ({
      dlvrReqNo: clipText(row.dlvrReqNo, PROCUREMENT_CHAT_TEXT_MAX.code) ?? '',
      dlvrReqDate: row.dlvrReqDate,
      product: clipText(row.product, PROCUREMENT_CHAT_TEXT_MAX.label) ?? '',
      itemId: clipText(row.itemId, PROCUREMENT_CHAT_TEXT_MAX.code) ?? '',
      itemName: clipText(row.itemName, PROCUREMENT_CHAT_TEXT_MAX.name),
      manufacturer: clipText(row.manufacturer, PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
      isOurs: isOurManufacturer(row.manufacturer),
      demandOrg: clipText(row.demandOrg, PROCUREMENT_CHAT_TEXT_MAX.org),
      vendor: clipText(row.vendor, PROCUREMENT_CHAT_TEXT_MAX.manufacturer),
      quantity: clipText(row.quantity, 20),
      unitPriceText: wonText(row.unitPrice),
      amountText: wonText(row.amount),
    }));
    return {
      data: {
        status: deliveries.length > 0 ? 'found' : 'not_found',
        month: target,
        total: page.total,
        totalAmountText: wonText(page.amount),
        deliveries,
      },
    };
  },
};

/** 조달 챗봇 기능 — 레지스트리(조달 domain)에 한 줄로 들어간다. 순서 = 시스템 프롬프트 기능 목록 순서 */
export const PROCUREMENT_CHAT_FEATURE: ChatFeature = {
  id: 'procurement',
  title: '조달 조회',
  permission: 'procurement.read',
  sideEffect: 'none',
  promptHint:
    'procurement_performance_summary: 기간·제품별 조달 실적 합계·자사 점유율·상위 제조사 / procurement_item_search: 등록 품목 검색 / procurement_bid_search: 입찰 공고 검색(마감·적합도) / procurement_delivery_search: 월별 납품요구(계약) 목록',
  tools: [
    procurementPerformanceTool,
    procurementItemSearchTool,
    procurementBidSearchTool,
    procurementDeliverySearchTool,
  ],
};
