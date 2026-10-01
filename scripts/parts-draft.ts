/**
 * `pnpm parts:draft --out <저장소 밖 폴더> [--target-host <호스트>]` — 파츠 매핑 초안 xlsx (PRAMI-003 §4.9.5, AC-336).
 * 현재 DB 의 master 품목(규격)만 읽는다(READ ONLY 트랜잭션, DB 변경 0). 출력 `parts-draft-<YYYYMMDD>.xlsx`:
 * 시트 1 = `/admin/parts` 엑셀 등록 형식 2컬럼(모델품번·파츠품번), 시트 2 = 검수용, 시트 3 = 근거 없음 파츠.
 * 콘솔에는 대분류별 쌍 수만 출력한다(품명 없음). 자동 적재는 하지 않는다 — 관리자가 검수 후 화면에서 등록.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import writeXlsxFile, { type Cell } from 'write-excel-file/node';

export function parsePartsDraftArgs(args: string[]) {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = option('--out');
  if (!out) throw new Error('--out <저장소 밖 폴더> 를 지정하세요');
  return { out: path.resolve(out), targetHost: option('--target-host') };
}

/** 초안에는 품명·규격이 있어 저장소 안에 두지 않는다 (§4.9.5 "저장소 밖 경로") */
export function isInsideRepo(dir: string, root: string = process.cwd()): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(dir));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const stamp = (date: Date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { out, targetHost } = parsePartsDraftArgs(process.argv.slice(2));
  if (isInsideRepo(out))
    throw new Error('--out 은 저장소 밖 폴더여야 합니다 (초안에 품명·규격이 있음)');
  const { targetHostViolation, TARGET_HOST_MESSAGES } = await import('../src/lib/db-host');
  const violation = targetHostViolation(process.env, targetHost);
  if (violation) throw new Error(TARGET_HOST_MESSAGES[violation]);

  const [{ createDb }, { withTransaction }, { buildPartsDraft, draftSheets, loadDraftItems }] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/tx'),
      import('../src/server/ops/parts-draft'),
    ]);
  const handle = await createDb();
  try {
    const items = await withTransaction((tx) => loadDraftItems(tx), handle, {
      accessMode: 'read only',
    });
    const draft = buildPartsDraft(items);
    const sheets = draftSheets(draft);
    const toData = (rows: string[][]) => rows.map((row) => row.map((value) => value as Cell));
    mkdirSync(out, { recursive: true });
    const file = path.join(out, `parts-draft-${stamp(new Date())}.xlsx`);
    await writeXlsxFile([
      { data: toData(sheets.mapping), sheet: '매핑 등록' },
      { data: toData(sheets.review), sheet: '검수' },
      { data: toData(sheets.noEvidence), sheet: '근거 없음' },
    ]).toFile(file);
    for (const [major, count] of Object.entries(draft.perMajor).sort()) {
      console.log(`[parts:draft] ${major} ${count}쌍`);
    }
    console.log(
      `[parts:draft] 합계 ${draft.pairs.length}쌍 · 근거 없음 ${draft.noEvidence.length}건 → ${file}`,
    );
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/parts-draft.ts')) {
  main().catch((error: unknown) => {
    console.error('[parts:draft] 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
