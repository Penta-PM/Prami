import { randomUUID } from 'node:crypto';

import { eq, getTableColumns, getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { items, oauthFlowStates, salesPrices, users } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import { queryRows } from '@/server/imports/sql-rows';
import { lockOwnVendor } from '@/server/llm/credentials/repository';
import { consumeOAuthState } from '@/server/llm/oauth/state-store';
import { readSchemaState } from '@/server/ops/schema-version';

/**
 * 체크리스트 C-6 Neon 실연결 회귀 (PRAMI-003 D-2, PR #26 D-2) — `pnpm test:neon`.
 * 실제 Neon 드라이버 경로(neon-http 쿼리·마이그레이터, WebSocket Pool 트랜잭션)로 AC-01·AC-21·AC-215·AC-244 ⑤ 를 확인한다.
 * - 대상은 preview 에서 만든 **일회용 Neon 브랜치**다(테스트 사용자·OAuth state 행을 쓰고 지운다). production `main` 금지.
 * - 환경이 없으면 건너뛰지 않고 **실패**한다 — `0건 실행 = 통과` 거짓 게이트 방지. 오입력 방지로 NEON_TEST_ALLOW_HOST 가
 *   DATABASE_URL 의 호스트와 같아야 실행한다.
 * - 로컬 예행: NEON_LOCAL_PG_URL(격리 PG)을 주면 tests/neon/setup.ts 가 Neon 전송만 로컬로 돌린다.
 */
type NeonTarget = { ok: true; databaseUrl: string } | { ok: false; reason: string };

function neonTarget(): NeonTarget {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.DB_DRIVER !== 'neon' || !databaseUrl) {
    return { ok: false, reason: 'DB_DRIVER=neon 과 DATABASE_URL(일회용 Neon 브랜치)이 필요합니다' };
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return { ok: false, reason: 'DATABASE_URL 형식이 올바르지 않습니다' };
  }
  if (process.env.NEON_TEST_ALLOW_HOST !== host) {
    return { ok: false, reason: 'NEON_TEST_ALLOW_HOST 가 DATABASE_URL 의 호스트와 같아야 합니다' };
  }
  return { ok: true, databaseUrl };
}

const target = neonTarget();

if (!target.ok) {
  describe('C-6 Neon 실연결 회귀 — 환경', () => {
    it('대상 Neon 브랜치가 지정돼야 한다 (건너뛰기 = 실패)', () => {
      throw new Error(target.reason);
    });
  });
} else {
  describe('C-6 Neon 실연결 회귀 (DB_DRIVER=neon)', () => {
    let handle: DbHandle;
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    let userId: string;

    beforeAll(async () => {
      handle = await createDb({ driver: 'neon', databaseUrl: target.databaseUrl });
      // C-5 이후라 이미 적용돼 있어야 한다 — neon-http 마이그레이터로 다시 적용해도 변화 없음(멱등)
      await migrateDb(handle);
      const [user] = await handle.db
        .insert(users)
        .values({ email: `neon-c6-${stamp}@example.invalid`, name: 'C-6', createdVia: 'admin' })
        .returning({ id: users.id });
      userId = user!.id;
    });

    afterAll(async () => {
      // oauth_flow_states 는 users ON DELETE CASCADE
      if (userId) await handle.db.delete(users).where(eq(users.id, userId));
      await handle?.close();
    });

    it('neon-http 마이그레이터: drizzle/*.sql 재적용(멱등) 후 저널과 일치 (AC-01, C-5)', async () => {
      await migrateDb(handle);
      expect(await readSchemaState(handle.db)).toBe('ok');
    });

    it.each<[string, PgTable]>([
      ['sales_prices', salesPrices],
      ['items', items],
    ])('AC-01 %s 의 스키마 컬럼이 DB 에 모두 있다 (neon-http 조회)', async (name, table) => {
      expect(getTableName(table)).toBe(name);
      const rows = await queryRows<{ column_name: string }>(
        handle.db,
        sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${name}`,
      );
      const actual = new Set(rows.map((row) => row.column_name));
      const expected = Object.values(getTableColumns(table)).map((column) => column.name);
      expect(expected.filter((column) => !actual.has(column))).toEqual([]);
    });

    it('AC-21 계열마다 최신 행 정확히 1개 (적재된 데이터 기준, neon-http)', async () => {
      const [result] = await queryRows<{ broken: number | string }>(
        handle.db,
        sql`select count(*)::int as broken from (select series_key from sales_prices group by series_key having sum(is_latest_in_series::int) <> 1) s`,
      );
      expect(Number(result!.broken)).toBe(0);
    });

    it('WebSocket 트랜잭션: 오류면 롤백, 정상이면 커밋 (db/tx.ts neon 경로)', async () => {
      const email = `neon-c6-tx-${stamp}@example.invalid`;
      await expect(
        withTransaction(async (tx) => {
          await tx.insert(users).values({ email, name: 'tx', createdVia: 'admin' });
          throw new Error('rollback-probe');
        }, handle),
      ).rejects.toThrow('rollback-probe');
      expect(await handle.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);

      await withTransaction(async (tx) => {
        await tx.insert(users).values({ email, name: 'tx', createdVia: 'admin' });
      }, handle);
      expect(await handle.db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
      await handle.db.delete(users).where(eq(users.email, email));
    });

    it('AC-215 자격 증명 advisory xact lock: 두 WebSocket 트랜잭션이 직렬화된다', async () => {
      const events: string[] = [];
      let signalLocked!: () => void;
      const firstLocked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const first = withTransaction(async (tx) => {
        await lockOwnVendor(tx, userId, 'openai');
        events.push('first-locked');
        signalLocked();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        events.push('first-commit');
      }, handle);
      await firstLocked;
      const second = withTransaction(async (tx) => {
        await lockOwnVendor(tx, userId, 'openai');
        events.push('second-locked');
      }, handle);
      await Promise.all([first, second]);
      expect(events).toEqual(['first-locked', 'first-commit', 'second-locked']);
    });

    it('AC-244 ⑤ OAuth state 는 동시에 와도 한 번만 소비된다 (neon-http ON CONFLICT DO NOTHING)', async () => {
      const input = {
        userId,
        vendor: 'openrouter',
        state: `c6-${stamp}`,
        expiresAt: Date.now() + 10 * 60_000,
      };
      const settled = await Promise.allSettled([
        consumeOAuthState(handle, input),
        consumeOAuthState(handle, input),
      ]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      await expect(consumeOAuthState(handle, input)).rejects.toMatchObject({ code: 'reused' });
      const rows = await handle.db
        .select()
        .from(oauthFlowStates)
        .where(eq(oauthFlowStates.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateHash).not.toContain(input.state);
    });
  });
}
