// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, getDb, getDbHandle, resetDbHandle } from '@/db';
import { DEFAULT_MIGRATIONS_FOLDER } from '@/db/migrate';
import { withTransaction } from '@/db/tx';

afterAll(async () => {
  await resetDbHandle();
});

describe('createDb (§4.9.1 드라이버 분기)', () => {
  it('pglite 는 DATABASE_URL 없이 인프로세스로 열린다', async () => {
    const handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
    expect(handle.driver).toBe('pglite');
    const result = await handle.db.execute(sql`select 1 as one`);
    expect((result as { rows: Array<{ one: number }> }).rows[0]?.one).toBe(1);
    await handle.close();
  });

  it.each(['pg', 'neon'] as const)('%s 는 DATABASE_URL 이 없으면 throw 한다', async (driver) => {
    await expect(createDb({ driver, databaseUrl: undefined })).rejects.toThrow(/DATABASE_URL/);
  });

  it('getDb / getDbHandle 은 공유 인스턴스를 재사용한다 (테스트 env: pglite)', async () => {
    const first = await getDbHandle();
    const second = await getDbHandle();
    expect(second).toBe(first);
    expect(await getDb()).toBe(first.db);
    expect(first.driver).toBe('pglite');
  });

  it('공유 핸들 생성이 실패하면 캐시를 비워 다음 호출이 다시 시도한다', async () => {
    await resetDbHandle();
    const original = process.env.DB_DRIVER;
    // env 는 import 시점에 파싱되므로 createDb 가 읽는 값을 바꿀 수 없다 → 실패는 URL 누락 경로로 재현한다
    const { env } = await import('@/env');
    const spy = { driver: env.DB_DRIVER };
    (env as { DB_DRIVER: string }).DB_DRIVER = 'pg';
    try {
      await expect(getDbHandle()).rejects.toThrow(/DATABASE_URL/);
      (env as { DB_DRIVER: string }).DB_DRIVER = spy.driver;
      const recovered = await getDbHandle();
      expect(recovered.driver).toBe('pglite');
    } finally {
      (env as { DB_DRIVER: string }).DB_DRIVER = spy.driver;
      process.env.DB_DRIVER = original;
    }
  });

  it('withTransaction 은 롤백을 지원한다', async () => {
    const handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
    await handle.db.execute(sql`create table t_rollback (id int primary key)`);
    await expect(
      withTransaction(async (tx) => {
        await tx.execute(sql`insert into t_rollback values (1)`);
        throw new Error('boom');
      }, handle),
    ).rejects.toThrow('boom');
    const result = await handle.db.execute(sql`select count(*)::int as n from t_rollback`);
    expect((result as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(0);
    await handle.close();
  });

  it('기본 마이그레이션 폴더는 저장소 루트의 drizzle/ 이다', () => {
    expect(DEFAULT_MIGRATIONS_FOLDER.replace(/\\/g, '/')).toMatch(/\/drizzle$/);
  });
});
