import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { sortRows, type SortDir } from '@/lib/table/compare';
import { queryRows } from '@/server/imports/sql-rows';
import { byText } from '@/server/pricing/sort-sql';

import { PARITY_STRINGS } from '../helpers/sort-strings';

/**
 * #32 스펙 §7 — 실제 PostgreSQL 16 에서 서버 텍스트 정렬 키(byText: lower(x COLLATE "C") COLLATE "C", 빈 값 NULLS LAST)가
 * 클라이언트 compareText(sortRows 'text')와 같은 순서를 내는지. PGlite 와 달리 DB 기본 collation 이 en_US 등일 수 있어
 * lower() 가 비ASCII(Ä·É·Ω)를 바꾸지 않는지가 여기서만 드러난다. VALUES 만 읽으므로 DB 상태를 바꾸지 않는다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 표 정렬 클라이언트/서버 일치', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
  });

  afterAll(async () => {
    await handle?.close();
  });

  for (const dir of ['asc', 'desc'] as const satisfies readonly SortDir[]) {
    it(`대표 문자열 세트 ${dir}`, async () => {
      const values = sql.join(
        PARITY_STRINGS.map((value, ord) => sql`(${ord}::int, ${value}::text)`),
        sql`, `,
      );
      const rows = await queryRows<{ ord: number; s: string | null }>(
        handle.db,
        sql`select v.ord, v.s from (values ${values}) as v(ord, s)
            order by ${sql.join([...byText(sql`v.s`, dir), sql`v.ord asc`], sql`, `)}`,
      );
      const expected = sortRows(
        PARITY_STRINGS.map((s, ord) => ({ ord, s })),
        (row) => row.s,
        'text',
        dir,
      );
      expect(rows.map((row) => row.ord)).toEqual(expected.map((row) => row.ord));
    });
  }
});
