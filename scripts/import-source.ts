/**
 * `pnpm import:source [파일경로] [--kind sales|costs]` — 판매단가/원가 엑셀을 업로드·적용 경로 그대로 반영한다
 * (로컬·QA 데이터 준비용). 원가는 `--kind costs` (기본 원본: `원자재코드 정보_260825.xlsx`).
 * 화면의 "가격정책 적용"과 같은 코드(uploadImport → applyPolicy)를 쓰고 감사 로그 actor 는 `script` 로 남는다.
 * 같은 파일이 이미 업로드돼 있으면 그 배치를 재사용한다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

const INPUT_DIR = 'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001';
const DEFAULT_SOURCE: Record<'sales' | 'costs', string> = {
  sales: `${INPUT_DIR}/병합_가격_raw.xlsx`,
  costs: `${INPUT_DIR}/원자재코드 정보_260825.xlsx`,
};
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const kindIndex = args.indexOf('--kind');
  const kind = kindIndex >= 0 && args[kindIndex + 1] === 'costs' ? 'costs' : 'sales';
  // --kind 가 없으면 kindIndex = -1 이라 index 0(파일 경로)을 지우면 안 된다 (CI E2E globalSetup 회귀)
  const positional = args.filter(
    (arg, index) => arg !== '--kind' && !(kindIndex >= 0 && index === kindIndex + 1),
  );
  const file = positional[0] ?? process.env.SOURCE_XLSX ?? DEFAULT_SOURCE[kind];
  const [{ createDb }, { uploadImport }] = await Promise.all([
    import('../src/db'),
    import('../src/server/imports/upload'),
  ]);
  const handle = await createDb();
  const ctx = {
    handle,
    actor: { id: null, label: 'script' },
    meta: { ip: null, userAgent: 'import-source' },
  };
  try {
    let batchId: string;
    let reused = false;
    try {
      const upload = await uploadImport(ctx, {
        kind,
        fileName: path.basename(file),
        mimeType: XLSX_MIME,
        bytes: readFileSync(file),
      });
      if (upload.status !== 'parsed' || upload.errorCount > 0) {
        throw new Error(
          `검증 실패: ${upload.errors
            .slice(0, 5)
            .map((e) => `${e.row}행 ${e.column} ${e.message}`)
            .join('; ')}`,
        );
      }
      batchId = upload.batchId;
    } catch (error) {
      const existing = (error as { details?: { existingBatchId?: string } }).details
        ?.existingBatchId;
      if (!existing) throw error;
      batchId = existing;
      reused = true;
    }
    if (kind === 'costs') {
      const [{ applyCostImport }, { costAccessForTests }] = await Promise.all([
        import('../src/server/cost/apply-costs'),
        import('../src/server/cost/access-token'),
      ]);
      const access = costAccessForTests({ id: null, email: 'script' });
      const { stats, warnings } = await applyCostImport(
        { handle, access, meta: ctx.meta },
        { batchId, reused },
      );
      console.log(
        `[import:source] 같은 날짜 중복 ${warnings.sameDateDuplicates.length}그룹 (값 다름 ${warnings.conflictingDuplicates.length})`,
      );
      console.log(`[import:source] costs ${path.basename(file)} batch=${batchId}`);
      console.log(`[import:source] stats ${JSON.stringify(stats)}`);
      return;
    }
    const { applyPolicy } = await import('../src/server/imports/apply-policy');
    const { runId, stats } = await applyPolicy(ctx, {
      salesBatchId: batchId,
      itemBatchId: null,
      salesReused: reused,
      itemReused: false,
    });
    console.log(`[import:source] ${path.basename(file)} batch=${batchId} run=${runId}`);
    console.log(`[import:source] stats ${JSON.stringify(stats)}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[import:source] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
