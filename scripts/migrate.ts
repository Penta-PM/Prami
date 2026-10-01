/**
 * `pnpm db:migrate` — .env.local/.env 를 Next 와 같은 규칙으로 읽고 DB_DRIVER 에 맞는 드라이버로
 * drizzle/*.sql 마이그레이션을 적용한다. env 검증(src/env.ts)은 환경 로드 뒤에 import 되어야 한다.
 * 연결은 `DATABASE_URL_UNPOOLED`(직접) 우선, 없으면 `DATABASE_URL` + 경고 (PRAMI-003 §4.3.4). 로그에는 호스트만 남긴다.
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { createDb } = await import('../src/db');
  const { migrateDb, resolveMigrationConnection, DEFAULT_MIGRATIONS_FOLDER } =
    await import('../src/db/migrate');

  const connection = resolveMigrationConnection(process.env);
  if (connection.warning) console.warn(`[db:migrate] ⚠ ${connection.warning}`);
  const handle = await createDb(connection.url ? { databaseUrl: connection.url } : {});
  try {
    console.log(
      `[db:migrate] driver=${handle.driver} via=${connection.via} host=${connection.host ?? '-'} folder=${DEFAULT_MIGRATIONS_FOLDER}`,
    );
    await migrateDb(handle);
    console.log('[db:migrate] 완료');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[db:migrate] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
