/**
 * 함수 번들 트레이스 검사 (PRAMI-003 §4.3.9·AC-330 ③). `DB_DRIVER=neon pnpm build` 뒤 실행한다.
 * `<distDir>/server` 아래 모든 `.nft.json`(라우트·페이지 함수 + proxy(middleware)·instrumentation — 함수에 실릴 파일 목록)에
 * `@electric-sql/pglite` 가 있으면 실패(exit 1) — 운영(neon) 번들이 테스트용 인프로세스 DB(wasm 수 MB)를 싣지 않게 한다.
 * proxy·instrumentation 은 PR-2 QA L-2 로 범위에 넣었다. 제외 설정은 next.config.ts(resolveAlias 자리표시 + outputFileTracingExcludes).
 * 트레이스 밖 "번들 모드" 회귀(resolveAlias 가 빠져 PGlite 가 청크 안에 묶이고 wasm·data 가 server 아래로 복사됨)도 실패로 본다 (PR-2b QA L-N2).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = /@electric-sql[+/]pglite/;

/** 반드시 검사해야 하는 트레이스 — 없으면 빌드 산출이 예상과 다르다는 뜻이라 실패한다 */
const REQUIRED_TRACES = ['middleware.js.nft.json', 'instrumentation.js.nft.json'] as const;

export function forbiddenTraceEntries(trace: { files?: string[] }): string[] {
  return (trace.files ?? []).filter((file) => FORBIDDEN.test(file.replaceAll('\\', '/')));
}

/**
 * server 아래에 번들로 들어간 PGlite 산출물 (relative = serverDir 기준 경로).
 * - `.wasm`·`.data`(Emscripten 파일 시스템 이미지)·확장 `.tar.gz`: neon 빌드의 서버 산출에는 하나도 없어야 한다 — 이름이 해시로 바뀌어도 잡도록 확장자로 본다
 * - 청크 이름에 `@electric-sql/pglite` 모듈 경로가 든 JS (자리표시 `src_db_pglite-unavailable_ts_*` 는 제외)
 */
export function bundledPgliteFiles(relativeFiles: readonly string[]): string[] {
  return relativeFiles.filter((file) => {
    const name = path.posix.basename(file.replaceAll('\\', '/'));
    // PR #24 QA I-6: `.tgz`, `.mjs`·`.cjs` 청크, 하이픈 표기(`electric-sql-pglite`)도 잡는다
    if (/\.(wasm|data|tgz)$|\.tar\.gz$/i.test(name)) return true;
    return /\.[cm]?js$/i.test(name) && /electric-sql[_+-]pglite/i.test(name);
  });
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
    return statSync(full).isDirectory() ? walk(full) : [full];
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
  const files = walk(serverDir);
  const bundled = bundledPgliteFiles(files.map((file) => path.relative(serverDir, file)));
  if (bundled.length > 0) {
    console.error(
      `[check-trace] PGlite 산출물이 서버 번들에 들어갔습니다 (next.config.ts resolveAlias 확인):\n  ${bundled.join('\n  ')}`,
    );
    process.exit(1);
  }
  const traces = files.filter((file) => file.endsWith('.nft.json'));
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
      `[check-trace] 함수 트레이스 ${traces.length}개(proxy·instrumentation 포함)·서버 산출 ${files.length}개에 @electric-sql/pglite 없음`,
    );
    return;
  }
  console.error(`[check-trace] PGlite 가 함수 번들에 들어갑니다:\n  ${offending.join('\n  ')}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('check-trace')) main();
