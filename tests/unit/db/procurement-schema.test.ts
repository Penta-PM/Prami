// @vitest-environment node
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import {
  procurementBidKeywords,
  procurementBidNotices,
  procurementDeliveries,
  procurementDeliveryChanges,
  procurementItemChanges,
  procurementItems,
  procurementJobRuns,
  procurementVDeliveries,
  procurementVItemPrices,
  procurementVProductDeliveries,
  type NewProcurementDelivery,
} from '@/db/schema';
import { queryRows } from '@/server/imports/sql-rows';

import { createTestDb } from '../../helpers/pglite';

/**
 * 조달이 통합 DB-1 — 0012_procurement_schema (PGlite). 합성 데이터만 쓴다(가짜 물품식별번호·업체명).
 * 트리거 product_group 전 분기·updated_at, 뷰 3개(첫 변경차수·조인 조건·최근 단가), UNIQUE·CHECK·FK(SET NULL).
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

/** Drizzle 은 DB 오류를 "Failed query: …" 로 감싸고 원인을 cause 에 둔다 → 메시지·코드를 모두 모은다 */
function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: string }).code;
    parts.push(`${String((current as Error).message ?? current)}${code ? ` [${code}]` : ''}`);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

async function failure(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => {
      throw new Error('위반이 거부되지 않았습니다');
    },
    (error: unknown) => errorText(error),
  );
}

function delivery(values: Partial<NewProcurementDelivery> & { dlvrReqNo: string; itemId: string }) {
  return { vendor: '가상상사', demandOrg: '가상기관', ...values };
}

