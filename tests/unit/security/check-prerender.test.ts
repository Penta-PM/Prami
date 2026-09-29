import { describe, expect, it } from 'vitest';

import { staticRoutes } from '../../../scripts/check-prerender';

/** PR-11a QA M-1 회귀: 빌드 결과에 정적 프리렌더 페이지(= CSP nonce 없음)가 생기면 CI 가 실패한다 */
describe('staticRoutes', () => {
  it('허용 목록(/_global-error) 밖의 프리렌더 경로를 돌려준다', () => {
    expect(staticRoutes({ routes: { '/_global-error': {} } })).toEqual([]);
    expect(staticRoutes({ routes: { '/_global-error': {}, '/_not-found': {} } })).toEqual([
      '/_not-found',
    ]);
    expect(staticRoutes({})).toEqual([]);
  });
});
