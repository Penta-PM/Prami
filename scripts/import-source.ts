/**
 * `pnpm import:source [파일경로]` — 판매단가 엑셀을 업로드·적용 경로 그대로 반영한다 (로컬·QA 데이터 준비용).
 * 화면의 "가격정책 적용"과 같은 코드(uploadImport → applyPolicy)를 쓰고 감사 로그 actor 는 `script` 로 남는다.
 * 같은 파일이 이미 업로드돼 있으면 그 배치를 재사용한다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

const DEFAULT_SOURCE = 'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/병합_가격_raw.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const file = process.argv[2] ?? process.env.SOURCE_XLSX ?? DEFAULT_SOURCE;
  const [{ createDb }, { uploadImport }, { applyPolicy }] = await Promise.all([
    import('../src/db'),
    import('../src/server/imports/upload'),
    import('../src/server/imports/apply-policy'),
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
        kind: 'sales',
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
