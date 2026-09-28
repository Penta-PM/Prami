import { and, desc, eq, isNull } from 'drizzle-orm';

import type { Db } from '@/db';
import { notices } from '@/db/schema';

/** 목록·홈에 쓰는 공지 요약 (본문 제외) */
export type NoticeSummary = {
  id: string;
  title: string;
  authorName: string;
  isImportant: boolean;
  /** YYYY-MM-DD */
  publishedAt: string;
};

export type NoticeDetail = NoticeSummary & { body: string };

const SUMMARY = {
  id: notices.id,
  title: notices.title,
  authorName: notices.authorName,
  isImportant: notices.isImportant,
  publishedAt: notices.publishedAt,
};

/** 홈 최근 5건 (AC-50)·전체 목록: 작성일 내림차순, 같은 날이면 나중에 만든 것 먼저. 삭제 제외 */
export async function listNotices(db: Db, limit?: number): Promise<NoticeSummary[]> {
  const query = db
    .select(SUMMARY)
    .from(notices)
    .where(isNull(notices.deletedAt))
    .orderBy(desc(notices.publishedAt), desc(notices.createdAt));
  return limit ? query.limit(limit) : query;
}

export async function getNotice(db: Db, id: string): Promise<NoticeDetail | null> {
  const [row] = await db
    .select({ ...SUMMARY, body: notices.body })
    .from(notices)
    .where(and(eq(notices.id, id), isNull(notices.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** 관리 화면용: 본문까지 (수정 모달 초기값). 삭제 제외 */
export async function listNoticesWithBody(db: Db): Promise<NoticeDetail[]> {
  return db
    .select({ ...SUMMARY, body: notices.body })
    .from(notices)
    .where(isNull(notices.deletedAt))
    .orderBy(desc(notices.publishedAt), desc(notices.createdAt));
}
