// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { notices } from '@/db/schema';
import { AppError } from '@/lib/result';
import {
  createNotice,
  deleteNotice,
  updateNotice,
  upsertNotice,
  type NoticeContext,
} from '@/server/notices/mutations';
import { getNotice, listNotices, listNoticesWithBody } from '@/server/notices/queries';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/** 공지 등록·수정·삭제 + 목록/상세 (§4.5.4, AC-51 감사) */
let handle: DbHandle;
let ctx: NoticeContext;

const NEW = {
  title: '2026년 하반기 가격정책 적용 일정',
  authorName: '가격정책팀',
  body: '판매단가 파일 임포트 후 적용 일정을 안내합니다.',
  isImportant: true,
  publishedAt: '2026-09-20',
};

beforeAll(async () => {
  handle = await createTestDb();
  const admin = await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  ctx = {
    handle,
    actor: { id: admin.id, label: admin.email },
    meta: { ip: null, userAgent: 'vitest' },
  };
});

afterAll(async () => {
  await handle.close();
});

describe('createNotice / upsertNotice', () => {
  it('등록 → 목록·상세에 즉시 보이고 감사 notice.create (after 스냅샷, 본문은 길이만)', async () => {
    const created = await upsertNotice(ctx, NEW);
    expect(created.title).toBe(NEW.title);
    const detail = await getNotice(handle.db, created.id);
    expect(detail).toMatchObject({ ...NEW, id: created.id });
    expect((await listNotices(handle.db)).map((row) => row.id)).toContain(created.id);
    const [log] = await auditByAction(handle, 'notice.create');
    expect(log).toMatchObject({ targetType: 'notice', targetId: created.id, result: 'success' });
    expect(log!.after).toEqual({
      title: NEW.title,
      authorName: NEW.authorName,
      isImportant: true,
      publishedAt: NEW.publishedAt,
      bodyLength: NEW.body.length,
    });
    const [row] = await handle.db.select().from(notices).where(eq(notices.id, created.id));
    expect(row?.authorUserId).toBe(ctx.actor.id);
  });

  it('작성일을 비우면 오늘, 필수값 누락은 ZodError(조사 포함)', async () => {
    const created = await createNotice(ctx, { ...NEW, title: '오늘 공지', publishedAt: '' });
    const detail = await getNotice(handle.db, created.id);
    expect(detail?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const error = await createNotice(ctx, { ...NEW, title: '  ', body: '' }).catch(
      (e: unknown) => e,
    );
    expect(JSON.stringify(error)).toContain('제목을 입력하세요');
    expect(JSON.stringify(error)).toContain('내용을 입력하세요');
  });
});

describe('updateNotice / deleteNotice', () => {
  it('수정 → before/after 감사 notice.update, 상세 반영', async () => {
    const first = (await listNotices(handle.db)).find((row) => row.title === NEW.title);
    const updated = await upsertNotice(ctx, {
      id: first!.id,
      title: '제목 수정',
      authorName: '운영팀',
      body: '본문 수정',
      isImportant: false,
      publishedAt: '2026-09-21',
    });
    expect(updated).toEqual({ id: first!.id, title: '제목 수정' });
    expect(await getNotice(handle.db, first!.id)).toMatchObject({
      title: '제목 수정',
      authorName: '운영팀',
      body: '본문 수정',
      isImportant: false,
      publishedAt: '2026-09-21',
    });
    const [log] = await auditByAction(handle, 'notice.update');
    expect(log!.before).toMatchObject({ title: NEW.title, isImportant: true });
    expect(log!.after).toMatchObject({ title: '제목 수정', isImportant: false, bodyLength: 5 });
  });

  it('작성일을 비우고 수정하면 기존 작성일 유지', async () => {
    const [first] = await listNotices(handle.db);
    await updateNotice(ctx, {
      id: first!.id,
      title: first!.title,
      authorName: first!.authorName,
      body: 'x',
      isImportant: first!.isImportant,
    });
    expect((await getNotice(handle.db, first!.id))?.publishedAt).toBe(first!.publishedAt);
  });

  it('삭제 → soft delete, 목록·상세·관리 목록에서 사라지고 감사 notice.delete; 재삭제·없는 id 는 NOT_FOUND', async () => {
    const [first] = await listNotices(handle.db);
    await deleteNotice(ctx, { id: first!.id });
    expect(await getNotice(handle.db, first!.id)).toBeNull();
    expect((await listNotices(handle.db)).map((row) => row.id)).not.toContain(first!.id);
    expect((await listNoticesWithBody(handle.db)).map((row) => row.id)).not.toContain(first!.id);
    const [row] = await handle.db.select().from(notices).where(eq(notices.id, first!.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect((await auditByAction(handle, 'notice.delete')).at(-1)).toMatchObject({
      targetId: first!.id,
      result: 'success',
    });
    const again = await deleteNotice(ctx, { id: first!.id }).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(AppError);
    expect((again as AppError).code).toBe('NOT_FOUND');
    await expect(
      updateNotice(ctx, { ...NEW, id: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listNotices', () => {
  it('작성일 내림차순, limit 5 (홈)', async () => {
    for (const [index, day] of ['2026-01-01', '2026-03-01', '2026-02-01'].entries()) {
      await createNotice(ctx, { ...NEW, title: `정렬 ${index}`, publishedAt: day });
    }
    const rows = await listNotices(handle.db);
    const dates = rows.map((row) => row.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(await listNotices(handle.db, 2)).toHaveLength(2);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'authorName',
      'id',
      'isImportant',
      'publishedAt',
      'title',
    ]);
  });
});
