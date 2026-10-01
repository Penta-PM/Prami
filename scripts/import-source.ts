/**
 * `pnpm import:source <파일…> [--kind sales|costs|items] [--merge merge|replace]` — 엑셀을 화면과 같은 업로드·적용 경로로
 * 반영한다(로컬·QA 데이터 준비용). 감사 로그 actor 는 `script`. 같은 파일(묶음)이 이미 업로드돼 있으면 그 배치를 재사용한다.
 * - sales(기본): 판매단가 파일 1개 → 적용(품목조회 없음)
 * - costs: 원가 파일 1개 → 원가 적용
 * - items: 품목조회 파일 1~5개 → 배치 1개 → **현재 적용 중인 판매단가 배치 재사용** + 품목 새 업로드로 적용 (PRAMI-003 §4.2.8).
 *   직전 품목에 있던 제품군이 빠지면 `--merge`(기본 merge = 누락 제품군 유지, replace = 전량 교체)
 * 파일 경로는 필수다 — 로컬 하드코딩 기본 경로는 없다 (PRAMI-003 §4.3.4 ①).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const KINDS = ['sales', 'costs', 'items'] as const;
type Kind = (typeof KINDS)[number];

type Ctx = {
  handle: Awaited<ReturnType<typeof import('../src/db').createDb>>;
  actor: { id: null; label: string };
  meta: { ip: null; userAgent: string };
};

function parseArgs(args: string[]) {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const kindArg = option('--kind') ?? 'sales';
  if (!(KINDS as readonly string[]).includes(kindArg)) {
    throw new Error(`--kind 는 ${KINDS.join('|')} 중 하나입니다`);
  }
  const merge = option('--merge');
  if (merge !== undefined && merge !== 'merge' && merge !== 'replace') {
    throw new Error('--merge 는 merge|replace 중 하나입니다');
  }
  // 옵션 값 위치(--kind 다음, --merge 다음)는 파일 경로가 아니다 (CI E2E globalSetup 회귀 방지)
  const valueIndexes = new Set(
    ['--kind', '--merge']
      .map((name) => args.indexOf(name))
      .filter((i) => i >= 0)
      .map((i) => i + 1),
  );
  const files = args.filter((arg, index) => !arg.startsWith('--') && !valueIndexes.has(index));
  if (files.length === 0)
    throw new Error('파일 경로를 지정하세요 (예: pnpm import:source <파일.xlsx>)');
  return { kind: kindArg as Kind, files, merge: merge as 'merge' | 'replace' | undefined };
}

function existingBatchId(error: unknown): string | null {
  return (error as { details?: { existingBatchId?: string } }).details?.existingBatchId ?? null;
}

function assertParsed(upload: {
  status: string;
  errorCount: number;
  errors: { row: number; column: string; message: string; file?: string }[];
}) {
  if (upload.status === 'parsed' && upload.errorCount === 0) return;
  const head = upload.errors
    .slice(0, 5)
    .map((e) => `${e.file ? `${e.file} ` : ''}${e.row}행 ${e.column} ${e.message}`)
    .join('; ');
  throw new Error(`검증 실패: ${head}`);
}

async function uploadOrReuse(ctx: Ctx, kind: Kind, files: string[]) {
  const inputs = files.map((file) => ({
    fileName: path.basename(file),
    mimeType: XLSX_MIME,
    bytes: readFileSync(file),
  }));
  try {
    if (kind === 'items') {
      const { uploadItemFiles } = await import('../src/server/imports/item-upload');
      const upload = await uploadItemFiles(ctx, inputs);
      assertParsed(upload);
      return { batchId: upload.batchId, reused: false };
    }
    const { uploadImport } = await import('../src/server/imports/upload');
    const upload = await uploadImport(ctx, { kind, ...inputs[0]! });
    assertParsed(upload);
    return { batchId: upload.batchId, reused: false };
  } catch (error) {
    const existing = existingBatchId(error);
    if (!existing) throw error;
    return { batchId: existing, reused: true };
  }
}

async function applyCosts(ctx: Ctx, batchId: string, reused: boolean) {
  const [{ applyCostImport }, { costAccessForTests }] = await Promise.all([
    import('../src/server/cost/apply-costs'),
    import('../src/server/cost/access-token'),
  ]);
  const access = costAccessForTests({ id: null, email: 'script' });
  const { stats, warnings } = await applyCostImport(
    { handle: ctx.handle, access, meta: ctx.meta },
    { batchId, reused },
  );
  console.log(
    `[import:source] 같은 날짜 중복 ${warnings.sameDateDuplicates.length}그룹 (값 다름 ${warnings.conflictingDuplicates.length})`,
  );
  return stats;
}

async function currentSalesBatchId(ctx: Ctx): Promise<string> {
  const { getCurrentApply } = await import('../src/server/imports/queries');
  const current = await getCurrentApply(ctx.handle.db);
  if (!current?.sales)
    throw new Error('적용 중인 판매단가 배치가 없습니다 — 판매단가를 먼저 적용하세요');
  return current.sales.id;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { kind, files, merge } = parseArgs(process.argv.slice(2));
  const { createDb } = await import('../src/db');
  const handle = await createDb();
  const ctx: Ctx = {
    handle,
    actor: { id: null, label: 'script' },
    meta: { ip: null, userAgent: 'import-source' },
  };
  try {
    const { batchId, reused } = await uploadOrReuse(ctx, kind, files);
    if (kind === 'costs') {
      const stats = await applyCosts(ctx, batchId, reused);
      console.log(`[import:source] costs batch=${batchId} stats ${JSON.stringify(stats)}`);
      return;
    }
    const { applyPolicy } = await import('../src/server/imports/apply-policy');
    const input =
      kind === 'items'
        ? {
            salesBatchId: await currentSalesBatchId(ctx),
            itemBatchId: batchId,
            salesReused: true,
            itemReused: reused,
            ...(merge ? { itemMerge: merge } : {}),
          }
        : { salesBatchId: batchId, itemBatchId: null, salesReused: reused, itemReused: false };
    const { runId, stats } = await applyPolicy(ctx, input);
    console.log(
      `[import:source] ${kind} ${files.map((f) => path.basename(f)).join(', ')} batch=${batchId} run=${runId}`,
    );
    console.log(`[import:source] stats ${JSON.stringify(stats)}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[import:source] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
