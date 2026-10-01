import { describe, expect, it } from 'vitest';

import { forbiddenTraceEntries } from '../../../scripts/check-trace';

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
