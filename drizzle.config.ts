import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 설정. 마이그레이션 SQL 은 세 드라이버(neon/pg/pglite)가 공유한다 (§4.9.1).
 * `pnpm db:generate` 는 DB 연결 없이 동작하고, push/studio 등 연결이 필요한 명령만 DATABASE_URL 을 읽는다.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
