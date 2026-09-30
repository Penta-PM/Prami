// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, salesPrices } from '@/db/schema';

import {
  dbShape,
  EXPECTED_EXTENSIONS,
  EXPECTED_TABLES,
  SALES_PRICE_SOURCE_COLUMNS,
} from '../../fixtures/sales-prices-columns';
import {
  describeColumns,
  listExtensions,
  listIndexes,
  listTables,
} from '../../helpers/db-introspect';
import {
  assertCredentialColumns,
  assertCredentialConstraints,
} from '../../helpers/llm-schema-checks';

/** AC-01: PGlite 에 drizzle/*.sql 을 적용한 뒤 sales_prices 원본 20컬럼을 스펙 §4.3.1 과 대조한다 */
let handle: DbHandle;

/** Drizzle 은 DB 오류를 "Failed query: …" 로 감싸고 원인을 cause 에 둔다 → 원인 메시지로 판정 */
function causeMatches(pattern: RegExp) {
  return (error: unknown): boolean => {
    const cause = (error as { cause?: { message?: string } }).cause;
    return pattern.test(cause?.message ?? (error as Error).message);
  };
}

beforeAll(async () => {
  handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('마이그레이션 (PGlite)', () => {
  it('§4.3 전 테이블과 뷰가 생성된다', async () => {
    expect(await listTables(handle.db)).toEqual([...EXPECTED_TABLES]);
    const view = await handle.db.execute(
      sql`select table_name from information_schema.views where table_name = 'v_category_options'`,
    );
    expect((view as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('citext · pg_trgm · pgcrypto 확장이 설치된다', async () => {
    const extensions = await listExtensions(handle.db);
    for (const name of EXPECTED_EXTENSIONS) expect(extensions).toContain(name);
  });

  it('두 번 적용해도 오류가 없다 (idempotent)', async () => {
    await expect(migrateDb(handle)).resolves.toBeUndefined();
  });
});

describe('sales_prices 원본 20컬럼 (§4.3.1)', () => {
  it('엑셀 헤더 순서대로 이름·타입·NULL 제약이 스펙 표와 정확히 일치한다', async () => {
    const actual = await describeColumns(handle.db, 'sales_prices');
    const sourceBlock = actual.filter((column) =>
      SALES_PRICE_SOURCE_COLUMNS.some((expected) => expected.column === column.column),
    );
    expect(sourceBlock).toHaveLength(20);
    expect(sourceBlock).toEqual(SALES_PRICE_SOURCE_COLUMNS.map(dbShape));
  });

  it('원본 블록은 id 바로 뒤(ordinal 2~21)에 연속으로 놓인다', async () => {
    const actual = await describeColumns(handle.db, 'sales_prices');
    expect(actual[0]?.column).toBe('id');
    expect(actual.slice(1, 21).map((c) => c.column)).toEqual(
      SALES_PRICE_SOURCE_COLUMNS.map((c) => c.column),
    );
  });

  it('파생·메타 컬럼과 인덱스가 존재한다', async () => {
    const names = (await describeColumns(handle.db, 'sales_prices')).map((c) => c.column);
    for (const derived of [
      'source',
      'import_batch_id',
      'series_key',
      'effective_to',
      'is_latest_in_series',
      'operation_status',
      'created_by',
      'updated_by',
      'deleted_at',
      'created_at',
      'updated_at',
    ]) {
      expect(names).toContain(derived);
    }
    expect(await listIndexes(handle.db, 'sales_prices')).toEqual(
      expect.arrayContaining([
        'sales_prices_series_effective_uq',
        'sales_prices_item_code_idx',
        'sales_prices_family_effective_idx',
        'sales_prices_series_effective_idx',
        'sales_prices_operation_status_idx',
        'sales_prices_item_name_trgm_idx',
      ]),
    );
  });

  it('series_key 가 품번|단가유형|단가구분|화폐|거래처코드 로 생성되고 NULL 단가유형은 빈 문자열이 된다', async () => {
    const base = {
      sourceId: 1,
      productFamily: 'WAPPLES',
      itemCode: 'P10100014',
      itemName: 'Wapples-100 (H100 T4)',
      unit: 'EA',
      priceCategory: '일반',
      currency: 'KRW',
      hasCorePrice: false,
      unitPrice: '9000000.00',
      effectiveFrom: '2018-01-01',
      appliesToAllCustomers: false,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      source: 'erp' as const,
    };
    const [withType] = await handle.db
      .insert(salesPrices)
      .values({ ...base, priceType: '정상판매' })
      .returning({ seriesKey: salesPrices.seriesKey });
    const [nullType] = await handle.db
      .insert(salesPrices)
      .values({ ...base, sourceId: 2, priceType: null })
      .returning({ seriesKey: salesPrices.seriesKey });
    expect(withType?.seriesKey).toBe('P10100014|정상판매|일반|KRW|0');
    expect(nullType?.seriesKey).toBe('P10100014||일반|KRW|0');

    // 같은 계열·같은 적용시작일 중복은 부분 UNIQUE 인덱스가 막는다
    await expect(
      handle.db.insert(salesPrices).values({ ...base, sourceId: 3, priceType: '정상판매' }),
    ).rejects.toSatisfy(causeMatches(/sales_prices_series_effective_uq|duplicate key/));
  });
});

describe('audit_logs append-only', () => {
  it('UPDATE 와 DELETE 가 트리거에 의해 거부된다', async () => {
    const [row] = await handle.db
      .insert(auditLogs)
      .values({ actorLabel: 'test', action: 'test.insert' })
      .returning({ id: auditLogs.id });
    expect(row?.id).toBeTypeOf('number');
    await expect(
      handle.db.execute(sql`update audit_logs set reason = 'x' where id = ${row?.id}`),
    ).rejects.toSatisfy(causeMatches(/append-only/));
    await expect(
      handle.db.execute(sql`delete from audit_logs where id = ${row?.id}`),
    ).rejects.toSatisfy(causeMatches(/append-only/));
  });
});

describe('PRAMI-002 LLM 자격 증명 테이블 (AC-201)', () => {
  it('user_llm_credentials 컬럼·bytea·인덱스, user_settings 컬럼이 스펙 §4.8 과 일치', async () => {
    await assertCredentialColumns(handle);
  });

  it('UNIQUE(user_id, vendor)·CHECK(형식·길이·버전·힌트)·사용자 삭제 시 CASCADE', async () => {
    await assertCredentialConstraints(handle, 'llm-schema@pentasecurity.com');
  });
});
