/**
 * 함수 번들 트레이스 검사 (PRAMI-003 §4.3.9·AC-330 ③). `DB_DRIVER=neon pnpm build` 뒤 실행한다.
 * `<distDir>/server` 아래 모든 `.nft.json`(라우트·페이지 함수 + proxy(middleware)·instrumentation — 함수에 실릴 파일 목록)에
 * `@electric-sql/pglite` 가 있으면 실패(exit 1) — 운영(neon) 번들이 테스트용 인프로세스 DB(wasm 수 MB)를 싣지 않게 한다.
 * proxy·instrumentation 은 PR-2 QA L-2 로 범위에 넣었다. 제외 설정은 next.config.ts(resolveAlias 자리표시 + outputFileTracingExcludes).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = /@electric-sql[+/]pglite/;

/** 반드시 검사해야 하는 트레이스 — 없으면 빌드 산출이 예상과 다르다는 뜻이라 실패한다 */
const REQUIRED_TRACES = ['middleware.js.nft.json', 'instrumentation.js.nft.json'] as const;

export function forbiddenTraceEntries(trace: { files?: string[] }): string[] {
  return (trace.files ?? []).filter((file) => FORBIDDEN.test(file.replaceAll('\\', '/')));
}

/** 필수 트레이스·/api 트레이스가 빠졌으면 그 이유 목록 (relative = serverDir 기준 경로) */
export function missingTraces(relativeTraces: readonly string[]): string[] {
  const normalized = relativeTraces.map((file) => file.replaceAll('\\', '/'));
  return [
    ...REQUIRED_TRACES.filter((name) => !normalized.includes(name)),
    ...(normalized.some((file) => file.startsWith('app/api/')) ? [] : ['app/api/**/*.nft.json']),
  ];
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
  const serverDir = path.join(process.cwd(), distDir, 'server');
  if (!existsSync(serverDir)) {
    console.error(
      `[check-trace] ${serverDir} 가 없습니다 — 먼저 DB_DRIVER=neon pnpm build 를 실행하세요`,
    );
    process.exit(1);
  }
  const traces = walk(serverDir);
  const missing = missingTraces(traces.map((file) => path.relative(serverDir, file)));
  if (missing.length > 0) {
    console.error(`[check-trace] 트레이스 파일이 없습니다: ${missing.join(', ')}`);
    process.exit(1);
  }
  const offending = traces.flatMap((file) => {
    const entries = forbiddenTraceEntries(
      JSON.parse(readFileSync(file, 'utf8')) as { files?: string[] },
    );
    return entries.length > 0
      ? [`${path.relative(process.cwd(), file)} (${entries.length}개)`]
      : [];
  });
  if (offending.length === 0) {
    console.info(
      `[check-trace] 함수 트레이스 ${traces.length}개(proxy·instrumentation 포함)에 @electric-sql/pglite 없음`,
    );
    return;
  }
  console.error(`[check-trace] PGlite 가 함수 번들에 들어갑니다:\n  ${offending.join('\n  ')}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('check-trace')) main();
