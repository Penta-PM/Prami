// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { solutionGroupItems, solutionGroups } from '@/db/schema';
import { AppError } from '@/lib/result';
import {
  deleteSolutionGroup,
  upsertSolutionGroup,
  type GroupsContext,
} from '@/server/groups/mutations';
import {
  getSolutionGroup,
  listGroupCandidates,
  listGroupChips,
  listSolutionGroups,
} from '@/server/groups/queries';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/** 솔루션 그룹 (§4.3.7, §4.5.6, AC-33 서버): 후보 = 운영중 정상판매 + 최신 가격, CRUD(soft delete), 감사 */
let handle: DbHandle;
let ctx: GroupsContext;

beforeAll(async () => {
  handle = await createTestDb();
  const admin = await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  ctx = { handle, actor: { id: admin.id, label: admin.email }, meta: TEST_META };
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await handle.close();
});

describe('listGroupCandidates', () => {
  it('제품군의 운영중 정상판매 품목 + 최신 가격, 품번당 1건', async () => {
    const candidates = await listGroupCandidates(handle.db, 'WAPPLES');
    expect(candidates.length).toBeGreaterThan(1);
    expect(new Set(candidates.map((item) => item.itemCode)).size).toBe(candidates.length);
    expect(candidates[0]).toMatchObject({
      unitPrice: expect.stringMatching(/^\d+\.\d{2}$/),
      currency: 'KRW',
    });
  });
});

describe('upsertSolutionGroup / listSolutionGroups / deleteSolutionGroup', () => {
  it('생성 → 항목 칩에 조회 시점 정상판매가, 감사 solution_group.create; 가격은 저장하지 않는다', async () => {
    const [a, b] = await listGroupCandidates(handle.db, 'WAPPLES');
    const created = await upsertSolutionGroup(ctx, {
      productFamily: 'WAPPLES',
      name: 'WAPPLES 기본 구성',
      items: [{ itemCode: a!.itemCode }, { itemCode: b!.itemCode, defaultQty: 2 }],
    });
    const [group] = await listSolutionGroups(handle.db, 'WAPPLES');
    expect(group).toMatchObject({
      id: created.id,
      name: 'WAPPLES 기본 구성',
      productFamily: 'WAPPLES',
    });
    expect(group!.items).toEqual([
      {
        itemCode: a!.itemCode,
        itemName: a!.itemName,
        defaultQty: 1,
        unitPrice: a!.unitPrice,
        currency: 'KRW',
      },
      {
        itemCode: b!.itemCode,
        itemName: b!.itemName,
        defaultQty: 2,
        unitPrice: b!.unitPrice,
        currency: 'KRW',
      },
    ]);
    const columns = Object.keys((await handle.db.select().from(solutionGroupItems).limit(1))[0]!);
    expect(columns).not.toContain('unitPrice');
    expect((await auditByAction(handle, 'solution_group.create')).at(-1)).toMatchObject({
      targetId: created.id,
      after: {
        name: 'WAPPLES 기본 구성',
        productFamily: 'WAPPLES',
        items: [`${a!.itemCode}×1`, `${b!.itemCode}×2`],
      },
    });
    expect(await listGroupChips(handle.db, 'WAPPLES')).toEqual([group]);
    expect(await getSolutionGroup(handle.db, created.id)).toEqual(group);
  });

  it('수정 → 이름·항목 전체 교체, 감사 before/after', async () => {
    const [group] = await listSolutionGroups(handle.db, 'WAPPLES');
    const [, , c] = await listGroupCandidates(handle.db, 'WAPPLES');
    await upsertSolutionGroup(ctx, {
      id: group!.id,
      productFamily: 'WAPPLES',
      name: 'WAPPLES 확장 구성',
      items: [{ itemCode: c!.itemCode }],
    });
    const updated = await getSolutionGroup(handle.db, group!.id);
    expect(updated?.name).toBe('WAPPLES 확장 구성');
    expect(updated?.items.map((item) => item.itemCode)).toEqual([c!.itemCode]);
    const log = (await auditByAction(handle, 'solution_group.update')).at(-1)!;
    expect(log.before).toMatchObject({ name: 'WAPPLES 기본 구성' });
    expect(log.after).toMatchObject({ name: 'WAPPLES 확장 구성', items: [`${c!.itemCode}×1`] });
  });

  it('검증: 그룹명 없음·항목 없음·없는 품번·없는 id', async () => {
    const base = { productFamily: 'WAPPLES', items: [{ itemCode: 'P1' }] };
    const noName = await upsertSolutionGroup(ctx, { ...base, name: ' ' }).catch((e: unknown) => e);
    expect(JSON.stringify(noName)).toContain('그룹명을 입력하세요');
    await expect(
      upsertSolutionGroup(ctx, { productFamily: 'WAPPLES', name: 'x', items: [] }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    const unknown = await upsertSolutionGroup(ctx, {
      productFamily: 'WAPPLES',
      name: 'x',
      items: [{ itemCode: 'NOPE-0000' }],
    }).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(AppError);
    expect((unknown as AppError).code).toBe('VALIDATION');
    await expect(
      upsertSolutionGroup(ctx, {
        id: '00000000-0000-4000-8000-000000000000',
        productFamily: 'WAPPLES',
        name: 'x',
        items: [{ itemCode: 'P1' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('삭제는 soft — 목록·칩에서 사라지고 행은 남는다, 감사 solution_group.delete', async () => {
    const [group] = await listSolutionGroups(handle.db, 'WAPPLES');
    await deleteSolutionGroup(ctx, { id: group!.id });
    expect(await listSolutionGroups(handle.db, 'WAPPLES')).toEqual([]);
    expect(await listGroupChips(handle.db, 'WAPPLES')).toEqual([]);
    expect(await getSolutionGroup(handle.db, group!.id)).toBeNull();
    const [row] = await handle.db
      .select()
      .from(solutionGroups)
      .where(eq(solutionGroups.id, group!.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect((await auditByAction(handle, 'solution_group.delete')).at(-1)).toMatchObject({
      targetId: group!.id,
    });
    await expect(deleteSolutionGroup(ctx, { id: group!.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
