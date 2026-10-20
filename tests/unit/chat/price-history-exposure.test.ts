// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { importBatches, items, salesPrices } from '@/db/schema';
import { CHAT_FEATURES } from '@/server/chat/features/registry';
import { assertNoCostKeys } from '@/server/chat/graph/guard';

import { ScriptedChatModel, serializeCalls } from '../../fixtures/chat/scripted-model';
import { ask, captureSql, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * 챗봇 회귀 (price-change-history-modal §3): 가격 변동 이력 모달이 생겨도 챗봇 경로는 그대로다 —
 * 도구는 현재·직전 2시기 비교뿐이고, 계열 전체 이력(오래된 시기 가격)·ERP 비고·배치 파일명·직전 대비 금액·원가가
 * 도구 결과·LLM 발신 페이로드·응답에 나가지 않는다. 이력 쿼리(계열 lag 윈도)도 실행되지 않는다.
 */
const CODE = 'PHIST01';
/** 오래된 두 시기 가격 — 전체 이력이 새면 보인다 */
const OLD_MARKERS = ['111111', '111,111', '222222', '222,222'];
const REMARK_MARKER = 'ERP비고표식7731';
const HISTORY_KEYS = /erpRemark|batchFileName|changeAmount|previousPrice|costRatio|cost_ratio/;
let ctx: ChatTestDb;

beforeAll(async () => {
  ctx = await setupChatDb();
  const [batch] = await ctx.handle.db.select({ id: importBatches.id }).from(importBatches).limit(1);
  await ctx.handle.db.insert(items).values({
    itemCode: CODE,
    itemName: '이력 표식 모델',
    raw: { 비고: REMARK_MARKER },
    importBatchId: batch!.id,
  });
  const prices = [
    ['2020-01-01', '111111.00', '2021-01-01', '미사용'],
    ['2021-01-01', '222222.00', '2022-01-01', '미사용'],
    ['2022-01-01', '333333.00', '2023-01-01', '미사용'],
    ['2023-01-01', '444444.00', null, '운영중'],
  ] as const;
  await ctx.handle.db.insert(salesPrices).values(
    prices.map(([from, price, to, status], i) => ({
      sourceId: 99_100 + i,
      productFamily: 'WAPPLES',
      itemCode: CODE,
      itemName: '이력 표식 모델',
      unit: 'EA',
      priceType: '정상판매',
      priceCategory: '일반',
      currency: 'KRW',
      hasCorePrice: false,
      unitPrice: price,
      effectiveFrom: from,
      effectiveTo: to,
      isLatestInSeries: to === null,
      appliesToAllCustomers: false,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      source: 'erp' as const,
      importBatchId: batch!.id,
      operationStatus: status,
    })),
  );
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

describe('챗봇 — 가격 변동 이력·원가 미노출', () => {
  it('레지스트리에 이력 도구가 없다 (이력 모달은 화면 전용)', () => {
    const tools = CHAT_FEATURES.flatMap((feature) => feature.tools);
    expect(
      tools.filter((tool) => /history|이력/i.test(`${tool.name} ${tool.description}`)),
    ).toEqual([]);
  });

  it.each(['USER', 'ADMIN'] as const)(
    '%s: "변동 이력 전부" 질문 + 모든 가격 도구 호출 → 2시기 비교만, 이력·비고·원가 없음, 이력 쿼리 0',
    async (role) => {
      const model = new ScriptedChatModel([
        {
          toolCalls: [
            { name: 'price_compare_previous', args: { query: CODE } },
            { name: 'price_lookup', args: { query: CODE, family: null } },
          ],
        },
        { text: '현재가와 직전가를 비교했습니다.' },
      ]);
      const capture = captureSql(ctx.handle);
      let reply;
      try {
        reply = await ask(
          scriptedRuntime(ctx.handle, { model }),
          `${CODE} 가격 변동 이력 전부 보여줘`,
          { role },
        );
      } finally {
        capture.restore();
      }
      // LLM 도구 경로를 실제로 탔다 (도구 호출 → 도구 결과를 실은 두 번째 호출)
      expect(model.calls).toHaveLength(2);
      const payload = serializeCalls(model.calls);
      const sqlText = capture.statements.join('\n');
      expect(sqlText).not.toMatch(/material_costs|cost_item_links/i);
      expect(sqlText).not.toMatch(/lag\(|price_prev|import_batches/i);
      for (const text of [payload, JSON.stringify(reply)]) {
        for (const marker of [...OLD_MARKERS, REMARK_MARKER]) expect(text).not.toContain(marker);
        expect(text).not.toMatch(HISTORY_KEYS);
      }
      expect(() => assertNoCostKeys(reply)).not.toThrow();
      // 비교 도구는 현재(444,444)·직전(333,333) 두 시기만 싣는다
      expect(payload).toMatch(/444,?444/);
      expect(payload).toMatch(/333,?333/);
    },
  );
});
