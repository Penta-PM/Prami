import path from 'node:path';

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

import { dbHostOf } from '@/lib/db-host';

import type { DbHandle, Schema } from './index';

/** 세 드라이버가 같은 drizzle/*.sql 을 적용한다 (§4.9.1). 기본 폴더는 저장소 루트의 drizzle/ */
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

export type MigrateOptions = { migrationsFolder?: string };

export async function migrateDb(handle: DbHandle, options: MigrateOptions = {}): Promise<void> {
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  switch (handle.driver) {
    case 'neon': {
      const { migrate } = await import('drizzle-orm/neon-http/migrator');
      await migrate(handle.db as NeonHttpDatabase<Schema>, { migrationsFolder });
      return;
    }
    case 'pg': {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(handle.db as NodePgDatabase<Schema>, { migrationsFolder });
      return;
    }
    case 'pglite': {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(handle.db as PgliteDatabase<Schema>, { migrationsFolder });
      return;
    }
  }
}

export type MigrationConnection = {
  /** 마이그레이션에 쓸 연결 문자열 (pglite 면 undefined) */
  url: string | undefined;
  /** 로그용 — 호스트만 (연결 문자열·비밀번호는 출력하지 않는다) */
  host: string | null;
  via: 'unpooled' | 'pooled' | 'none';
  warning: string | null;
};

/**
 * 마이그레이션 연결 선택 (PRAMI-003 §4.3.4·AC-327). Neon 풀링(PgBouncer transaction mode)은 마이그레이션·pg_dump 에 맞지 않으므로
 * `DATABASE_URL_UNPOOLED`(직접 연결)를 우선 쓰고, 없으면 `DATABASE_URL` + 경고.
 */
export function resolveMigrationConnection(
  source: Record<string, string | undefined>,
): MigrationConnection {
  const unpooled = source.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) return { url: unpooled, host: dbHostOf(unpooled), via: 'unpooled', warning: null };
  const pooled = source.DATABASE_URL?.trim();
  if (!pooled) return { url: undefined, host: null, via: 'none', warning: null };
  const remote = source.DB_DRIVER === 'neon';
  return {
    url: pooled,
    host: dbHostOf(pooled),
    via: 'pooled',
    warning: remote
      ? 'DATABASE_URL_UNPOOLED 가 없어 DATABASE_URL 로 마이그레이션합니다 — Neon 은 직접(비풀링) 연결을 쓰세요'
      : null,
  };
}
