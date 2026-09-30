// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { salesPrices } from '@/db/schema';
import { priceCompareTool } from '@/server/chat/features/compare';
import { priceLookupTool } from '@/server/chat/features/pricing';
import { quoteStartTool } from '@/server/chat/features/quote';
import { toLangChainTool } from '@/server/chat/features/tool-factory';
import type { ChatToolDef, ToolDeps } from '@/server/chat/features/types';

import { setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * 도구 단위 (PRAMI-002 §4.3.5·§4.3.6 ①): 입력 경계, 판정 분기, 출력이 strict 스키마를 통과, 아티팩트 형태.
 */
let ctx: ChatTestDb;
let deps: ToolDeps;

beforeAll(async () => {
  ctx = await setupChatDb();
  deps = { db: ctx.handle.db, actor: { userId: ctx.userId, role: 'USER' } };
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

async function run<T extends ChatToolDef>(tool: T, args: unknown) {
  const parsed = tool.input.parse(args);
  const result = await tool.run(parsed, deps);
  // 모든 결과는 strict 출력 스키마를 통과한다
  expect(tool.output.safeParse(result.data).success).toBe(true);
  return result as { data: Record<string, unknown>; artifact?: Record<string, unknown> };
}

describe('price_lookup', () => {
  it('입력 경계: 빈 문자열·101자·추가 키·잘못된 제품군 거부, family 는 null 허용', () => {
    expect(priceLookupTool.input.safeParse({ query: '', family: null }).success).toBe(false);
    expect(priceLookupTool.input.safeParse({ query: 'x'.repeat(101), family: null }).success).toBe(
      false,
    );
    expect(priceLookupTool.input.safeParse({ query: 'a', family: null, x: 1 }).success).toBe(false);
    expect(priceLookupTool.input.safeParse({ query: 'a', family: 'ACME' }).success).toBe(false);
    expect(priceLookupTool.input.safeParse({ query: 'a', family: 'WAPPLES' }).success).toBe(true);
  });

  it('not_found → 빈 목록, 아티팩트 없음', async () => {
    const result = await run(priceLookupTool, { query: 'ZZZ-9999', family: null });
    expect(result.data).toEqual({ status: 'not_found', items: [] });
    expect(result.artifact).toBeUndefined();
  });
});

describe('price_compare_previous', () => {
  it('단일 품목 → no_previous(현재가만) 또는 compared, 여러 후보 → candidates, 0건 → not_found', async () => {
    const single = await run(priceCompareTool, { query: 'Wapples-500 T2' });
    expect(['no_previous', 'compared']).toContain(single.data.status);
    expect(single.data.current).not.toBeNull();
    const many = await run(priceCompareTool, { query: 'Wapples-500' });
    expect(many.data.status).toBe('candidates');
    expect((many.data.candidates as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(many.artifact?.candidates).toBeDefined();
    const none = await run(priceCompareTool, { query: 'ZZZ-9999' });
    expect(none.data).toMatchObject({ status: 'not_found', item: null, current: null });
  });
});

describe('quote_start', () => {
  it('제품 없음 → ask_product, 제품군만 → family 링크, 품목 1건 → item 링크, 여러 건 → candidates, 0건 → not_found', async () => {
    expect((await run(quoteStartTool, { query: null, family: null })).data.status).toBe(
      'ask_product',
    );
    const family = await run(quoteStartTool, { query: null, family: 'D.AMO' });
    expect(family.data).toMatchObject({ status: 'family', href: '/calculator?family=D.AMO' });
    expect(family.artifact?.action).toMatchObject({
      type: 'calculator',
      label: 'D.AMO 견적 계산기 열기',
    });
    const item = await run(quoteStartTool, { query: 'P10100024', family: null });
    expect(item.data).toMatchObject({
      status: 'item',
      href: '/calculator?family=WAPPLES&item=P10100024',
    });
    const many = await run(quoteStartTool, { query: 'Wapples-500', family: null });
    expect(many.data.status).toBe('candidates');
    expect((await run(quoteStartTool, { query: 'ZZZ-9999', family: null })).data.status).toBe(
      'not_found',
    );
  });

  it('출력 href 는 /calculator 내부 경로만 (외부 URL·// 거부)', () => {
    const base = { status: 'item', item: null, candidates: [] };
    expect(quoteStartTool.output.safeParse({ ...base, href: 'https://evil.example' }).success).toBe(
      false,
    );
    expect(quoteStartTool.output.safeParse({ ...base, href: '//evil.example' }).success).toBe(
      false,
    );
    expect(
      quoteStartTool.output.safeParse({ ...base, href: '/calculator?family=WAPPLES' }).success,
    ).toBe(true);
  });
});

describe('price_compare_previous — compared', () => {
  it('이전 적용 행이 있으면 compared + 변동률(%) (같은 품번·단가유형, 앞선 적용시작일)', async () => {
    await ctx.handle.db.insert(salesPrices).values({
      sourceId: 99101,
      productFamily: 'WAPPLES',
      itemCode: 'P10100024',
      itemName: 'Wapples-500 (H500 T3)',
      unit: 'EA',
      priceType: '정상판매',
      priceCategory: '일반',
      currency: 'KRW',
      hasCorePrice: false,
      unitPrice: '12500000.00',
      effectiveFrom: '2015-01-01',
      appliesToAllCustomers: false,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      source: 'erp',
    });
    const result = await run(priceCompareTool, { query: 'P10100024' });
    expect(result.data).toMatchObject({
      status: 'compared',
      previous: { unitPrice: '12500000.00', currency: 'KRW' },
      current: { unitPrice: '14000000.00' },
      changePct: 12,
    });
  });
});

describe('tool-factory', () => {
  it('bindTools 용 LangChain 도구는 이름·설명·스키마만 — 직접 실행하면 거부(실행은 tools 노드만)', async () => {
    const tool = toLangChainTool(priceLookupTool);
    expect(tool.name).toBe('price_lookup');
    await expect(tool.invoke({ query: 'Wapples-500', family: null })).rejects.toThrow(/tools 노드/);
  });
});
