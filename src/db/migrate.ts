import path from 'node:path';

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

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
