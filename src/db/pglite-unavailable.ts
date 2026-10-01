/**
 * 운영(neon) 빌드에서 `@electric-sql/pglite`(와 contrib 확장) 대신 연결되는 자리표시 모듈 (PRAMI-003 §4.3.9, PR-2 QA L-2).
 * next.config.ts 가 DB_DRIVER=neon 빌드에서만 turbopack.resolveAlias 로 바꿔 끼운다 — proxy·instrumentation 을 포함한
 * 모든 함수 트레이스에서 PGlite wasm·확장 tar 가 빠진다. drizzle-orm/pglite 가 정적으로 가져오는 이름(PGlite·types)과
 * src/db/index.ts 가 가져오는 확장 이름만 내보내며, neon 빌드를 DB_DRIVER=pglite 로 띄우면 PGlite 생성에서 바로 실패한다.
 */
const UNAVAILABLE =
  'PGlite 는 DB_DRIVER=neon 빌드에 포함되지 않습니다 — 인프로세스 DB 가 필요하면 DB_DRIVER=pglite 로 다시 빌드하세요';

export class PGlite {
  constructor() {
    throw new Error(UNAVAILABLE);
  }
}

/** drizzle-orm/pglite 가 타입 파서 키로만 쓰는 OID (값은 PGlite 와 같다) */
export const types = { DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184, INTERVAL: 1186 } as const;

export const pg_trgm = undefined;
export const citext = undefined;
export const pgcrypto = undefined;
