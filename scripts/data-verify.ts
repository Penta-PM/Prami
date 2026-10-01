/**
 * `pnpm data:verify [--target local|preview|production] [--target-host <호스트>] [--stage schema|data] [--fresh] [--allow-part-mappings]`
 * — 클린 설치·운영 데이터 자동 검증 (PRAMI-003 §4.9.2). 읽기 전용: 모든 조회를 READ ONLY 트랜잭션 안에서 SELECT 로만 한다.
 * - `--target preview|production`: `--target-host` 가 실제 연결 호스트와 같아야 실행(오타·엉뚱한 셸 env 방지)
 * - `--target local`(기본): 원격 DB(neon·로컬 목록 밖)면 import:source 와 같은 규칙으로 `--target-host` 필요
 * - `--fresh`: 클린 설치 직후용 — 시연·업무 데이터 0, fixture 0, seed 감사 0, 적용 배치 종류별 1
 * - `--baseline <json>`: 기준값 파일(테스트·리허설용 축소 픽스처). 없으면 src/server/ops/data-baseline.ts(r3 원본 기준)
 * 출력은 항목·기대·실측·판정 표(개수만). exit 0 = 통과, 1 = 실패, 2 = 원본 SHA-256 이 기준과 다름(실측만 출력).
 */
import { readFileSync } from 'node:fs';

import { loadEnvConfig } from '@next/env';

const TARGETS = ['local', 'preview', 'production'] as const;
type Target = (typeof TARGETS)[number];

export type DataVerifyArgs = {
  target: Target;
  targetHost: string | undefined;
  stage: 'schema' | 'data';
  fresh: boolean;
  allowPartMappings: boolean;
  baselinePath: string | undefined;
};

export function parseDataVerifyArgs(args: string[]): DataVerifyArgs {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const target = option('--target') ?? 'local';
  if (!(TARGETS as readonly string[]).includes(target)) {
    throw new Error(`--target 는 ${TARGETS.join('|')} 중 하나입니다`);
  }
  const stage = option('--stage') ?? 'data';
  if (stage !== 'schema' && stage !== 'data')
    throw new Error('--stage 는 schema|data 중 하나입니다');
  return {
    target: target as Target,
    targetHost: option('--target-host'),
    stage,
    fresh: args.includes('--fresh'),
    allowPartMappings: args.includes('--allow-part-mappings'),
    baselinePath: option('--baseline'),
  };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = parseDataVerifyArgs(process.argv.slice(2));
  const { dbHostOf, targetHostViolation, TARGET_HOST_MESSAGES } =
    await import('../src/lib/db-host');
  if (args.target !== 'local') {
    const host = dbHostOf(process.env.DATABASE_URL);
    if (!args.targetHost?.trim()) throw new Error(TARGET_HOST_MESSAGES.missing);
    if (args.targetHost.trim().toLowerCase() !== host)
      throw new Error(TARGET_HOST_MESSAGES.mismatch);
  } else {
    const violation = targetHostViolation(process.env, args.targetHost);
    if (violation) throw new Error(TARGET_HOST_MESSAGES[violation]);
  }

  const [{ createDb }, { withTransaction }, { env }, { verifyData, formatReport }] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/tx'),
      import('../src/env'),
      import('../src/server/ops/data-verify'),
    ]);
  const handle = await createDb();
  try {
    const report = await withTransaction(
      (tx) =>
        verifyData(tx, {
          stage: args.stage,
          fresh: args.fresh,
          allowPartMappings: args.allowPartMappings,
          requireAdmin: args.target !== 'local',
          allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
          ...(args.baselinePath
            ? { baseline: JSON.parse(readFileSync(args.baselinePath, 'utf8')) }
            : {}),
        }),
      handle,
      { accessMode: 'read only' },
    );
    console.log(
      `[data:verify] target=${args.target} driver=${handle.driver} stage=${args.stage}${args.fresh ? ' fresh' : ''}`,
    );
    console.log(formatReport(report));
    process.exitCode = report.exitCode;
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/data-verify.ts')) {
  main().catch((error: unknown) => {
    console.error('[data:verify] 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
