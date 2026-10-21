import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db';
import { userDrafts } from '@/db/schema';
import {
  DRAFT_MAX_BYTES,
  DRAFT_VERSIONS,
  draftByteLength,
  isDraftExpired,
  isDraftKey,
  parseDraft,
  type DraftKey,
  type DraftOf,
} from '@/lib/page-state/drafts';

import { clearViewStates } from './store';

/**
 * 입력 초안 저장소 (page-state-memory §2.1-1·§2.4·§2.6-3) — `user_drafts` 읽기·쓰기는 이 모듈만 한다.
 * - 모든 함수는 userId 를 인자로 받고 `user_id = userId` 행만 읽고 쓴다. userId 는 호출하는 쪽(액션·RSC)이 세션에서만 정한다(§2.7-2).
 * - draft_key 화이트리스트 밖이면 쓰지도 읽지도 않는다.
 * - 쓰기: 현재 버전 + zod 화이트리스트를 통과한 값만(알 수 없는 필드·원가 필드는 버려진 뒤 저장), 50KB 를 넘으면 거부. 마지막 저장 우선.
 * - 읽기: 30일 지난 초안·버전 불일치·스키마 불일치·50KB 초과(변조)는 무시하고 그 행을 지운다.
 */
export type StoredDraft<K extends DraftKey> = { data: DraftOf<K>; updatedAt: Date };

export type DraftWriteResult = 'saved' | 'rejected';

const own = (userId: string, draftKey: string) =>
  and(eq(userDrafts.userId, userId), eq(userDrafts.draftKey, draftKey));

/** 저장된 초안 (없음·만료·폐기 대상이면 null — 만료·폐기 대상 행은 이때 지운다) */
export async function readDraft<K extends DraftKey>(
  db: Db,
  userId: string,
  draftKey: K,
  now: Date = new Date(),
): Promise<StoredDraft<K> | null> {
  if (!isDraftKey(draftKey)) return null;
  const [row] = await db
    .select({ version: userDrafts.version, data: userDrafts.data, updatedAt: userDrafts.updatedAt })
    .from(userDrafts)
    .where(own(userId, draftKey));
  if (!row) return null;
  const data =
    !isDraftExpired(row.updatedAt, now) && draftByteLength(row.data) <= DRAFT_MAX_BYTES
      ? parseDraft(draftKey, row.version, row.data)
      : null;
  if (!data) {
    await deleteDraft(db, userId, draftKey);
    return null;
  }
  return { data, updatedAt: row.updatedAt };
}

/** 초안 저장 (upsert, 마지막 저장 우선). 검증을 통과한 화이트리스트 값만 저장한다 */
export async function writeDraft(
  db: Db,
  userId: string,
  draftKey: string,
  version: number,
  data: unknown,
): Promise<DraftWriteResult> {
  if (!isDraftKey(draftKey)) return 'rejected';
  const parsed = parseDraft(draftKey, version, data);
  if (!parsed || draftByteLength(parsed) > DRAFT_MAX_BYTES) return 'rejected';
  const updatedAt = new Date();
  await db
    .insert(userDrafts)
    .values({ userId, draftKey, version: DRAFT_VERSIONS[draftKey], data: parsed, updatedAt })
    .onConflictDoUpdate({
      target: [userDrafts.userId, userDrafts.draftKey],
      set: { version: DRAFT_VERSIONS[draftKey], data: parsed, updatedAt },
    });
  return 'saved';
}

/** 초안 삭제 ('새로 시작'·'견적 초기화') */
export async function deleteDraft(db: Db, userId: string, draftKey: string): Promise<void> {
  if (!isDraftKey(draftKey)) return;
  await db.delete(userDrafts).where(own(userId, draftKey));
}

/**
 * 전역 초기화 (§2.6-3): 본인의 조회 상태(user_view_states)·입력 초안(user_drafts) 전부 삭제.
 * 표 열 너비·순서(#32)는 브라우저 localStorage 라 대상이 아니다.
 */
export async function clearSavedPageState(
  db: Db,
  userId: string,
): Promise<{ viewStates: number; drafts: number }> {
  const viewStates = await clearViewStates(db, userId);
  const drafts = await db
    .delete(userDrafts)
    .where(eq(userDrafts.userId, userId))
    .returning({ key: userDrafts.draftKey });
  return { viewStates, drafts: drafts.length };
}
