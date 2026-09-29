/**
 * 정적 프리렌더 페이지 검사 (PR-11a QA M-1). CSP 는 요청별 nonce 를 쓰므로 빌드 때 HTML 로 굳어진 페이지는
 * 스크립트가 전부 차단된다. `pnpm build` 뒤 `prerender-manifest.json` 에 허용 목록 밖 경로가 있으면 실패(exit 1)한다.
 * - `/_global-error`: Next 가 항상 정적으로 만드는 내부 페이지(루트 레이아웃 자체가 실패할 때만 쓰임, 클라이언트 컴포넌트라
 *   동적으로 바꿀 수 없다). 페이지 오류는 `src/app/error.tsx`(동적 레이아웃 안)가 받는다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ALLOWED_STATIC_ROUTES = new Set(['/_global-error']);

export function staticRoutes(manifest: { routes?: Record<string, unknown> }): string[] {
  return Object.keys(manifest.routes ?? {}).filter((route) => !ALLOWED_STATIC_ROUTES.has(route));
}

function main(): void {
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const file = path.join(process.cwd(), distDir, 'prerender-manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { routes?: Record<string, unknown> };
  const offending = staticRoutes(manifest);
  if (offending.length === 0) {
    console.info(
      `[check-prerender] 정적 프리렌더 페이지 없음 (허용: ${[...ALLOWED_STATIC_ROUTES].join(', ')})`,
    );
    return;
  }
  console.error(
    `[check-prerender] 요청별 CSP nonce 를 받을 수 없는 정적 페이지: ${offending.join(', ')} — 동적 렌더로 바꾸세요`,
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('check-prerender')) main();
