// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { withTransaction } from '@/db/tx';

/**
 * Neon 경로는 프로젝트가 아직 없어 실제 연결을 검증할 수 없다(§10 R-11).
 * 드라이버 모듈을 모킹해 팩토리·트랜잭션·마이그레이터가 올바른 모듈과 인자로 배선되는지만 확인한다.
 */
const neonClient = { tag: 'neon-http-client' };
const poolEnd = vi.fn(async () => undefined);
const serverlessTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn('TX'));
const neonHttpMigrate = vi.fn(async () => undefined);

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => neonClient),
  neonConfig: {} as { webSocketConstructor?: unknown },
  Pool: class {
    constructor(public options: { connectionString: string }) {}
    end = poolEnd;
  },
}));
vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: vi.fn(({ client }: { client: unknown }) => ({ kind: 'neon-http', client })),
}));
vi.mock('drizzle-orm/neon-serverless', () => ({
  drizzle: vi.fn(() => ({ kind: 'neon-serverless', transaction: serverlessTransaction })),
}));
vi.mock('drizzle-orm/neon-http/migrator', () => ({ migrate: neonHttpMigrate }));
vi.mock('ws', () => ({ default: class FakeWebSocket {} }));

const URL = 'postgresql://user:pw@ep-test.neon.tech/prami?sslmode=require';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DB_DRIVER=neon (모킹)', () => {
  it('createDb 는 neon-http 클라이언트를 만들고 URL 을 핸들에 보존한다', async () => {
    const { neon } = await import('@neondatabase/serverless');
    const handle = await createDb({ driver: 'neon', databaseUrl: URL });
    expect(handle.driver).toBe('neon');
    expect(handle.databaseUrl).toBe(URL);
    expect(neon).toHaveBeenCalledWith(URL);
    expect((handle.db as unknown as { kind: string }).kind).toBe('neon-http');
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('withTransaction 은 WebSocket Pool 로 별도 클라이언트를 열고 끝나면 닫는다', async () => {
    const { neonConfig } = await import('@neondatabase/serverless');
    const handle = await createDb({ driver: 'neon', databaseUrl: URL });
    const result = await withTransaction(async (tx) => `ran:${String(tx)}`, handle);
    expect(result).toBe('ran:TX');
    expect(serverlessTransaction).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(neonConfig.webSocketConstructor).toBeTypeOf('function');
  });

  it('트랜잭션 콜백이 실패해도 Pool 은 닫힌다', async () => {
    const handle = await createDb({ driver: 'neon', databaseUrl: URL });
    await expect(
      withTransaction(async () => {
        throw new Error('boom');
      }, handle),
    ).rejects.toThrow('boom');
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('핸들에 URL 이 없으면 트랜잭션을 거부한다', async () => {
    const broken: DbHandle = {
      db: {} as DbHandle['db'],
      driver: 'neon',
      close: async () => undefined,
    };
    await expect(withTransaction(async () => 1, broken)).rejects.toThrow(/DATABASE_URL/);
  });

  it('migrateDb 는 neon-http migrator 에 마이그레이션 폴더를 넘긴다', async () => {
    const handle = await createDb({ driver: 'neon', databaseUrl: URL });
    await migrateDb(handle, { migrationsFolder: '/tmp/migrations' });
    expect(neonHttpMigrate).toHaveBeenCalledWith(handle.db, {
      migrationsFolder: '/tmp/migrations',
    });
  });
});
