/**
 * `pnpm data:verify [--target local|preview|production] [--target-host <호스트>] [--stage schema|data] [--fresh] [--allow-part-mappings]`
 * — 클린 설치·운영 데이터 자동 검증 (PRAMI-003 §4.9.2). 읽기 전용: 모든 조회를 READ ONLY 트랜잭션 안에서 SELECT 로만 한다.
 * - `--target preview|production`: `--target-host` 가 실제 연결 호스트와 같아야 실행(오타·엉뚱한 셸 env 방지)
 * - `--target local`(기본): 원격 DB(neon·로컬 목록 밖)면 import:source 와 같은 규칙으로 `--target-host` 필요
 * - `--fresh`: 클린 설치 직후용 — 시연·업무 데이터 0, fixture 0, seed 감사 0, 적용 배치 종류별 1
 * - `--baseline <json>`: 기준값 파일(테스트·리허설용 축소 픽스처) — 로컬 DB 에서만. 없으면 src/server/ops/data-baseline.ts(r3 원본 기준)
 * - 활성 ADMIN 검사: preview·production 이거나 연결 대상이 원격 DB 면 사용자 0명도 FAIL (로컬 클린 설치만 SKIP)
 * 출력은 항목·기대·실측·판정 표(개수만). exit 0 = 통과, 1 = 실패, 2 = 원본 SHA-256 이 기준과 다름(실측만 출력).
 * - `--stage procurement [--source-csv <디렉터리> | --source-db [--source-schema public]] [--show-amounts]`: 조달이 이관 검증(DB-3) —
 *   테이블·뷰 건수, (status, product) 분포, 연도별 금액 합계, 최대 id·시퀀스, 정렬 해시를 실행 시 원본에서 계산해 대조한다.
 *   `--source-db` 는 환경변수 PROCUREMENT_SOURCE_URL. 원본을 주지 않으면 실측만. 금액은 일치 여부만 — 숫자는 `--show-amounts` 일 때만
 */
import { readFileSync } from 'node:fs';

import { loadEnvConfig } from '@next/env';

import { parseSourceArgs, type SourceArgs } from '../src/server/procurement/transfer/source';

import {
  dbHostOf,
  isRemoteDbTarget,
  TARGET_HOST_MESSAGES,
  targetHostViolation,
} from '../src/lib/db-host';

const TARGETS = ['local', 'preview', 'production'] as const;
type Target = (typeof TARGETS)[number];

export type DataVerifyArgs = {
  target: Target;
  targetHost: string | undefined;
  stage: 'schema' | 'data' | 'procurement';
  fresh: boolean;
  allowPartMappings: boolean;
  baselinePath: string | undefined;
  /** stage procurement 의 대조 원본 */
  procurementSource: SourceArgs;
  showAmounts: boolean;
};

export function parseDataVerifyArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): DataVerifyArgs {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const target = option('--target') ?? 'local';
  if (!(TARGETS as readonly string[]).includes(target)) {
    throw new Error(`--target 는 ${TARGETS.join('|')} 중 하나입니다`);
  }
  const stage = option('--stage') ?? 'data';
  if (stage !== 'schema' && stage !== 'data' && stage !== 'procurement')
    throw new Error('--stage 는 schema|data|procurement 중 하나입니다');
  const procurementSource = parseSourceArgs(args, env, { csv: '--source-csv', db: '--source-db' });
  if (
    stage !== 'procurement' &&
    (procurementSource.kind !== 'none' || args.includes('--show-amounts'))
  ) {
    throw new Error('--source-csv·--source-db·--show-amounts 는 --stage procurement 에서만 씁니다');
  }
  return {
    target: target as Target,
    targetHost: option('--target-host'),
    stage,
    fresh: args.includes('--fresh'),
    allowPartMappings: args.includes('--allow-part-mappings'),
    baselinePath: option('--baseline'),
    procurementSource,
    showAmounts: args.includes('--show-amounts'),
  };
}

/**
 * 실행 전 대상 확인 (DB 연결 전). 위반이면 throw. 반환: 활성 ADMIN 검사를 강제할지(사용자 0명 SKIP 금지).
 * 원격 DB 는 `--target local` 로 돌려도 ADMIN 검사를 강제하고 `--baseline` 을 거부한다 (PR-2 QA L-5).
 */
export function resolveDataVerifyGuard(
  args: DataVerifyArgs,
  source: Record<string, string | undefined>,
): { requireAdmin: boolean } {
  const remote = args.target !== 'local' || isRemoteDbTarget(source);
  if (args.target !== 'local') {
    if (!args.targetHost?.trim()) throw new Error(TARGET_HOST_MESSAGES.missing);
    if (args.targetHost.trim().toLowerCase() !== dbHostOf(source.DATABASE_URL))
      throw new Error(TARGET_HOST_MESSAGES.mismatch);
  } else {
    const violation = targetHostViolation(source, args.targetHost);
    if (violation) throw new Error(TARGET_HOST_MESSAGES[violation]);
  }
  if (remote && args.baselinePath) {
    throw new Error(
      '--baseline 은 로컬 DB 에서만 쓸 수 있습니다 (원격·운영 대상은 기본 기준값으로 검증)',
    );
  }
  return { requireAdmin: remote };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = parseDataVerifyArgs(process.argv.slice(2), process.env);
  const { requireAdmin } = resolveDataVerifyGuard(args, process.env);
  const { stage } = args;
  if (stage === 'procurement') {
    await verifyProcurementStage(args);
    return;
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
          stage,
          fresh: args.fresh,
          allowPartMappings: args.allowPartMappings,
          requireAdmin,
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

/** 조달이 이관 검증 (DB-3) — 원본은 트랜잭션 밖에서 먼저 읽고(원본 DB 는 자체 READ ONLY 트랜잭션), 대상은 READ ONLY 트랜잭션 */
async function verifyProcurementStage(args: DataVerifyArgs): Promise<void> {
  const [
    { createDb },
    { withTransaction },
    { readSource },
    { verifyProcurement },
    { formatReport },
  ] = await Promise.all([
    import('../src/db'),
    import('../src/db/tx'),
    import('../src/server/procurement/transfer/source'),
    import('../src/server/procurement/transfer/verify'),
    import('../src/server/ops/data-verify'),
  ]);
  const source = await readSource(args.procurementSource);
  const handle = await createDb();
  try {
    const report = await withTransaction(
      (tx) => verifyProcurement(tx, { source, showAmounts: args.showAmounts }),
      handle,
      { accessMode: 'read only' },
    );
    console.log(
      `[data:verify] target=${args.target} driver=${handle.driver} stage=procurement source=${args.procurementSource.kind}${args.showAmounts ? ' show-amounts' : ''}`,
    );
    console.log(formatReport(report));
    process.exitCode = report.exitCode;
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/data-verify.ts')) {
  main().catch(async (error: unknown) => {
    // 조달 단계 원본 값이 오류 메시지(Drizzle "Failed query … params")로 새지 않게 값을 가린다
    const { safeErrorMessage } = await import('../src/server/procurement/transfer/errors');
    const procurement = process.argv.includes('procurement');
    console.error(
      '[data:verify] 실패:',
      procurement ? safeErrorMessage(error) : error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
