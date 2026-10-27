/**
 * `pnpm procurement:import (--csv <디렉터리> | --source-db [--source-schema public]) [--replace] [--dry-run] [--target-host <호스트>]`
 * — 조달이 데이터를 Prami procurement 스키마(0012)로 옮긴다 (조달이 통합 DB-3).
 * - 원본: `--csv` = `<표>.csv` 8개 디렉터리(UTF-8 BOM·bool `t/f`·배열 `{..}`·빈 칸 → NULL),
 *   `--source-db` = 환경변수 `PROCUREMENT_SOURCE_URL` 의 원본 Postgres(읽기 전용 REPEATABLE READ 트랜잭션, 접속 문자열을 인자로 받지 않음 — 프로세스 목록 노출 방지)
 * - 대상: DATABASE_URL(DB_DRIVER). 원격 DB(neon·로컬 목록 밖 호스트)면 `--target-host` 가 실제 연결 호스트와 같아야 실행 (§4.3.4 ②)
 * - 한 트랜잭션: items → item_changes → deliveries → delivery_changes → bid_notices → bid_keywords → job_runs → app_state, 끝에 setval
 * - 대상이 비어 있지 않으면 거부. `--replace` 만 TRUNCATE … RESTART IDENTITY CASCADE 후 재적재. `--dry-run` 은 건수·형식 확인만(쓰지 않음)
 * 출력은 표별 건수만(금액·이름 없음). 검증은 `pnpm data:verify --stage procurement --source-csv <디렉터리>`.
 */
import { loadEnvConfig } from '@next/env';

import { parseSourceArgs, type SourceArgs } from '../src/server/procurement/transfer/source';

export type ProcurementImportArgs = {
  source: Exclude<SourceArgs, { kind: 'none' }>;
  replace: boolean;
  dryRun: boolean;
  targetHost: string | undefined;
};

export function parseProcurementImportArgs(
  args: string[],
  env: Record<string, string | undefined>,
): ProcurementImportArgs {
  const source = parseSourceArgs(args, env, { csv: '--csv', db: '--source-db' });
  if (source.kind === 'none') {
    throw new Error(
      '원본을 지정하세요: --csv <디렉터리> 또는 --source-db (PROCUREMENT_SOURCE_URL)',
    );
  }
  const index = args.indexOf('--target-host');
  return {
    source,
    replace: args.includes('--replace'),
    dryRun: args.includes('--dry-run'),
    targetHost: index >= 0 ? args[index + 1] : undefined,
  };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = parseProcurementImportArgs(process.argv.slice(2), process.env);
  const { targetHostViolation, TARGET_HOST_MESSAGES } = await import('../src/lib/db-host');
  const violation = targetHostViolation(process.env, args.targetHost);
  if (violation) throw new Error(TARGET_HOST_MESSAGES[violation]);

  const [{ readSource }, { importProcurement, formatImportResult }] = await Promise.all([
    import('../src/server/procurement/transfer/source'),
    import('../src/server/procurement/transfer/load'),
  ]);
  const data = await readSource(args.source);
  if (!data) throw new Error('원본을 읽지 못했습니다');

  const [{ createDb }, { withTransaction }] = await Promise.all([
    import('../src/db'),
    import('../src/db/tx'),
  ]);
  const handle = await createDb();
  try {
    const result = await withTransaction(
      (tx) => importProcurement(tx, data, { replace: args.replace, dryRun: args.dryRun }),
      handle,
      args.dryRun ? { accessMode: 'read only' } : undefined,
    );
    console.log(
      `[procurement:import] source=${args.source.kind} driver=${handle.driver}${args.dryRun ? ' dry-run' : ''}${args.replace ? ' replace' : ''}`,
    );
    console.log(formatImportResult(result));
  } finally {
    await handle.close();
  }
}

if (
  process.argv[1] &&
  process.argv[1].replaceAll('\\', '/').endsWith('scripts/procurement-import.ts')
) {
  main().catch(async (error: unknown) => {
    const { safeErrorMessage } = await import('../src/server/procurement/transfer/errors');
    console.error('[procurement:import] 실패:', safeErrorMessage(error));
    process.exitCode = 1;
  });
}
