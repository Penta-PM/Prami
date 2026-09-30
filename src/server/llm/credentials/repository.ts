import 'server-only';

import { and, asc, eq, lt } from 'drizzle-orm';

import type { Db } from '@/db';
import { userLlmCredentials, userSettings } from '@/db/schema';
import type { Tx } from '@/db/tx';

import type { SealedSecret } from './crypto';

/**
 * 자격 증명 리포지토리 (PRAMI-002 §4.7.3 T-5·T-7). 모든 조회는 **세션 사용자 id** 로만 한다(입력 userId 없음).
 * 화면용 조회는 뷰 컬럼만 명시 선택한다 — `secret_*`·`dek_*` 는 `loadSealed`(서비스의 복호화 경로 전용)에서만 읽는다.
 */
type Executor = Db | Tx;

const viewColumns = {
  id: userLlmCredentials.id,
  vendor: userLlmCredentials.vendor,
  authType: userLlmCredentials.authType,
  keyHint: userLlmCredentials.keyHint,
  status: userLlmCredentials.status,
  kekVersion: userLlmCredentials.kekVersion,
  lastVerifiedAt: userLlmCredentials.lastVerifiedAt,
  lastErrorCode: userLlmCredentials.lastErrorCode,
  lastUsedAt: userLlmCredentials.lastUsedAt,
  availableModels: userLlmCredentials.availableModels,
  createdAt: userLlmCredentials.createdAt,
};

export type CredentialRow = {
  id: string;
  vendor: string;
  authType: 'api_key' | 'oauth_pkce';
  keyHint: string;
  status: 'unverified' | 'valid' | 'invalid' | 'forbidden' | 'rate_limited' | 'error';
  kekVersion: number;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
  lastUsedAt: Date | null;
  availableModels: string[] | null;
  createdAt: Date;
};

const ownRow = (userId: string, vendor: string) =>
  and(eq(userLlmCredentials.userId, userId), eq(userLlmCredentials.vendor, vendor));

export async function listCredentialRows(db: Executor, userId: string): Promise<CredentialRow[]> {
  return db
    .select(viewColumns)
    .from(userLlmCredentials)
    .where(eq(userLlmCredentials.userId, userId))
    .orderBy(asc(userLlmCredentials.vendor));
}

export async function findCredentialRow(
  db: Executor,
  userId: string,
  vendor: string,
): Promise<CredentialRow | null> {
  const [row] = await db.select(viewColumns).from(userLlmCredentials).where(ownRow(userId, vendor));
  return row ?? null;
}

export type SealedRow = CredentialRow & SealedSecret & { userId: string };

/** 암호문 포함 조회 — service.withDecryptedSecret·rewrap 전용 */
export async function loadSealed(
  db: Executor,
  userId: string,
  vendor: string,
): Promise<SealedRow | null> {
  const [row] = await db.select().from(userLlmCredentials).where(ownRow(userId, vendor));
  return row ?? null;
}

export type NewSealedRow = {
  id: string;
  userId: string;
  vendor: string;
  authType: 'api_key' | 'oauth_pkce';
  keyHint: string;
} & SealedSecret;

export async function insertSealed(tx: Executor, row: NewSealedRow): Promise<CredentialRow> {
  const [created] = await tx
    .insert(userLlmCredentials)
    .values({ ...row, status: 'unverified' })
    .returning(viewColumns);
  if (!created) throw new Error('자격 증명 저장 결과가 없습니다');
  return created;
}

export async function deleteOwn(
  tx: Executor,
  userId: string,
  vendor: string,
): Promise<CredentialRow | null> {
  const [deleted] = await tx
    .delete(userLlmCredentials)
    .where(ownRow(userId, vendor))
    .returning(viewColumns);
  return deleted ?? null;
}

export type StatusPatch = {
  status?: CredentialRow['status'];
  lastVerifiedAt?: Date;
  lastErrorCode: string | null;
  /** 검증 시 목록 ∩ 상수, null = 미확인 (r2 §4.5.2) */
  availableModels: string[] | null;
};

export async function updateOwnStatus(
  db: Executor,
  userId: string,
  vendor: string,
  patch: StatusPatch,
): Promise<CredentialRow | null> {
  const [updated] = await db
    .update(userLlmCredentials)
    .set({ ...patch, updatedAt: new Date() })
    .where(ownRow(userId, vendor))
    .returning(viewColumns);
  return updated ?? null;
}

/** 키 회전 대상 (활성 버전보다 낮은 행), 사용자 무관 — 시스템 스크립트 전용 */
export async function listBelowVersion(db: Executor, version: number, limit: number) {
  return db
    .select()
    .from(userLlmCredentials)
    .where(lt(userLlmCredentials.kekVersion, version))
    .orderBy(asc(userLlmCredentials.id))
    .limit(limit);
}

export async function updateWrap(
  tx: Executor,
  id: string,
  wrap: Pick<SealedSecret, 'dekWrapped' | 'dekIv' | 'dekTag' | 'kekVersion'>,
): Promise<void> {
  await tx
    .update(userLlmCredentials)
    .set({ ...wrap, updatedAt: new Date() })
    .where(eq(userLlmCredentials.id, id));
}

export async function getOwnSettings(db: Executor, userId: string) {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row ?? null;
}

export async function upsertOwnSettings(
  tx: Executor,
  userId: string,
  values: { chatDefaultVendor: string | null; chatDefaultModel: string | null },
) {
  const [row] = await tx
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row!;
}