describe('스키마 구성', () => {
  it('procurement 스키마에 테이블 9개(원본 8 + mail_recipients 0013)·뷰 3개가 생기고 public 에는 새 테이블이 없다', async () => {
    const tables = await queryRows<{ table_name: string; table_type: string }>(
      handle.db,
      sql`select table_name, table_type from information_schema.tables
          where table_schema = 'procurement' order by table_name`,
    );
    expect(tables.filter((t) => t.table_type === 'BASE TABLE').map((t) => t.table_name)).toEqual([
      'app_state',
      'bid_keywords',
      'bid_notices',
      'deliveries',
      'delivery_changes',
      'item_changes',
      'items',
      'job_runs',
      'mail_recipients',
    ]);
    expect(tables.filter((t) => t.table_type === 'VIEW').map((t) => t.table_name)).toEqual([
      'v_deliveries',
      'v_item_prices',
      'v_product_deliveries',
    ]);
    const publicLeak = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from information_schema.tables
          where table_schema = 'public' and table_name in ('deliveries', 'bid_notices', 'v_deliveries')`,
    );
    expect(publicLeak[0]?.n).toBe(0);
  });

  it('인덱스 이름·정의가 원본과 같다 (posted_at desc 는 기본 NULLS FIRST)', async () => {
    const indexes = await queryRows<{ indexname: string; indexdef: string }>(
      handle.db,
      sql`select indexname, indexdef from pg_indexes where schemaname = 'procurement' order by indexname`,
    );
    const byName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
    expect(byName.items_item_id_idx).toMatch(/\(item_id\)$/);
    expect(byName.items_status_idx).toMatch(/\(status, product\)$/);
    expect(byName.deliveries_item_id_idx).toMatch(/\(item_id\)$/);
    expect(byName.deliveries_date_idx).toMatch(/\(dlvr_req_date\)$/);
    expect(byName.bid_notices_posted_idx).toMatch(/\(posted_at DESC\)$/);
  });

  it('뷰 열 목록이 원본 `*`·`d.*` 순서를 명시한 것과 같다', async () => {
    const columns = async (table: string) =>
      (
        await queryRows<{ column_name: string }>(
          handle.db,
          sql`select column_name from information_schema.columns
              where table_schema = 'procurement' and table_name = ${table} order by ordinal_position`,
        )
      ).map((row) => row.column_name);
    const deliveryColumns = await columns('deliveries');
    expect(deliveryColumns.at(-1)).toBe('excluded');
    expect(await columns('v_deliveries')).toEqual(deliveryColumns);
    expect(await columns('v_product_deliveries')).toEqual([
      'product',
      'product_group',
      'detail_category',
      ...deliveryColumns,
    ]);
    expect(await columns('v_item_prices')).toEqual(['item_id', 'unit_price', 'price_date']);
  });
});

describe('트리거 items_before_write', () => {
  const cases: Array<[string | null, string]> = [
    ['SSO', 'SSO'],
    ['PKI', 'WA'],
    ['OTP', 'PASS'],
    ['생체인증', 'PASS'],
    ['PIN', 'PASS'],
    ['간편인증', 'PASS'],
    ['인증서중계', 'PASS'],
    ['OS 로그온', 'OS 로그온'],
    ['01 가상분류', 'SSO'],
    ['02 가상분류', 'WA'],
    ['03 가상분류', 'PASS'],
    ['04 가상분류', 'OS 로그온'],
    ['05 가상분류', '기타'],
    ['가상분류', '기타'],
    [null, '기타'],
  ];

  it.each(cases)('iSIGN 세부분류 %s → product_group %s', async (detailCategory, expected) => {
    const [row] = await handle.db
      .insert(procurementItems)
      .values({
        itemId: `TRG-${detailCategory ?? 'null'}`,
        product: 'iSIGN',
        detailCategory,
        productGroup: '직접 넣은 값',
      })
      .returning();
    expect(row?.productGroup).toBe(expected);
  });

  it('iSIGN 이 아니면 product_group 을 비운다', async () => {
    for (const product of ['WAPPLES', 'D.AMO', '기타']) {
      const [row] = await handle.db
        .insert(procurementItems)
        .values({ itemId: 'TRG-OTHER', product, detailCategory: 'SSO', productGroup: 'SSO' })
        .returning();
      expect(row?.productGroup).toBeNull();
    }
  });

  it('수정 때도 다시 계산하고 updated_at 을 지금 시각으로 바꾼다', async () => {
    const [inserted] = await handle.db
      .insert(procurementItems)
      .values({
        itemId: 'TRG-UPD',
        product: 'iSIGN',
        detailCategory: 'SSO',
        updatedAt: new Date('2000-01-01T00:00:00Z'),
      })
      .returning();
    expect(inserted?.updatedAt.getTime()).toBeGreaterThan(Date.parse('2020-01-01'));
    await handle.db.execute(
      sql`update procurement.items set updated_at = '2000-01-01', detail_category = 'PKI' where id = ${inserted!.id}`,
    );
    const [updated] = await handle.db
      .select()
      .from(procurementItems)
      .where(eq(procurementItems.id, inserted!.id));
    expect(updated?.productGroup).toBe('WA');
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(Date.parse('2020-01-01'));
    await handle.db
      .update(procurementItems)
      .set({ product: 'WAPPLES' })
      .where(eq(procurementItems.id, inserted!.id));
    const [moved] = await handle.db
      .select({ productGroup: procurementItems.productGroup })
      .from(procurementItems)
      .where(eq(procurementItems.id, inserted!.id));
    expect(moved?.productGroup).toBeNull();
  });
});

describe('뷰', () => {
  it('v_deliveries: 같은 요구번호·물품의 여러 변경차수 → 첫 차수 1행, 삭제 표시된 차수는 건너뛴다', async () => {
    await handle.db.insert(procurementDeliveries).values([
      delivery({ dlvrReqNo: 'VD-1', itemId: 'VD-ITEM', changeOrd: '02', amount: 300 }),
      delivery({ dlvrReqNo: 'VD-1', itemId: 'VD-ITEM', changeOrd: '00', amount: 100 }),
      delivery({ dlvrReqNo: 'VD-1', itemId: 'VD-ITEM', changeOrd: '01', amount: 200 }),
      // 다른 물품은 별도 행
      delivery({ dlvrReqNo: 'VD-1', itemId: 'VD-ITEM-B', changeOrd: '01', amount: 50 }),
      // 첫 차수가 삭제 표시면 남은 차수 중 첫 차수
      delivery({ dlvrReqNo: 'VD-2', itemId: 'VD-ITEM', changeOrd: '00', excluded: true }),
      delivery({ dlvrReqNo: 'VD-2', itemId: 'VD-ITEM', changeOrd: '01', amount: 70 }),
      // 전부 삭제 표시면 행 없음
      delivery({ dlvrReqNo: 'VD-3', itemId: 'VD-ITEM', changeOrd: '00', excluded: true }),
    ]);
    const rows = await handle.db
      .select({
        dlvrReqNo: procurementVDeliveries.dlvrReqNo,
        itemId: procurementVDeliveries.itemId,
        changeOrd: procurementVDeliveries.changeOrd,
        amount: procurementVDeliveries.amount,
        vendor: procurementVDeliveries.vendor,
      })
      .from(procurementVDeliveries)
      .where(sql`${procurementVDeliveries.dlvrReqNo} like 'VD-%'`)
      .orderBy(asc(procurementVDeliveries.dlvrReqNo), asc(procurementVDeliveries.itemId));
    expect(rows).toEqual([
      { dlvrReqNo: 'VD-1', itemId: 'VD-ITEM', changeOrd: '00', amount: 100, vendor: '가상상사' },
      { dlvrReqNo: 'VD-1', itemId: 'VD-ITEM-B', changeOrd: '01', amount: 50, vendor: '가상상사' },
      { dlvrReqNo: 'VD-2', itemId: 'VD-ITEM', changeOrd: '01', amount: 70, vendor: '가상상사' },
    ]);
  });

  it('v_product_deliveries: 등록(active)이고 제품이 기타가 아닌 물품과만 연결된다', async () => {
    await handle.db.insert(procurementItems).values([
      { itemId: 'PD-ACTIVE', product: 'WAPPLES' },
      { itemId: 'PD-ISIGN', product: 'iSIGN', detailCategory: 'OTP' },
      { itemId: 'PD-PENDING', product: 'D.AMO', status: 'pending' },
      { itemId: 'PD-EXCLUDED', product: 'D.AMO', status: 'excluded' },
      { itemId: 'PD-ETC', product: '기타' },
      // 같은 물품식별번호가 두 제품에 등록되면 제품마다 한 줄 (UNIQUE 는 (item_id, product))
      { itemId: 'PD-TWO', product: 'WAPPLES' },
      { itemId: 'PD-TWO', product: 'D.AMO' },
    ]);
    await handle.db
      .insert(procurementDeliveries)
      .values(
        [
          'PD-ACTIVE',
          'PD-ISIGN',
          'PD-PENDING',
          'PD-EXCLUDED',
          'PD-ETC',
          'PD-TWO',
          'PD-UNREGISTERED',
        ].map((itemId) => delivery({ dlvrReqNo: `PD-REQ-${itemId}`, itemId })),
      );
    await handle.db
      .insert(procurementDeliveries)
      .values(delivery({ dlvrReqNo: 'PD-REQ-GONE', itemId: 'PD-ACTIVE', excluded: true }));
    const rows = await handle.db
      .select({
        itemId: procurementVProductDeliveries.itemId,
        product: procurementVProductDeliveries.product,
        productGroup: procurementVProductDeliveries.productGroup,
        detailCategory: procurementVProductDeliveries.detailCategory,
        dlvrReqNo: procurementVProductDeliveries.dlvrReqNo,
      })
      .from(procurementVProductDeliveries)
      .where(sql`${procurementVProductDeliveries.itemId} like 'PD-%'`)
      .orderBy(
        asc(procurementVProductDeliveries.itemId),
        asc(procurementVProductDeliveries.product),
      );
    expect(rows).toEqual([
      {
        itemId: 'PD-ACTIVE',
        product: 'WAPPLES',
        productGroup: null,
        detailCategory: null,
        dlvrReqNo: 'PD-REQ-PD-ACTIVE',
      },
      {
        itemId: 'PD-ISIGN',
        product: 'iSIGN',
        productGroup: 'PASS',
        detailCategory: 'OTP',
        dlvrReqNo: 'PD-REQ-PD-ISIGN',
      },
      {
        itemId: 'PD-TWO',
        product: 'D.AMO',
        productGroup: null,
        detailCategory: null,
        dlvrReqNo: 'PD-REQ-PD-TWO',
      },
      {
        itemId: 'PD-TWO',
        product: 'WAPPLES',
        productGroup: null,
        detailCategory: null,
        dlvrReqNo: 'PD-REQ-PD-TWO',
      },
    ]);
  });

  it('v_item_prices: 0 초과 단가 중 가장 최근 납품요구일자의 단가, 단가 이력이 없으면 행 없음', async () => {
    await handle.db.insert(procurementDeliveries).values([
      delivery({ dlvrReqNo: 'IP-1', itemId: 'IP-A', dlvrReqDate: '2025-01-10', unitPrice: 1000 }),
      delivery({ dlvrReqNo: 'IP-2', itemId: 'IP-A', dlvrReqDate: '2025-06-01', unitPrice: 1200 }),
      // 더 최근이지만 0·null 단가는 건너뛴다
      delivery({ dlvrReqNo: 'IP-3', itemId: 'IP-A', dlvrReqDate: '2025-09-01', unitPrice: 0 }),
      delivery({ dlvrReqNo: 'IP-4', itemId: 'IP-A', dlvrReqDate: '2025-10-01', unitPrice: null }),
      // 삭제 표시된 납품요구(v_deliveries 에서 빠짐)의 단가는 쓰지 않는다
      delivery({
        dlvrReqNo: 'IP-5',
        itemId: 'IP-A',
        dlvrReqDate: '2025-11-01',
        unitPrice: 9999,
        excluded: true,
      }),
      // 첫 변경차수의 단가를 쓴다 (v_deliveries 기준)
      delivery({
        dlvrReqNo: 'IP-6',
        itemId: 'IP-B',
        changeOrd: '00',
        dlvrReqDate: '2025-03-01',
        unitPrice: 500,
      }),
      delivery({
        dlvrReqNo: 'IP-6',
        itemId: 'IP-B',
        changeOrd: '01',
        dlvrReqDate: '2025-03-01',
        unitPrice: 800,
      }),
      delivery({ dlvrReqNo: 'IP-7', itemId: 'IP-C', dlvrReqDate: '2025-03-01', unitPrice: 0 }),
    ]);
    const rows = await handle.db
      .select()
      .from(procurementVItemPrices)
      .where(sql`${procurementVItemPrices.itemId} like 'IP-%'`)
      .orderBy(asc(procurementVItemPrices.itemId));
    expect(rows).toEqual([
      { itemId: 'IP-A', unitPrice: 1200, priceDate: '2025-06-01' },
      { itemId: 'IP-B', unitPrice: 500, priceDate: '2025-03-01' },
    ]);
  });
});

describe('제약', () => {
  it('UNIQUE 위반: items(item_id, product) · deliveries(요구번호, 물품, 차수) · bid_keywords(product, keyword)', async () => {
    await handle.db.insert(procurementItems).values({ itemId: 'UQ-1', product: 'WAPPLES' });
    expect(
      await failure(
        handle.db.insert(procurementItems).values({ itemId: 'UQ-1', product: 'WAPPLES' }),
      ),
    ).toContain('items_item_id_product_key');
    await handle.db.insert(procurementItems).values({ itemId: 'UQ-1', product: 'D.AMO' });

    await handle.db
      .insert(procurementDeliveries)
      .values(delivery({ dlvrReqNo: 'UQ-R', itemId: 'UQ-1', changeOrd: '00' }));
    expect(
      await failure(
        handle.db
          .insert(procurementDeliveries)
          .values(delivery({ dlvrReqNo: 'UQ-R', itemId: 'UQ-1' })),
      ),
    ).toContain('deliveries_dlvr_req_no_item_id_change_ord_key');

    await handle.db
      .insert(procurementBidKeywords)
      .values({ product: 'iSIGN', keyword: '가상키워드' });
    expect(
      await failure(
        handle.db
          .insert(procurementBidKeywords)
          .values({ product: 'iSIGN', keyword: '가상키워드' }),
      ),
    ).toContain('bid_keywords_product_keyword_key');
  });

  it.each([
    [
      'items.status',
      sql`insert into procurement.items (item_id, product, status) values ('CK-1', 'WAPPLES', 'deleted')`,
      'items_status_check',
    ],
    [
      'items.source',
      sql`insert into procurement.items (item_id, product, source) values ('CK-2', 'WAPPLES', 'import')`,
      'items_source_check',
    ],
    [
      'bid_keywords.product',
      sql`insert into procurement.bid_keywords (product, keyword) values ('기타', '가상')`,
      'bid_keywords_product_check',
    ],
    [
      'bid_keywords.keyword (공백)',
      sql`insert into procurement.bid_keywords (product, keyword) values ('제외', '   ')`,
      'bid_keywords_keyword_check',
    ],
    [
      'job_runs.status',
      sql`insert into procurement.job_runs (job, status) values ('daily', 'done')`,
      'job_runs_status_check',
    ],
    [
      'bid_notices.fit_grade',
      sql`insert into procurement.bid_notices (bid_no, title, fit_grade) values ('CK-B', '가상 공고', '최상')`,
      'bid_notices_fit_grade_check',
    ],
  ])('CHECK 위반: %s', async (_label, statement, constraint) => {
    const text = await failure(handle.db.execute(statement));
    expect(text).toContain(constraint);
    expect(text).toContain('[23514]');
  });

  it('기본값: 상태·출처·차수·배열·job 상태', async () => {
    const [item] = await handle.db
      .insert(procurementItems)
      .values({ itemId: 'DF-1', product: 'D.AMO' })
      .returning();
    expect(item).toMatchObject({ status: 'active', source: 'auto', reviewed: false });
    const [notice] = await handle.db
      .insert(procurementBidNotices)
      .values({ bidNo: 'DF-B', title: '가상 공고', fitGrade: '상' })
      .returning();
    expect(notice).toMatchObject({ bidOrd: '000', products: [], keywords: [], fitReasons: [] });
    const [run] = await handle.db.insert(procurementJobRuns).values({ job: 'bids' }).returning();
    expect(run?.status).toBe('running');
    const [row] = await handle.db
      .insert(procurementDeliveries)
      .values(delivery({ dlvrReqNo: 'DF-R', itemId: 'DF-1' }))
      .returning();
    expect(row).toMatchObject({ changeOrd: '00', excluded: false });
  });

  it('FK ON DELETE SET NULL: 물품·납품요구를 지워도 이력은 남고 참조만 비운다', async () => {
    const [item] = await handle.db
      .insert(procurementItems)
      .values({ itemId: 'FK-1', product: 'WAPPLES' })
      .returning();
    const [change] = await handle.db
      .insert(procurementItemChanges)
      .values({ itemPk: item!.id, action: 'add', after: { item_id: 'FK-1' }, changedBy: 'system' })
      .returning();
    const [row] = await handle.db
      .insert(procurementDeliveries)
      .values(delivery({ dlvrReqNo: 'FK-R', itemId: 'FK-1' }))
      .returning();
    const [deliveryChange] = await handle.db
      .insert(procurementDeliveryChanges)
      .values({ deliveryId: row!.id, before: { vendor: 'a' }, after: { vendor: 'b' } })
      .returning();

    await handle.db.delete(procurementItems).where(eq(procurementItems.id, item!.id));
    await handle.db.delete(procurementDeliveries).where(eq(procurementDeliveries.id, row!.id));

    const [itemChange] = await handle.db
      .select()
      .from(procurementItemChanges)
      .where(eq(procurementItemChanges.id, change!.id));
    expect(itemChange).toMatchObject({ itemPk: null, action: 'add' });
    const [kept] = await handle.db
      .select()
      .from(procurementDeliveryChanges)
      .where(eq(procurementDeliveryChanges.id, deliveryChange!.id));
    expect(kept?.deliveryId).toBeNull();

    expect(
      await failure(
        handle.db.insert(procurementItemChanges).values({ itemPk: 987_654_321, action: 'edit' }),
      ),
    ).toContain('item_changes_item_pk_fkey');
  });
});
