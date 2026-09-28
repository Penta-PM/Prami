// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, partMappings, solutionGroups } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';
import { listPartsCatalog } from '@/server/parts/catalog';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 파츠·그룹 Server Actions — §4.7.1: USER 는 FORBIDDEN 봉투 + 테이블 무변경 + 감사 denied 1행,
 * ADMIN 은 저장/삭제/생성 성공.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const parts = await import('@/features/parts/actions');
const groups = await import('@/features/groups/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
let model = '';
const N_51080 = 'P10800011';

async function snapshot() {
  const db = state.handle!.db;
  return {
    mappings: await db.select().from(partMappings).orderBy(partMappings.id),
    groups: await db.select().from(solutionGroups),
    audits: await db.$count(auditLogs),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const sales = await uploadFixture(state.handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle: state.handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  model = (await listPartsCatalog(state.handle.db, 'WAPPLES')).models[0]!.itemCode;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('USER 거부 (§4.7.1)', () => {
  it.each([
    [
      'savePartMapping',
      'part_mapping.save',
      () => parts.savePartMappingAction({ modelItemCode: model, partItemCodes: [N_51080] }),
    ],
    [
      'deletePartMapping',
      'part_mapping.delete',
      () => parts.deletePartMappingAction({ modelItemCode: model }),
    ],
    [
      'applyPartImport',
      'part_import.apply',
      () =>
        parts.applyPartImportAction({
          batchId: '00000000-0000-4000-8000-000000000000',
          reused: false,
        }),
    ],
    [
      'upsertSolutionGroup',
      'solution_group.create',
      () =>
        groups.upsertSolutionGroupAction({
          productFamily: 'WAPPLES',
          name: 'x',
          items: [{ itemCode: model }],
        }),
    ],
    [
      'deleteSolutionGroup',
      'solution_group.delete',
      () => groups.deleteSolutionGroupAction({ id: '00000000-0000-4000-8000-000000000000' }),
    ],
  ])('%s: FORBIDDEN + 무변경 + %s denied 1행', async (_name, auditKey, call) => {
    state.sessionUserId = userId;
    const before = await snapshot();
    const result = await call();
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    const after = await snapshot();
    expect(after.mappings).toEqual(before.mappings);
    expect(after.groups).toEqual(before.groups);
    expect(after.audits).toBe(before.audits + 1);
    expect((await auditByAction(state.handle!, auditKey)).at(-1)).toMatchObject({
      actorUserId: userId,
      result: 'denied',
    });
  });
});

describe('ADMIN', () => {
  it('매핑 저장(중복 교체) → 삭제, 그룹 생성 → 수정 → 삭제 봉투', async () => {
    state.sessionUserId = adminId;
    expect(
      await parts.savePartMappingAction({ modelItemCode: model, partItemCodes: [N_51080] }),
    ).toMatchObject({ ok: true, data: { replaced: false, partItemCodes: [N_51080] } });
    expect(
      await parts.savePartMappingAction({ modelItemCode: model, partItemCodes: ['P10800009'] }),
    ).toMatchObject({ ok: true, data: { replaced: true } });
    const invalid = await parts.savePartMappingAction({
      modelItemCode: model,
      partItemCodes: ['NOPE-0000'],
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        fieldErrors: { partItemCodes: [expect.stringContaining('NOPE')] },
      },
    });
    expect(await parts.deletePartMappingAction({ modelItemCode: model })).toMatchObject({
      ok: true,
      data: { removed: 1 },
    });

    const created = await groups.upsertSolutionGroupAction({
      productFamily: 'WAPPLES',
      name: '그룹 A',
      items: [{ itemCode: model }],
    });
    expect(created).toMatchObject({ ok: true, data: { name: '그룹 A' } });
    if (!created.ok) throw new Error('unreachable');
    expect(
      await groups.upsertSolutionGroupAction({
        id: created.data.id,
        productFamily: 'WAPPLES',
        name: '그룹 B',
        items: [{ itemCode: model, defaultQty: 3 }],
      }),
    ).toMatchObject({ ok: true, data: { id: created.data.id, name: '그룹 B' } });
    expect(await groups.deleteSolutionGroupAction({ id: created.data.id })).toMatchObject({
      ok: true,
      data: { id: created.data.id },
    });
    for (const key of [
      'part_mapping.save',
      'part_mapping.delete',
      'solution_group.create',
      'solution_group.update',
      'solution_group.delete',
    ]) {
      expect((await auditByAction(state.handle!, key)).at(-1)).toMatchObject({
        actorUserId: adminId,
        result: 'success',
      });
    }
  });
});
