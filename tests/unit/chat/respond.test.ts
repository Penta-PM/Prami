// @vitest-environment node
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Db, DbHandle } from '@/db';
import { salesPrices } from '@/db/schema';
import { queryRows } from '@/server/imports/sql-rows';
import { applyPolicy } from '@/server/imports/apply-policy';
import { findChatItems, latestChatPrice, previousChatPrice } from '@/server/chat/queries';
import {
  COST_REPLY,
  COST_REPLY_USER,
  HELP_REPLY,
  PRICE_NEED_MODEL,
  QUOTE_ASK_PRODUCT,
  respondToChat,
} from '@/server/chat/respond';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/**
 * 챗봇 응답 (AC-80~82, AC-43): 값은 DB(sales-200 픽스처)에서. 원가 의도는 DB 접근이 0회임을 "접근하면 던지는 db" 로 증명한다.
 */
let handle: DbHandle;
const USER = { role: 'USER' as const };
const ADMIN = { role: 'ADMIN' as const };
const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs/;

/** 어떤 속성에라도 손대면 던지는 db — 원가 질문이 쿼리를 한 번도 만들지 않음을 증명 */
const forbiddenDb = new Proxy({} as Db, {
  get(_target, property) {
    throw new Error(`원가 질문에서 DB 접근: ${String(property)}`);
  },
});

beforeAll(async () => {
  handle = await createTestDb();
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await handle.close();
});

