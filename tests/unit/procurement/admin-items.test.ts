// @vitest-environment node
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs } from '@/db/schema';
import {
  procurementItemChanges,
  procurementItems,
  type NewProcurementItem,
} from '@/db/schema/procurement';
import type { ItemsAdminPanelProps } from '@/features/procurement/admin/items/ItemsAdminPanel';
import { AppError } from '@/lib/result';
import { procurementAccessForTests } from '@/server/procurement/access-token';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-7 품목 관리 — 서버 액션·쓰기 계층 (PGlite, 합성 품목만: 가짜 물품식별번호·제조사).
 * - 권한 매트릭스: 비로그인 UNAUTHENTICATED, USER FORBIDDEN(+ 감사 procurement.write denied, 부수효과 없음), ADMIN 허용
 * - 모든 쓰기 = items + item_changes(changed_by = 이메일) + audit_logs(procurement.item.*, actor = 사용자 id) 한 트랜잭션
 * - 일일 신규 품목 검토(include/review, 제품 미정 거부), 일괄 변경, 단건 추가(manual), 휴지통(삭제자)·되살리기, 동시 편집 "이미 처리됨"
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
  currentRequestMeta: async () => ({ ip: '198.51.100.9', userAgent: 'vitest' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('@/features/procurement/admin/items/actions');
const { getItemTrash, getItemReviewQueue, getAdminItemRows, getAdminItemsByIds } =
  await import('@/server/procurement/admin-items');
const mutations = await import('@/server/procurement/item-mutations');
const { ItemsAdminSection } = await import('@/features/procurement/admin/items/ItemsAdminSection');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const ADMIN_EMAIL = 'items-admin@pentasecurity.com';
const ADMIN2_EMAIL = 'items-admin2@pentasecurity.com';
let adminId: string;
let admin2Id: string;
let userId: string;
let seq = 0;

function db() {
  return state.handle!.db;
}

/** 합성 품목 1행 삽입 → id */
async function seedItem(values: Partial<NewProcurementItem> = {}): Promise<number> {
  seq += 1;
  const [row] = await db()
    .insert(procurementItems)
    .values({
      itemId: `9${String(seq).padStart(7, '0')}`,
      product: 'WAPPLES',
      manufacturer: '가상제조',
      itemName: `가상 품목 ${seq}`,
      registeredOn: '2026-10-01',
      status: 'active',
      reviewed: true,
      ...values,
    })
    .returning({ id: procurementItems.id });
  return row!.id;
}

const adminAccess = () => procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'write');

async function targetsOf(ids: number[]) {
  const rows = await getAdminItemsByIds(adminAccess(), db(), ids);
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id)!;
    return { id: row.id, version: row.version };
  });
}

async function item(id: number) {
  const [row] = await db().select().from(procurementItems).where(eq(procurementItems.id, id));
  return row!;
}

async function changesOf(id: number) {
  return db()
    .select()
    .from(procurementItemChanges)
    .where(eq(procurementItemChanges.itemPk, id))
    .orderBy(asc(procurementItemChanges.id));
}

async function auditsFor(id: number) {
  return db()
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, String(id)))
    .orderBy(asc(auditLogs.id));
}

async function counts() {
  return {
    changes: await db().$count(procurementItemChanges),
    audits: await db().$count(auditLogs),
    items: await db().$count(procurementItems),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: ADMIN_EMAIL, role: 'ADMIN' })).id;
  admin2Id = (await insertUser(state.handle, { email: ADMIN2_EMAIL, role: 'ADMIN' })).id;
  userId = (await insertUser(state.handle, { email: 'items-user@pentasecurity.com', role: 'USER' }))
    .id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = adminId;
});

