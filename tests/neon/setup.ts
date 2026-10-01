import { neonConfig } from '@neondatabase/serverless';
import { afterAll } from 'vitest';

import { installNeonLocal } from '../helpers/neon-local';

/**
 * `vitest --project neon` 준비 (PR #26 D-2). 기본은 아무것도 하지 않는다 — 실제 Neon(일회용 브랜치)에 그대로 붙는다.
 * NEON_LOCAL_PG_URL(로컬 격리 PG)이 있으면 Neon 드라이버의 HTTP·WebSocket 전송만 로컬로 돌려 같은 테스트를 예행한다
 * (DB_DRIVER=neon · DATABASE_URL · NEON_TEST_ALLOW_HOST 를 로컬 가짜 Neon 호스트로 채운다).
 */
const localPgUrl = process.env.NEON_LOCAL_PG_URL;

if (localPgUrl) {
  const local = await installNeonLocal(neonConfig, localPgUrl);
  process.env.DB_DRIVER = 'neon';
  process.env.DATABASE_URL = local.databaseUrl;
  process.env.NEON_TEST_ALLOW_HOST = new URL(local.databaseUrl).hostname;
  afterAll(() => local.close());
}