describe('respondToChat', () => {
  it('AC-80: "Wapples-500 가격" → DB 최신 정상판매 가격 문장 + 견적 시작 링크, 원가 키 없음', async () => {
    const result = await respondToChat(
      handle.db,
      USER,
      'WAPPLES Wapples-500 (H500 T2) 가격 알려줘',
    );
    const [row] = await queryRows<{ unit_price: string; effective_from: string }>(
      handle.db,
      sql`select unit_price, effective_from::text from sales_prices where item_code = 'P10100015' and price_type = '정상판매' and operation_status = '운영중' and deleted_at is null order by effective_from desc, id desc limit 1`,
    );
    expect(result.intent).toBe('price');
    expect(result.reply).toBe(
      `${row!.effective_from.slice(0, 4)}년 기준 WAPPLES Wapples-500 (H500 T2)의 가격은 12,000,000원입니다.`,
    );
    expect(result.action).toEqual({
      type: 'calculator',
      href: '/calculator?family=WAPPLES&item=P10100015',
      label: '이 품목으로 견적 시작',
    });
    expect(JSON.stringify(result)).not.toMatch(COST_KEYS);
  });

  it('AC-80 r6 매칭: 후보 2개 병기 → 유일·품번 즉시 가격 → 4개 이상 목록 → 0개 도움말', async () => {
    // ② 후보 2~3개: 한 문장에 각 후보 품명과 최신 정상판매 가격을 병기
    const two = await respondToChat(handle.db, USER, 'Wapples-500 가격');
    expect(two.intent).toBe('price');
    expect(two.reply).toBe(
      'Wapples-500 (H500 T2) 12,000,000원, Wapples-500 (H500 T3) 14,000,000원입니다. 어느 모델인가요?',
    );
    expect(two.candidates.map((hit) => hit.itemCode)).toEqual(['P10100015', 'P10100024']);
    // ① 유일 후보 / 품번 정확 일치 → 즉시 가격
    const unique = await respondToChat(handle.db, USER, 'Wapples-500 T2 가격');
    expect(unique.candidates).toEqual([]);
    expect(unique.reply).toMatch(/Wapples-500 \(H500 T2\)의 가격은 12,000,000원입니다\.$/);
    const byCode = await respondToChat(handle.db, USER, 'P10100024');
    expect(byCode.reply).toMatch(/Wapples-500 \(H500 T3\)의 가격은 14,000,000원입니다\.$/);
    // ③ 4개 이상: 가격 없이 목록(최대 5) + 좁혀 달라는 안내
    const many = await respondToChat(handle.db, USER, 'Wapples 가격');
    expect(many.reply).toMatch(/^\d+개 품목이 검색되었습니다: /);
    expect(many.reply).toContain('더 구체적으로');
    expect(many.reply).not.toMatch(/\d원/);
    expect(many.candidates.length).toBeGreaterThanOrEqual(4);
    expect(many.candidates.length).toBeLessThanOrEqual(5);
    // ④ 0개 → 도움말
    const missing = await respondToChat(handle.db, USER, 'ZZZ-9999 가격');
    expect(missing.reply).toContain('찾지 못했습니다');
    expect(missing.reply).toContain(HELP_REPLY);
    expect(missing.showProductChips).toBe(true);
    const noModel = await respondToChat(handle.db, USER, '가격 알려줘');
    expect(noModel.reply).toBe(PRICE_NEED_MODEL);
    expect(noModel.showProductChips).toBe(true);
  });

  it('AC-80: 연도 비교 — 이전 적용시작일 행이 있으면 전년 대비 문장, 없으면 안내', async () => {
    // 픽스처에서 같은 품번·정상판매로 적용시작일이 둘 이상인 품번을 고른다
    const [pair] = await queryRows<{ item_code: string; item_name: string }>(
      handle.db,
      sql`select item_code, max(item_name) as item_name from sales_prices where price_type = '정상판매' and deleted_at is null group by item_code having count(distinct effective_from) > 1 order by item_code limit 1`,
    );
    expect(pair).toBeDefined();
    const current = await latestChatPrice(handle.db, pair!.item_code);
    const previous = await previousChatPrice(handle.db, current!);
    expect(previous).not.toBeNull();
    const result = await respondToChat(handle.db, USER, `${pair!.item_code} 작년보다 올랐어?`);
    expect(result.intent).toBe('compare');
    expect(result.reply).toContain(`${previous!.effectiveFrom.slice(0, 4)}년`);
    expect(result.reply).toContain(`${current!.effectiveFrom.slice(0, 4)}년에는`);
    expect(result.reply).toMatch(/상승|하락|같은 금액/);

    // 이전 행이 없는 품번 → 안내 (Wapples-500 은 정상판매 행이 하나)
    const [count] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(distinct effective_from)::int as n from sales_prices where item_code = 'P10100015' and price_type = '정상판매'`,
    );
    expect(count!.n).toBe(1);
    const none = await respondToChat(handle.db, USER, 'Wapples-500 (H500 T2) 작년보다 올랐어?');
    expect(none.reply).toContain('이전 적용 가격 데이터가 없어');
    expect(none.reply).toContain('12,000,000원');
    const noModel = await respondToChat(handle.db, USER, '작년보다 올랐어?');
    expect(noModel.showProductChips).toBe(true);
  });

  it('견적 시작: 품목 → 계산기 링크(제품군·품번), 제품군만 → 제품군 링크, 없으면 제품 칩', async () => {
    const item = await respondToChat(handle.db, USER, 'Wapples-500 (H500 T2) 견적 뽑아줘');
    expect(item.intent).toBe('quote');
    expect(item.action?.href).toBe('/calculator?family=WAPPLES&item=P10100015');
    const family = await respondToChat(handle.db, USER, 'WAPPLES 견적');
    expect(family.action?.href).toBe('/calculator?family=WAPPLES');
    expect(family.reply).toMatch(/운영중 품목 \d+개/);
    const ask = await respondToChat(handle.db, USER, '견적 뽑아줘');
    expect(ask.reply).toBe(QUOTE_ASK_PRODUCT);
    expect(ask.showProductChips).toBe(true);
  });

  it('AC-81: 원가 질문은 USER·ADMIN 모두 거부 문구이며 DB 를 한 번도 건드리지 않는다', async () => {
    const user = await respondToChat(forbiddenDb, USER, 'Wapples-500 원가 알려줘');
    expect(user).toMatchObject({
      intent: 'cost',
      reply: COST_REPLY_USER,
      candidates: [],
      action: null,
    });
    const admin = await respondToChat(forbiddenDb, ADMIN, '이익률이 얼마야');
    expect(admin).toMatchObject({ intent: 'cost', reply: COST_REPLY });
    expect(JSON.stringify([user, admin])).not.toMatch(COST_KEYS);
  });

  it('AC-81 쿼리 로거: 원가 질문은 SQL 0건, 어떤 입력에도 material_costs 조회 없음 (USER·ADMIN)', async () => {
    const client = (handle.db as unknown as { $client: { query: (...args: unknown[]) => unknown } })
      .$client;
    const statements: string[] = [];
    const original = client.query.bind(client);
    const spy = vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
      statements.push(String(args[0]));
      return original(...args);
    });
    try {
      for (const actor of [USER, ADMIN]) {
        statements.length = 0;
        await respondToChat(handle.db, actor, 'Wapples-500 원가 알려줘');
        await respondToChat(handle.db, actor, '마진이랑 이익률 얼마야');
        expect(statements).toEqual([]);
      }
      for (const message of [
        'Wapples-500 가격',
        'Wapples-500 (H500 T2) 작년보다 올랐어?',
        'WAPPLES 견적',
        'P10100015',
        '오늘 점심 뭐 먹지',
      ]) {
        await respondToChat(handle.db, ADMIN, message);
      }
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.join(' ')).not.toMatch(/material_costs/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('AC-82: 알 수 없는 입력 → 도움말 + 예시 (DB 접근 없음)', async () => {
    const result = await respondToChat(forbiddenDb, USER, '오늘 점심 뭐 먹지');
    expect(result).toMatchObject({ intent: 'help', reply: HELP_REPLY });
    expect(result.reply).toContain('작년보다 올랐어?');
  });

  it('검색은 ILIKE 와일드카드를 문자 그대로 다루고 제품군으로 좁힐 수 있다', async () => {
    expect((await findChatItems(handle.db, '%')).hits).toEqual([]);
    expect((await findChatItems(handle.db, 'P1010001_')).hits).toEqual([]);
    expect((await findChatItems(handle.db, 'P10100015')).exactCode).toBe(true);
    expect((await findChatItems(handle.db, 'Wapples-500', 'D.AMO')).hits).toEqual([]);
    expect((await findChatItems(handle.db, 'Wapples-500', 'WAPPLES')).hits).toHaveLength(2);
    const rows = await handle.db
      .select({ code: salesPrices.itemCode })
      .from(salesPrices)
      .where(and(eq(salesPrices.itemCode, 'P10100015'), eq(salesPrices.productFamily, 'WAPPLES')));
    expect(rows.length).toBeGreaterThan(0);
  });
});
