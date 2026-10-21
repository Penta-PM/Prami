'use server';

import { z } from 'zod';

import { getDb } from '@/db';
import type { DraftRestoreMap } from '@/features/calculator/types';
import {
  DRAFT_KEYS,
  DRAFT_MAX_BYTES,
  DRAFT_PERMISSIONS,
  draftByteLength,
  type DraftKey,
} from '@/lib/page-state/drafts';
import { fail, type ActionResult } from '@/lib/result';
import { runAction } from '@/server/auth/rbac';
import { restoreDraft } from '@/server/page-state/draft-restore';
import {
  clearSavedPageState,
  deleteDraft,
  writeDraft,
  type DraftWriteResult,
} from '@/server/page-state/drafts';

/**
 * 입력 초안 Server Actions (page-state-memory §2.4·§2.6·§2.7-2).
 * - draft_key 화이트리스트 밖은 VALIDATION. 그 화면을 여는 권한이 없으면 FORBIDDEN(+감사 denied).
 * - user_id 는 세션에서만 — 입력에 user_id 가 있어도 스키마에 없어 버려진다. 다른 사용자 행은 읽지도 쓰지도 않는다.
 * - 값 검증(버전·화이트리스트·50KB)은 저장소가 한다 — 통과하지 못하면 저장하지 않는다(rejected). 원가 필드는 저장 전에 버려진다.
 * - 감사 로그는 남기지 않는다(작성 중 입력 — 행위 아님).
 */
const draftKeySchema = z.enum(DRAFT_KEYS);

const saveSchema = z.object({
  draftKey: draftKeySchema,
  version: z.number().int().min(0).max(1000),
  data: z.unknown(),
});
const keySchema = z.object({ draftKey: draftKeySchema });

const invalid = () => fail('VALIDATION', '저장할 수 없는 입력 초안입니다');

export async function saveDraftAction(input: {
  draftKey: string;
  version: number;
  data: unknown;
}): Promise<ActionResult<{ status: DraftWriteResult }>> {
  const parsed = saveSchema.safeParse(input);
  // 한도를 크게 넘는 입력은 검증 전에 거부 (50KB 판정은 화이트리스트 통과 값으로 저장소가 다시 한다)
  if (!parsed.success || draftByteLength(parsed.data.data) > DRAFT_MAX_BYTES * 4) return invalid();
  const { draftKey, version, data } = parsed.data;
  return runAction(
    { permission: DRAFT_PERMISSIONS[draftKey], auditAction: 'draft.save', name: 'saveDraft' },
    async (user) => ({
      status: await writeDraft(await getDb(), user.id, draftKey, version, data),
    }),
  );
}

export async function deleteDraftAction(input: {
  draftKey: string;
}): Promise<ActionResult<{ status: 'deleted' }>> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { draftKey } = parsed.data;
  return runAction(
    { permission: DRAFT_PERMISSIONS[draftKey], auditAction: 'draft.delete', name: 'deleteDraft' },
    async (user) => {
      await deleteDraft(await getDb(), user.id, draftKey);
      return { status: 'deleted' as const };
    },
  );
}

/** 탭이 다시 보일 때 서버 초안 다시 읽기 (§2.4-5) — 복원과 같은 검증·재조회를 거친다 */
export async function readDraftAction<K extends DraftKey>(input: {
  draftKey: K;
}): Promise<ActionResult<DraftRestoreMap[K] | null>> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return invalid();
  const draftKey = parsed.data.draftKey as K;
  return runAction(
    { permission: DRAFT_PERMISSIONS[draftKey], auditAction: 'draft.read', name: 'readDraft' },
    async (user) => restoreDraft(await getDb(), user.id, draftKey),
  );
}

/**
 * 사용자 설정 > "저장된 화면·입력 초기화" (§2.6-3): 본인의 조회 상태·입력 초안 전부 삭제.
 * 표 열 너비·순서(#32 localStorage)는 대상이 아니다.
 */
export async function clearSavedPageStateAction(): Promise<
  ActionResult<{ viewStates: number; drafts: number }>
> {
  return runAction(
    { permission: 'settings.self', auditAction: 'page_state.clear', name: 'clearSavedPageState' },
    async (user) => clearSavedPageState(await getDb(), user.id),
  );
}
