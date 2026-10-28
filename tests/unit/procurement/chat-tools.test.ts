// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import type { ChatToolDef, ToolDeps } from '@/server/chat/features/types';
import { assertNoCostKeys } from '@/server/chat/graph/guard';
import { procurementAccessForTests } from '@/server/procurement/access-token';
import {
  chatProcurementAccess,
  clipText,
  PROCUREMENT_CHAT_FEATURE,
  PROCUREMENT_CHAT_ROW_MAX,
  PROCUREMENT_CHAT_TEXT_MAX,
  procurementBidSearchTool,
  procurementDeliverySearchTool,
  procurementItemSearchTool,
  procurementPerformanceTool,
  wonText,
} from '@/server/procurement/chat/tools';
import { getMonthContracts } from '@/server/procurement/performance';

import { captureSql } from '../../helpers/chat';
import { createTestDb } from '../../helpers/pglite';
import {
  COST_WORD_TITLE,
  INJECTION_TITLE,
  LONG_ITEM_NAME,
  seedProcurementChat,
} from '../../helpers/procurement-chat';

/**
 * 조달 챗봇 도구 (UX PR-C3) — PGlite + 합성 픽스처. 읽기 전용(SELECT 만)·필드 화이트리스트(정확한 키)·행 상한·길이 상한·
 * 실행 시 권한 재확인(procurement.read 없으면 SQL 0)·응답 키에 'cost' 없음·외부 텍스트 정리.
 */
const perm = vi.hoisted(() => ({ denyProcurement: false }));
vi.mock('@/lib/constants/permissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/constants/permissions')>();
  return {
    ...original,
    hasPermission: (role: Parameters<typeof original.hasPermission>[0], key: string) =>
      perm.denyProcurement && key === 'procurement.read'
        ? false
        : original.hasPermission(role, key as Parameters<typeof original.hasPermission>[1]),
  };
});

let handle: DbHandle;
let deps: ToolDeps;

beforeAll(async () => {
  handle = await createTestDb();
  await seedProcurementChat(handle);
  deps = { db: handle.db, actor: { userId: '00000000-0000-4000-8000-00000000000a', role: 'USER' } };
}, 120_000);

afterAll(async () => {
  await handle.close();
});

afterEach(() => {
  perm.denyProcurement = false;
});

/** 레지스트리 실행과 같은 순서: 입력 strict 파싱 → run → 출력 strict 파싱 → 금지 키 검사 */
async function call(def: ChatToolDef, args: Record<string, unknown>) {
  const input = def.input.parse(args);
  const result = await def.run(input, deps);
  const data = def.output.parse(result.data) as Record<string, unknown>;
  assertNoCostKeys(data);
  return data;
}

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value).sort() : [];
}

const ALL_TOOLS = PROCUREMENT_CHAT_FEATURE.tools;

describe('기능 정의', () => {
  it('procurement.read 권한·읽기 전용·도구 4종(이름에 cost 없음), 입력은 strict', () => {
    expect(PROCUREMENT_CHAT_FEATURE).toMatchObject({
      permission: 'procurement.read',
      sideEffect: 'none',
    });
    expect(ALL_TOOLS.map((tool) => tool.name)).toEqual([
      'procurement_performance_summary',
      'procurement_item_search',
      'procurement_bid_search',
      'procurement_delivery_search',
    ]);
    for (const tool of ALL_TOOLS) {
      expect(`${tool.name} ${tool.description}`).not.toMatch(/cost|원가/i);
      // 모르는 인자(예: 쓰기 플래그·SQL)는 거부
      expect(tool.input.safeParse({ sql: 'delete' }).success).toBe(false);
    }
  });
});

describe('등록 품목 검색', () => {
  it('화이트리스트 키만, 최대 10행, 총 건수는 따로', async () => {
    const data = await call(procurementItemSearchTool, { query: null, product: 'WAPPLES' });
    expect(data.status).toBe('found');
    expect(data.total).toBe(12);
    const items = data.items as Record<string, unknown>[];
    expect(items).toHaveLength(PROCUREMENT_CHAT_ROW_MAX);
    for (const row of items) {
      expect(keysOf(row)).toEqual(
        [
          'detailCategory',
          'isOurs',
          'itemId',
          'itemName',
          'manufacturer',
          'product',
          'registeredOn',
          'unitPriceDate',
          'unitPriceText',
        ].sort(),
      );
    }
    // DB 내부 열(id·source·productGroup·status)은 나가지 않는다
    expect(JSON.stringify(items)).not.toMatch(/"(id|source|productGroup|status)"/);
  });

  it('품목명은 길이 상한으로 잘린다, 계약단가는 원 표기', async () => {
    const data = await call(procurementItemSearchTool, { query: 'CHAT-D', product: null });
    const [row] = data.items as { itemName: string; unitPriceText: string | null }[];
    expect(LONG_ITEM_NAME.length).toBeGreaterThan(PROCUREMENT_CHAT_TEXT_MAX.name);
    expect(row!.itemName.length).toBeLessThanOrEqual(PROCUREMENT_CHAT_TEXT_MAX.name);
    expect(row!.itemName.endsWith('…')).toBe(true);
    const priced = await call(procurementItemSearchTool, { query: 'CHAT-W-003', product: null });
    expect((priced.items as { unitPriceText: string }[])[0]!.unitPriceText).toBe('3,000만원');
  });

  it('없으면 not_found', async () => {
    const data = await call(procurementItemSearchTool, { query: '없는-품목-ZZZ', product: null });
    expect(data).toEqual({ status: 'not_found', total: 0, items: [] });
  });
});

