/**
 * 함수 번들 트레이스 검사 (PRAMI-003 §4.3.9·AC-330 ③). `DB_DRIVER=neon pnpm build` 뒤 실행한다.
 * `/api/*` 라우트의 `.nft.json`(함수에 실릴 파일 목록)에 `@electric-sql/pglite` 가 있으면 실패(exit 1) —
 * 운영(neon) 번들이 테스트용 인프로세스 DB(wasm 수 MB)를 싣지 않게 한다. 제외 설정은 next.config.ts `outputFileTracingExcludes`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = /@electric-sql[+/]pglite/;

export function forbiddenTraceEntries(trace: { files?: string[] }): string[] {
  return (trace.files ?? []).filter((file) => FORBIDDEN.test(file.replaceAll('\\', '/')));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith('.nft.json') ? [full] : [];
  });
}

function main(): void {
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const apiDir = path.join(process.cwd(), distDir, 'server', 'app', 'api');
  if (!existsSync(apiDir)) {
    console.error(
      `[check-trace] ${apiDir} 가 없습니다 — 먼저 DB_DRIVER=neon pnpm build 를 실행하세요`,
    );
    process.exit(1);
  }
  const traces = walk(apiDir);
  const offending = traces.flatMap((file) => {
    const entries = forbiddenTraceEntries(
      JSON.parse(readFileSync(file, 'utf8')) as { files?: string[] },
    );
    return entries.length > 0
      ? [`${path.relative(process.cwd(), file)} (${entries.length}개)`]
      : [];
  });
  if (traces.length === 0) {
    console.error('[check-trace] /api 트레이스 파일(.nft.json)이 없습니다');
    process.exit(1);
  }
  if (offending.length === 0) {
    console.info(`[check-trace] /api 함수 ${traces.length}개 트레이스에 @electric-sql/pglite 없음`);
    return;
  }
  console.error(`[check-trace] PGlite 가 함수 번들에 들어갑니다:\n  ${offending.join('\n  ')}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('check-trace')) main();
