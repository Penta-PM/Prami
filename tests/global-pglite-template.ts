import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** 마이그레이션을 마친 PGlite 데이터 디렉터리 덤프 파일 경로 (tests/helpers/pglite.ts createTestDb 가 복원) */
    pgliteTemplate: string;
  }
}

/**
 * unit 프로젝트 globalSetup — PGlite 마이그레이션 템플릿 (CI 사용량 절감 PR-C).
 * 파일마다 새 PGlite + drizzle/*.sql 마이그레이션(약 3s)을 하던 것을, 실행 시작 시 한 번만 마이그레이션하고 dumpDataDir 로
 * 떠 둔 뒤 createTestDb 가 loadDataDir 로 복원(약 0.75s)하게 한다. 파일마다 독립 DB 라는 계약은 그대로다.
 * 메인 프로세스라 @/env(환경 검증)를 거치지 않도록 @/db 대신 PGlite·drizzle 마이그레이터를 직접 쓴다 — 확장 목록은
 * src/db/index.ts createPgliteDb 와 같아야 한다.
 */
export default async function setup(project: TestProject) {
  const client = await PGlite.create('memory://', { extensions: { pg_trgm, citext, pgcrypto } });
  await migrate(drizzle({ client }), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  const dump = (await client.dumpDataDir('none')) as Blob;
  await client.close();
  const file = path.join(tmpdir(), `prami-pglite-template-${process.pid}.tar`);
  writeFileSync(file, Buffer.from(await dump.arrayBuffer()));
  project.provide('pgliteTemplate', file);
  return () => rmSync(file, { force: true });
}