describe('입찰 공고 검색', () => {
  it('진행 중만(기본), 적합도순, 근거 최대 3개, 링크·원문 필드 없음', async () => {
    const data = await call(procurementBidSearchTool, {
      query: null,
      product: null,
      includeClosed: false,
      topGradeOnly: false,
      deadlineWithinDays: null,
      sort: null,
    });
    const bids = data.bids as Record<string, unknown>[];
    expect(bids.map((bid) => bid.bidNo)).toEqual(['CHAT-B-1-000', 'CHAT-B-2-000', 'CHAT-B-3-000']);
    expect(keysOf(bids[0])).toEqual(
      [
        'bidNo',
        'budgetText',
        'closed',
        'daysLeft',
        'deadlineAt',
        'demandOrg',
        'estimatedPriceText',
        'fitGrade',
        'fitReasons',
        'fitScore',
        'postedAt',
        'products',
        'businessType',
        'title',
      ].sort(),
    );
    expect(bids[0]!.fitReasons).toHaveLength(3);
    expect(bids[0]!.budgetText).toBe('12억 3,400만원');
    expect(JSON.stringify(data)).not.toMatch(/detailUrl|keywords|https?:/);
  });

  it('공고명 속 지시문은 그대로 데이터 문자열로만 나간다(필드가 늘거나 동작이 바뀌지 않음)', async () => {
    const data = await call(procurementBidSearchTool, {
      query: '시스템 지시',
      product: null,
      includeClosed: true,
      topGradeOnly: false,
      deadlineWithinDays: null,
      sort: null,
    });
    const bids = data.bids as { title: string }[];
    expect(bids).toHaveLength(1);
    expect(bids[0]!.title).toBe(INJECTION_TITLE);
    expect(keysOf(data)).toEqual(['bids', 'partial', 'status', 'total']);
  });

  it('N일 안 마감·마감 임박순·마감 포함·제품', async () => {
    const soon = await call(procurementBidSearchTool, {
      query: null,
      product: null,
      includeClosed: false,
      topGradeOnly: false,
      deadlineWithinDays: 7,
      sort: 'deadline',
    });
    expect((soon.bids as { bidNo: string }[]).map((bid) => bid.bidNo)).toEqual([
      'CHAT-B-1-000',
      'CHAT-B-3-000',
    ]);
    const closed = await call(procurementBidSearchTool, {
      query: '지난',
      product: 'WAPPLES',
      includeClosed: true,
      topGradeOnly: true,
      deadlineWithinDays: null,
      sort: null,
    });
    expect(closed.bids).toMatchObject([{ bidNo: 'CHAT-B-4-000', closed: true }]);
  });
});

describe('실적 요약 · 납품요구 검색', () => {
  it('실적 요약: 합계·건수·자사 점유율·상위 제조사(최대 5)·수집 시각, 키 화이트리스트', async () => {
    const data = await call(procurementPerformanceTool, {
      product: 'WAPPLES',
      from: '2025-01',
      to: '2025-06',
    });
    expect(data).toMatchObject({
      status: 'ok',
      product: 'WAPPLES',
      period: { from: '2025-01', to: '2025-06' },
      amountWon: 780 * 1_000_000,
      amountText: '7억 8,000만원',
      contractCount: 12,
      ourAmountText: '1,000만원',
      ourSharePct: 1.3,
    });
    expect((data.topManufacturers as unknown[]).length).toBeLessThanOrEqual(5);
    expect(data.collectedAt).toMatch(/^2025-04-01 09:10$/);
    expect(keysOf(data)).toEqual(
      [
        'amountChangePct',
        'amountText',
        'amountWon',
        'collectedAt',
        'contractCount',
        'deliveryCount',
        'ourAmountText',
        'ourSharePct',
        'period',
        'previousAmountText',
        'product',
        'status',
        'topManufacturers',
      ].sort(),
    );
    const reversed = await call(procurementPerformanceTool, {
      product: null,
      from: '2025-06',
      to: '2025-01',
    });
    expect(reversed.status).toBe('invalid_period');
  });

  it('납품요구: 월 생략 = 데이터가 있는 마지막 달, 최대 10행, 합계는 그 달 전체, 검색어', async () => {
    const data = await call(procurementDeliverySearchTool, {
      month: null,
      product: null,
      query: null,
    });
    expect(data).toMatchObject({
      status: 'found',
      month: '2025-03',
      total: 12,
      totalAmountText: '7억 8,000만원',
    });
    const rows = data.deliveries as Record<string, unknown>[];
    expect(rows).toHaveLength(PROCUREMENT_CHAT_ROW_MAX);
    expect(keysOf(rows[0])).toEqual(
      [
        'amountText',
        'demandOrg',
        'dlvrReqDate',
        'dlvrReqNo',
        'isOurs',
        'itemId',
        'itemName',
        'manufacturer',
        'product',
        'quantity',
        'unitPriceText',
        'vendor',
      ].sort(),
    );
    const found = await call(procurementDeliverySearchTool, {
      month: '2025-03',
      product: 'WAPPLES',
      query: '가상기관 12',
    });
    expect(found).toMatchObject({ total: 1, deliveries: [{ dlvrReqNo: 'CHAT-R-012' }] });
    const empty = await call(procurementDeliverySearchTool, {
      month: '2024-01',
      product: null,
      query: null,
    });
    expect(empty).toMatchObject({ status: 'not_found', total: 0, deliveries: [] });
  });

  it('getMonthContracts q(추가 인자): 납품요구번호·물품식별번호(대소문자 무시)·수요기관 부분 일치, LIKE 특수문자 이스케이프', async () => {
    const access = procurementAccessForTests();
    const scope = { product: 'ALL' } as const;
    const by = (q: string) => getMonthContracts(access, handle.db, { scope, month: '2025-03', q });
    expect((await by('CHAT-R-00')).total).toBe(9);
    expect((await by('chat-w-011')).rows.map((row) => row.dlvrReqNo)).toEqual(['CHAT-R-011']);
    expect((await by('%')).total).toBe(0);
  });
});

