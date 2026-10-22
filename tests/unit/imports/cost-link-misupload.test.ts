// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, importBatches, stgItems } from '@/db/schema';
import { COST_LINK_FILE_MISUPLOAD_MESSAGE } from '@/lib/imports/cost-link-file';
import { AppError } from '@/lib/result';
import { uploadItemFiles } from '@/server/imports/item-upload';

import { costLinkRow, costLinkXlsx } from '../../helpers/cost-link-file';
import { TEST_ACTOR, TEST_META } from '../../helpers/imports';
import { itemInput } from '../../helpers/items';
import { createTestDb } from '../../helpers/pglite';

/**
 * 오업로드 방지 (erp-upload-guide §6.2-7): 가격정책 관리 품목상태 칸(kind="items")에 품목-원가 매칭 파일을 올리면
 * 스테이징 적재 전에 거부한다 — 배치·스테이징·감사 행이 생기지 않아 행 원문이 남지 않는다. 합성 데이터만.
 * (반대 방향 — 매칭 업로드에 일반 품목조회 파일 — 은 tests/unit/costs/cost-link-file.test.ts)
 */
let handle: DbHandle;
const ctx = () => ({ handle, actor: TEST_ACTOR, meta: TEST_META });

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('품목상태 업로드에 매칭 파일', () => {
  it.each([
    ['1행 제목 "품목조회(추가정보)"', { title: '품목조회(추가정보)' }],
    ['제목은 달라도 헤더에 "원자재품번(필수)"', { title: '품목조회' }],
  ])('%s → VALIDATION 거부, 배치·스테이징·감사 없음', async (_name, options) => {
    const bytes = await costLinkXlsx([costLinkRow('TEST-ITEM-001', 'TEST-MAT-001')], options);
    const before = {
      batches: await handle.db.$count(importBatches),
      staged: await handle.db.$count(stgItems),
      audits: await handle.db.$count(auditLogs),
    };
    const error = await uploadItemFiles(ctx(), [itemInput('synthetic.xlsx', bytes)]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'VALIDATION', message: COST_LINK_FILE_MISUPLOAD_MESSAGE });
    expect(JSON.stringify(error)).not.toMatch(/TEST-ITEM|TEST-MAT/);
    expect({
      batches: await handle.db.$count(importBatches),
      staged: await handle.db.$count(stgItems),
      audits: await handle.db.$count(auditLogs),
    }).toEqual(before);
  });
});
