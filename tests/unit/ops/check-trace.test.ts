import { describe, expect, it } from 'vitest';

import {
  bundledPgliteFiles,
  forbiddenTraceEntries,
  missingTraces,
} from '../../../scripts/check-trace';

/** AC-330 ③: 함수 트레이스(.nft.json)에서 PGlite 파일을 찾는다 — 실제 neon 빌드 검사는 `pnpm check:trace` */
describe('forbiddenTraceEntries', () => {
  it('pnpm 저장소·직접 경로·Windows 구분자 모두 잡고, 외부 모듈 스텁 청크는 무시한다', () => {
    const files = [
      '../../../../node_modules/.pnpm/@electric-sql+pglite@0.5.8/node_modules/@electric-sql/pglite/dist/postgres.wasm',
      ['..', '..', 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js'].join('\\'),
      '../../../chunks/[externals]_@electric-sql_pglite_0ys0q8k._.js',
      '../../../../node_modules/pg/lib/index.js',
    ];
    expect(forbiddenTraceEntries({ files })).toEqual(files.slice(0, 2));
    expect(forbiddenTraceEntries({})).toEqual([]);
  });
});

describe('missingTraces (QA L-2: proxy·instrumentation 도 검사 범위)', () => {
  it('middleware·instrumentation·/api 트레이스가 모두 있어야 한다', () => {
    const complete = [
      'middleware.js.nft.json',
      'instrumentation.js.nft.json',
      ['app', 'api', 'health', 'route.js.nft.json'].join('\\'),
      'app/(app)/page.js.nft.json',
    ];
    expect(missingTraces(complete)).toEqual([]);
    expect(missingTraces(complete.slice(1))).toEqual(['middleware.js.nft.json']);
    expect(missingTraces(['middleware.js.nft.json'])).toEqual([
      'instrumentation.js.nft.json',
      'app/api/**/*.nft.json',
    ]);
  });
});

describe('bundledPgliteFiles (PR-2b QA L-N2: 트레이스 밖 번들 모드 회귀)', () => {
  it('server 아래 wasm·data·확장 tar.gz·PGlite 모듈 청크를 잡고, 자리표시 청크·일반 청크는 무시한다', () => {
    const bundled = [
      'chunks/qa/pglite.wasm',
      ['chunks', 'ssr', 'initdb.0a1b2c.wasm'].join('\\'),
      'chunks/4f9e1d.data',
      'chunks/pg_trgm.tar.gz',
      'chunks/ssr/node_modules_@electric-sql_pglite_dist_index_0q1w2e._.js',
      'chunks/node_modules_.pnpm_@electric-sql+pglite@0.5.8_xyz._.js',
      // PR #24 QA I-6: 이름 규칙 밖이던 형태
      'chunks/node_modules_@electric-sql_pglite_dist_index_0q1w2e._.mjs',
      'chunks/electric-sql-pglite_worker.cjs',
      'chunks/pg_trgm.tgz',
    ];
    const allowed = [
      'chunks/src_db_pglite-unavailable_ts_0abc._.js',
      'chunks/src_db_pglite-unavailable_ts_0abc._.js.map',
      'chunks/[root-of-the-server]__0td1-qw._.js',
      'app/api/health/route.js.nft.json',
      'middleware.js',
    ];
    expect(bundledPgliteFiles([...allowed, ...bundled])).toEqual(bundled);
    expect(bundledPgliteFiles(allowed)).toEqual([]);
  });
});