describe('읽기 전용 · 권한', () => {
  it('네 도구 실행은 SELECT 만 (쓰기 SQL 0)', async () => {
    const capture = captureSql(handle);
    try {
      await call(procurementPerformanceTool, { product: null, from: null, to: null });
      await call(procurementItemSearchTool, { query: '가상', product: null });
      await call(procurementBidSearchTool, {
        query: null,
        product: null,
        includeClosed: true,
        topGradeOnly: false,
        deadlineWithinDays: null,
        sort: 'posted',
      });
      await call(procurementDeliverySearchTool, { month: null, product: null, query: null });
    } finally {
      capture.restore();
    }
    expect(capture.statements.length).toBeGreaterThan(0);
    for (const statement of capture.statements) {
      expect(statement.trimStart().toLowerCase()).toMatch(/^(select|with)\b/);
    }
  });

  it('procurement.read 가 없으면 토큰을 만들지 않고 SQL 도 나가지 않는다', async () => {
    perm.denyProcurement = true;
    expect(() => chatProcurementAccess(deps.actor)).toThrow(/procurement\.read/);
    const capture = captureSql(handle);
    try {
      for (const tool of ALL_TOOLS) {
        const args = Object.fromEntries(
          Object.keys((tool.input as unknown as { shape: Record<string, unknown> }).shape).map(
            (key) => [key, key === 'includeClosed' || key === 'topGradeOnly' ? false : null],
          ),
        );
        await expect(tool.run(tool.input.parse(args), deps)).rejects.toThrow(/procurement\.read/);
      }
    } finally {
      capture.restore();
    }
    expect(capture.statements).toEqual([]);
  });

  it('토큰은 read 범위, actor = 사용자 id', () => {
    expect(chatProcurementAccess(deps.actor)).toMatchObject({
      userId: deps.actor.userId,
      scope: 'read',
    });
  });
});

describe('텍스트 정리 · 금액 표기', () => {
  it('제어·제로폭·양방향 서식 문자 제거, 공백 정리, 상한(코드 포인트를 가르지 않음)', () => {
    expect(clipText(' 가상\u0000 공고\u200b\u202e명\n\n끝 ', 50)).toBe('가상 공고 명 끝');
    expect(clipText('\u200b \n', 10)).toBeNull();
    expect(clipText(null, 10)).toBeNull();
    const clipped = clipText('😀'.repeat(20), 9)!;
    expect(clipped.length).toBeLessThanOrEqual(9);
    expect(clipped).toBe('😀😀😀😀…');
  });

  it('wonText: 억·만 + 원, 값 없음 null', () => {
    expect(wonText(1_234_000_000)).toBe('12억 3,400만원');
    expect(wonText(5_000)).toBe('5,000원');
    expect(wonText(0)).toBe('0원');
    expect(wonText(null)).toBeNull();
  });

  it('원가 단어가 든 공고명도 출력 키는 그대로 — 금지 키 검사는 키 이름만 본다', async () => {
    const data = await call(procurementBidSearchTool, {
      query: '원가 분석',
      product: null,
      includeClosed: false,
      topGradeOnly: false,
      deadlineWithinDays: null,
      sort: null,
    });
    expect((data.bids as { title: string }[])[0]!.title).toBe(COST_WORD_TITLE);
    expect(() => assertNoCostKeys({ unitCost: 1 })).toThrow();
  });
});