describe('권한 매트릭스 (procurement.write = ADMIN)', () => {
  it('비로그인: 모든 액션 UNAUTHENTICATED, 아무것도 바뀌지 않는다', async () => {
    state.sessionUserId = undefined;
    const id = await seedItem({ status: 'pending', product: 'D.AMO', reviewed: false });
    const [target] = await targetsOf([id]);
    const before = await counts();
    const results = await Promise.all([
      actions.includeReviewItemsAction({ targets: [target!] }),
      actions.excludeItemsAction({ targets: [target!] }),
      actions.restoreItemsAction({ targets: [target!] }),
      actions.editItemsAction({ targets: [target!], patch: { itemName: 'x' } }),
      actions.addItemAction({ product: 'WAPPLES', itemId: '90000001' }),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await counts()).toEqual(before);
    expect((await item(id)).status).toBe('pending');
  });

  it('USER: 모든 액션 FORBIDDEN + 감사 procurement.write denied(액션마다 1행), 품목·이력 무변경', async () => {
    state.sessionUserId = userId;
    const id = await seedItem({ status: 'pending', product: 'D.AMO', reviewed: false });
    const [target] = await targetsOf([id]);
    const deniedBefore = (await auditByAction(state.handle!, 'procurement.write')).length;
    const changesBefore = await db().$count(procurementItemChanges);
    const calls = [
      () => actions.includeReviewItemsAction({ targets: [target!] }),
      () => actions.excludeItemsAction({ targets: [target!] }),
      () => actions.restoreItemsAction({ targets: [target!] }),
      () => actions.editItemsAction({ targets: [target!], patch: { itemName: 'x' } }),
      () => actions.addItemAction({ product: 'WAPPLES', itemId: '90000002' }),
    ];
    for (const call of calls) {
      const result = await call();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    }
    const denied = await auditByAction(state.handle!, 'procurement.write');
    expect(denied).toHaveLength(deniedBefore + calls.length);
    expect(denied.at(-1)).toMatchObject({ actorUserId: userId, result: 'denied' });
    expect(denied.map((row) => row.targetId)).toEqual(
      expect.arrayContaining([
        'action:includeReviewItems',
        'action:excludeItems',
        'action:restoreItems',
        'action:editItems',
        'action:addItem',
      ]),
    );
    expect(await db().$count(procurementItemChanges)).toBe(changesBefore);
    expect(await item(id)).toMatchObject({ status: 'pending', product: 'D.AMO' });
  });

  it('read 토큰으로는 쓰기·관리 조회 함수가 거부한다', async () => {
    const readOnly = procurementAccessForTests({ id: userId, email: 'x' }, 'read');
    await expect(getItemReviewQueue(readOnly, db())).rejects.toThrow('write 범위');
    await expect(getItemTrash(readOnly, db())).rejects.toThrow('write 범위');
    await expect(
      mutations.addItem(
        { handle: state.handle!, access: readOnly, meta: { ip: null, userAgent: null } },
        { product: 'WAPPLES', itemId: '1' },
      ),
    ).rejects.toThrow('write 범위');
  });

  it('서버 섹션(ItemsAdminSection): URL 조건으로 검토 대기·등록 품목·휴지통·세부분류 제안을 불러와 패널에 넘긴다', async () => {
    await seedItem({ product: 'iSIGN', detailCategory: 'PKI', manufacturer: '섹션제조' });
    await seedItem({ product: 'iSIGN', detailCategory: 'SSO', manufacturer: '섹션제조' });
    const element = await ItemsAdminSection({
      params: {
        tab: 'items',
        q: '섹션제조',
        product: 'iSIGN',
        sort: 'detailCategory',
        dir: 'desc',
      },
      access: adminAccess(),
      user: { id: adminId, email: ADMIN_EMAIL } as never,
    });
    const props = element.props as ItemsAdminPanelProps;
    expect(props.filter).toEqual({
      q: '섹션제조',
      product: 'iSIGN',
      page: 1,
      trashPage: 1,
      sort: { id: 'detailCategory', dir: 'desc' },
    });
    const { registered, queue, trash, detailOptions } = props.data;
    expect(registered.rows.map((row) => row.detailCategory)).toEqual(['SSO', 'PKI']);
    expect(registered.rows[1]).toMatchObject({ productGroup: 'WA', status: 'active' });
    expect(registered.rows[0]!.version).toMatch(/^\d+$/);
    expect(detailOptions.iSIGN).toEqual(expect.arrayContaining(['PKI', 'SSO']));
    expect(queue.rows.length).toBeLessThanOrEqual(queue.total);
    expect(trash.page).toBe(1);
  });

  it('서버 섹션은 read 토큰이면 거부 (관리 조회 = write)', async () => {
    await expect(
      ItemsAdminSection({
        params: { tab: 'items' },
        access: procurementAccessForTests({ id: userId, email: 'x' }, 'read'),
        user: { id: userId, email: 'x' } as never,
      }),
    ).rejects.toThrow('write 범위');
  });
});

describe('일일 신규 품목 검토', () => {
  it('검토 대기 = 제품 미정(pending) + 자동 등록·미확인(active, reviewed=false). 휴지통·확인된 등록은 아님', async () => {
    const pending = await seedItem({ status: 'pending', product: '기타', reviewed: false });
    const unreviewed = await seedItem({ status: 'active', product: 'D.AMO', reviewed: false });
    const reviewed = await seedItem({ status: 'active', reviewed: true });
    const trashed = await seedItem({ status: 'excluded', reviewed: false });
    const queue = await getItemReviewQueue(adminAccess(), db());
    const ids = queue.rows.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([pending, unreviewed]));
    expect(ids).not.toContain(reviewed);
    expect(ids).not.toContain(trashed);
  });

  it('선택 추가: pending → active(include), active 미확인 → reviewed(review). 품목마다 이력 1 + 감사 1, 같은 행위 이름', async () => {
    const pending = await seedItem({ status: 'pending', product: 'WAPPLES', reviewed: false });
    const unreviewed = await seedItem({ status: 'active', product: 'D.AMO', reviewed: false });
    const result = await actions.includeReviewItemsAction({
      targets: await targetsOf([pending, unreviewed]),
    });
    expect(result).toEqual({ ok: true, data: { count: 2, ids: [pending, unreviewed] } });
    expect(await item(pending)).toMatchObject({ status: 'active', reviewed: true });
    expect(await item(unreviewed)).toMatchObject({ status: 'active', reviewed: true });

    const [includeChange] = await changesOf(pending);
    expect(includeChange).toMatchObject({
      action: 'include',
      changedBy: ADMIN_EMAIL,
      before: { status: 'pending', reviewed: false },
      after: { status: 'active', reviewed: true },
    });
    const [reviewChange] = await changesOf(unreviewed);
    expect(reviewChange).toMatchObject({
      action: 'review',
      before: { reviewed: false },
      after: { reviewed: true },
    });
    const [includeAudit] = await auditsFor(pending);
    expect(includeAudit).toMatchObject({
      action: 'procurement.item.include',
      actorUserId: adminId,
      actorLabel: ADMIN_EMAIL,
      targetType: 'procurement_item',
      result: 'success',
      ip: '198.51.100.9',
    });
    expect((await auditsFor(unreviewed))[0]).toMatchObject({ action: 'procurement.item.review' });
  });

  it('제품 미정(기타)이 섞이면 VALIDATION — 아무것도 바뀌지 않는다(같이 보낸 다른 품목도)', async () => {
    const undecided = await seedItem({ status: 'pending', product: '기타', reviewed: false });
    const decided = await seedItem({ status: 'pending', product: 'WAPPLES', reviewed: false });
    const before = await counts();
    const result = await actions.includeReviewItemsAction({
      targets: await targetsOf([decided, undecided]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('제품이 정해지지 않은 1건');
    }
    expect(await counts()).toEqual(before);
    expect((await item(decided)).status).toBe('pending');
  });

  it('행 내 제품 고르기(edit) → 추가(include). 트리거가 product_group 을 채운다', async () => {
    const id = await seedItem({
      status: 'pending',
      product: '기타',
      reviewed: false,
      detailCategory: null,
    });
    const picked = await actions.editItemsAction({
      targets: await targetsOf([id]),
      patch: { product: 'iSIGN' },
    });
    expect(picked.ok).toBe(true);
    const categorized = await actions.editItemsAction({
      targets: await targetsOf([id]),
      patch: { detailCategory: 'OTP' },
    });
    expect(categorized.ok).toBe(true);
    expect(await item(id)).toMatchObject({
      product: 'iSIGN',
      detailCategory: 'OTP',
      productGroup: 'PASS',
      status: 'pending',
    });
    const included = await actions.includeReviewItemsAction({ targets: await targetsOf([id]) });
    expect(included.ok).toBe(true);
    expect((await changesOf(id)).map((change) => change.action)).toEqual([
      'edit',
      'edit',
      'include',
    ]);
    expect((await changesOf(id))[0]).toMatchObject({
      before: { product: '기타' },
      after: { product: 'iSIGN' },
    });
  });

  it('iSIGN 세부분류는 목록 8개 중에서만 (VALIDATION)', async () => {
    const id = await seedItem({ product: 'iSIGN', detailCategory: 'SSO' });
    const result = await actions.editItemsAction({
      targets: await targetsOf([id]),
      patch: { detailCategory: '아무거나' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect((await item(id)).detailCategory).toBe('SSO');
  });
});

describe('등록 품목: 일괄 변경·행 편집·단건 추가', () => {
  it('일괄 변경(제품·세부분류) — 품목마다 edit 이력·감사, 바뀐 칸만 before/after', async () => {
    const a = await seedItem({ product: 'WAPPLES', detailCategory: 'WAF' });
    const b = await seedItem({ product: 'D.AMO', detailCategory: 'DB' });
    const result = await actions.editItemsAction({
      targets: await targetsOf([a, b]),
      patch: { product: 'iSIGN', detailCategory: 'SSO' },
    });
    expect(result).toEqual({ ok: true, data: { count: 2, ids: [a, b] } });
    for (const id of [a, b]) {
      expect(await item(id)).toMatchObject({
        product: 'iSIGN',
        detailCategory: 'SSO',
        productGroup: 'SSO',
      });
      const [change] = await changesOf(id);
      expect(change).toMatchObject({ action: 'edit', changedBy: ADMIN_EMAIL });
      expect(Object.keys(change!.after!).sort()).toEqual(['detail_category', 'product']);
      expect((await auditsFor(id))[0]).toMatchObject({
        action: 'procurement.item.edit',
        before: change!.before,
        after: change!.after,
      });
    }
  });

  it('행 편집(전 칸) — 바뀐 것이 없으면 이력·감사 없이 count 0', async () => {
    const id = await seedItem({ manufacturer: '가상제조', itemName: '원래 이름' });
    const same = await actions.editItemsAction({
      targets: await targetsOf([id]),
      patch: { itemName: '원래 이름', manufacturer: '가상제조' },
    });
    expect(same).toEqual({ ok: true, data: { count: 0, ids: [] } });
    expect(await changesOf(id)).toHaveLength(0);
    const edited = await actions.editItemsAction({
      targets: await targetsOf([id]),
      patch: { itemName: '새 이름', manufacturer: '', itemId: '88880001' },
    });
    expect(edited.ok).toBe(true);
    expect(await item(id)).toMatchObject({
      itemName: '새 이름',
      manufacturer: null,
      itemId: '88880001',
    });
  });

  it('물품식별번호는 한 건씩만, (물품식별번호, 제품) 중복은 CONFLICT — 일괄 변경 도중 실패하면 전부 되돌린다', async () => {
    const x = await seedItem({ product: 'WAPPLES' });
    const y = await seedItem({ product: 'D.AMO' });
    const multiId = await actions.editItemsAction({
      targets: await targetsOf([x, y]),
      patch: { itemId: '1' },
    });
    expect(multiId.ok).toBe(false);

    // 같은 물품식별번호가 이미 iSIGN 에 있는 품목을 함께 iSIGN 으로 → 두 번째에서 충돌, 첫 번째 변경도 롤백
    const shared = `7${String(++seq).padStart(7, '0')}`;
    const first = await seedItem({ product: 'WAPPLES' });
    const clashing = await seedItem({ product: 'D.AMO', itemId: shared });
    await seedItem({ product: 'iSIGN', itemId: shared, status: 'excluded' });
    const before = await counts();
    const result = await actions.editItemsAction({
      targets: await targetsOf([first, clashing]),
      patch: { product: 'iSIGN' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('휴지통에 있습니다');
    }
    expect(await counts()).toEqual(before);
    expect((await item(first)).product).toBe('WAPPLES');
  });

  it('단건 직접 추가: source manual·active·reviewed, 등록일자 오늘(KST), add 이력·감사', async () => {
    const result = await actions.addItemAction({
      product: 'D.AMO',
      itemId: ' 66660001 ',
      itemName: '가상 암호화',
      manufacturer: '',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.data.ids[0]!;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    expect(await item(id)).toMatchObject({
      itemId: '66660001',
      product: 'D.AMO',
      manufacturer: null,
      source: 'manual',
      status: 'active',
      reviewed: true,
      registeredOn: today,
    });
    const [change] = await changesOf(id);
    expect(change).toMatchObject({
      action: 'add',
      before: null,
      changedBy: ADMIN_EMAIL,
      after: { item_id: '66660001', product: 'D.AMO', source: 'manual' },
    });
    expect((await auditsFor(id))[0]).toMatchObject({
      action: 'procurement.item.add',
      actorUserId: adminId,
    });
  });

  it('직접 추가 중복: 등록·검토 대기·휴지통 상태별 안내 (CONFLICT, 행 추가 없음)', async () => {
    const code = `5${String(++seq).padStart(7, '0')}`;
    await seedItem({ product: 'WAPPLES', itemId: code });
    await seedItem({ product: 'D.AMO', itemId: code, status: 'pending', reviewed: false });
    await seedItem({ product: 'iSIGN', itemId: code, status: 'excluded' });
    const before = await counts();
    const messages: string[] = [];
    for (const product of ['WAPPLES', 'D.AMO', 'iSIGN'] as const) {
      const result = await actions.addItemAction({ product, itemId: code });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFLICT');
        messages.push(result.error.message);
      }
    }
    expect(messages[0]).toContain('이미 등록되어 있습니다');
    expect(messages[1]).toContain('검토 대기 중');
    expect(messages[2]).toContain('휴지통에서 되살리세요');
    expect(await counts()).toEqual(before);
  });

  it('제품 "기타" 로는 직접 추가하지 않는다 (VALIDATION)', async () => {
    const result = await actions.addItemAction({ product: '기타' as never, itemId: '1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });
});

describe('휴지통·되살리기', () => {
  it('삭제 → 휴지통에 삭제자(이메일)·삭제 시각, 되살리면 원래 자리(제품 미정이면 검토 대기)', async () => {
    const registered = await seedItem({ product: 'WAPPLES' });
    const undecided = await seedItem({ product: '기타', status: 'pending', reviewed: false });
    const excluded = await actions.excludeItemsAction({
      targets: await targetsOf([registered, undecided]),
    });
    expect(excluded.ok).toBe(true);
    expect(await item(registered)).toMatchObject({ status: 'excluded', reviewed: true });

    // 두 번째 관리자가 다시 삭제한 것처럼 이력이 여러 개면 마지막 exclude 기록이 삭제자
    const trash = await getItemTrash(adminAccess(), db());
    const row = trash.rows.find((candidate) => candidate.id === registered)!;
    expect(row.deletedBy).toBe(ADMIN_EMAIL);
    expect(Date.parse(row.deletedAt!)).not.toBeNaN();
    expect(trash.rows.find((candidate) => candidate.id === undecided)?.deletedBy).toBe(ADMIN_EMAIL);
    expect((await auditsFor(registered)).at(-1)).toMatchObject({
      action: 'procurement.item.exclude',
      before: { status: 'active' },
      after: { status: 'excluded' },
    });

    // 휴지통 품목은 편집할 수 없다 (이미 처리됨)
    const editTrashed = await actions.editItemsAction({
      targets: await targetsOf([registered]),
      patch: { itemName: 'x' },
    });
    expect(editTrashed.ok).toBe(false);

    state.sessionUserId = admin2Id;
    invalidateSessionUser();
    const restored = await actions.restoreItemsAction({
      targets: await targetsOf([registered, undecided]),
    });
    expect(restored.ok).toBe(true);
    expect((await item(registered)).status).toBe('active');
    expect((await item(undecided)).status).toBe('pending');
    expect((await changesOf(registered)).at(-1)).toMatchObject({
      action: 'include',
      changedBy: ADMIN2_EMAIL,
      before: { status: 'excluded' },
      after: { status: 'active' },
    });
    expect((await auditsFor(undecided)).at(-1)).toMatchObject({
      action: 'procurement.item.include',
      actorUserId: admin2Id,
      after: { status: 'pending' },
    });
    const queue = await getItemReviewQueue(adminAccess(), db());
    expect(queue.rows.map((candidate) => candidate.id)).toContain(undecided);
  });

  it('휴지통 정렬: 마지막 삭제가 먼저, 다시 삭제하면 최신 삭제자', async () => {
    const id = await seedItem();
    await actions.excludeItemsAction({ targets: await targetsOf([id]) });
    await actions.restoreItemsAction({ targets: await targetsOf([id]) });
    state.sessionUserId = admin2Id;
    invalidateSessionUser();
    await actions.excludeItemsAction({ targets: await targetsOf([id]) });
    const trash = await getItemTrash(adminAccess(), db());
    expect(trash.rows[0]).toMatchObject({ id, deletedBy: ADMIN2_EMAIL });
    expect(await changesOf(id)).toHaveLength(3);
  });
});

describe('동시 편집 — 저장 시 재검증, "이미 처리됨"', () => {
  it('다른 관리자가 먼저 처리한 품목: CONFLICT + alreadyProcessed, 전체 되돌림', async () => {
    const a = await seedItem({ status: 'pending', product: 'WAPPLES', reviewed: false });
    const b = await seedItem({ status: 'pending', product: 'D.AMO', reviewed: false });
    const seen = await targetsOf([a, b]); // 두 관리자 화면이 같은 목록을 읽음

    // 관리자 2 가 a 를 먼저 삭제
    state.sessionUserId = admin2Id;
    invalidateSessionUser();
    expect((await actions.excludeItemsAction({ targets: [seen[0]!] })).ok).toBe(true);

    // 관리자 1 이 예전 화면으로 a·b 일괄 추가
    state.sessionUserId = adminId;
    invalidateSessionUser();
    const before = await counts();
    const result = await actions.includeReviewItemsAction({ targets: seen });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('이미 처리됨');
      expect(result.error.details).toEqual({ alreadyProcessed: [a] });
    }
    expect(await counts()).toEqual(before);
    expect((await item(b)).status).toBe('pending');
  });

  it('같은 품목을 다른 사람이 편집한 뒤의 저장(버전 불일치)도 거부', async () => {
    const id = await seedItem();
    const [stale] = await targetsOf([id]);
    expect(
      (await actions.editItemsAction({ targets: [stale!], patch: { itemName: '먼저' } })).ok,
    ).toBe(true);
    const late = await actions.editItemsAction({ targets: [stale!], patch: { itemName: '나중' } });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('CONFLICT');
    expect((await item(id)).itemName).toBe('먼저');
  });

  it('없는 품목·이미 휴지통인 품목 삭제·휴지통 아닌 품목 되살리기 = 이미 처리됨', async () => {
    const active = await seedItem();
    const [target] = await targetsOf([active]);
    for (const call of [
      () => actions.excludeItemsAction({ targets: [{ id: 99_999_999, version: '1' }] }),
      () => actions.restoreItemsAction({ targets: [target!] }),
    ]) {
      const result = await call();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CONFLICT');
    }
  });
});

describe('원자성 (D-8) — 이력·감사·품목은 한 트랜잭션', () => {
  it('감사 기록이 실패하면(actor FK 위반) 품목 변경·이력도 남지 않는다', async () => {
    const id = await seedItem({ status: 'pending', product: 'WAPPLES', reviewed: false });
    const ghost = procurementAccessForTests(
      { id: '00000000-0000-4000-8000-000000000000', email: 'ghost@pentasecurity.com' },
      'write',
    );
    const before = await counts();
    await expect(
      mutations.includeReviewItems(
        { handle: state.handle!, access: ghost, meta: { ip: null, userAgent: null } },
        { targets: await targetsOf([id]) },
      ),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect(await item(id)).toMatchObject({ status: 'pending', reviewed: false });
  });

  it('입력 검증: 빈 선택·중복 id·버전 형식', async () => {
    for (const targets of [
      [],
      [
        { id: 1, version: '1' },
        { id: 1, version: '1' },
      ],
      [{ id: 1, version: 'abc' }],
    ]) {
      const result = await actions.excludeItemsAction({ targets });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    }
  });

  it('AppError 는 그대로 던진다 (쓰기 계층 직접 호출)', async () => {
    await expect(
      mutations.excludeItems(
        { handle: state.handle!, access: adminAccess(), meta: { ip: null, userAgent: null } },
        { targets: [{ id: 99_999_998, version: '1' }] },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('조회 상태 정규화 (page_key admin-procurement, items 탭)', () => {
  it('items 탭은 normalizeAdminItemsQuery — 품목 조건만 남기고, USER 는 빈 상태', async () => {
    const { normalizeViewQuery } = await import('@/server/page-state/normalize');
    const admin = { role: 'ADMIN' as const };
    expect(
      await normalizeViewQuery(
        db(),
        admin,
        'admin-procurement',
        'tab=items&dir=desc&sort=itemId&page=2&f.product=WAPPLES&q=가상&trashPage=x',
      ),
    ).toBe('tab=items&q=%EA%B0%80%EC%83%81&page=2&sort=itemId&dir=desc');
    expect(await normalizeViewQuery(db(), admin, 'admin-procurement', 'tab=items')).toBe(
      'tab=items',
    );
    expect(
      await normalizeViewQuery(db(), { role: 'USER' }, 'admin-procurement', 'tab=items&q=a'),
    ).toBe('');
  });
});

describe('등록 품목 관리 표 (서버 페이지네이션·필터)', () => {
  it('active 만, 검색(물품식별번호·품목·제조사)·제품 필터, 50행 페이지', async () => {
    const ids: number[] = [];
    for (let index = 0; index < 55; index += 1) {
      ids.push(await seedItem({ product: 'D.AMO', manufacturer: '페이지제조' }));
    }
    const first = await getAdminItemRows(adminAccess(), db(), { q: '페이지제조' });
    expect(first).toMatchObject({ total: 55, page: 1, pageCount: 2, pageSize: 50 });
    expect(first.rows).toHaveLength(50);
    const second = await getAdminItemRows(adminAccess(), db(), { q: '페이지제조', page: 9 });
    expect(second).toMatchObject({ page: 2 });
    expect(second.rows).toHaveLength(5);
    const none = await getAdminItemRows(adminAccess(), db(), { q: '페이지제조', product: 'iSIGN' });
    expect(none.total).toBe(0);
    const byIdDesc = await getAdminItemRows(adminAccess(), db(), {
      q: '페이지제조',
      sort: { id: 'itemId', dir: 'desc' },
    });
    const codes = byIdDesc.rows.map((row) => row.itemId);
    expect(codes).toEqual([...codes].sort().reverse());
    await db()
      .update(procurementItems)
      .set({ status: 'excluded' })
      .where(inArray(procurementItems.id, ids));
  });
});
