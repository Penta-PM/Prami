import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { DbHandle } from '@/db';
import type { ImportKind } from '@/server/imports/kinds';
import { readWorkbook } from '@/server/imports/parse-xlsx';
import { uploadImport } from '@/server/imports/upload';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/imports');
export const TEST_ACTOR = { id: null, label: 'vitest' };
export const TEST_META = { ip: null, userAgent: 'vitest' };

export function fixtureBytes(name: string): Buffer {
  return readFileSync(path.join(FIXTURE_DIR, name));
}

export async function fixtureSheets(name: string) {
  return readWorkbook(fixtureBytes(name));
}

/** 픽스처 파일을 업로드 경로 그대로 통과시킨다 (배치 + 스테이징) */
export async function uploadFixture(
  handle: DbHandle,
  kind: ImportKind,
  name: string,
  bytes: Buffer = fixtureBytes(name),
) {
  return uploadImport(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { kind, fileName: name, mimeType: XLSX_MIME, bytes },
  );
}
