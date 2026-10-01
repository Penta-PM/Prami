import 'server-only';

import { and, asc, count, eq, lt, sql } from 'drizzle-orm';

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
/**
 * 같은 사용자·벤더의 등록·교체를 직렬화한다 (QA L-3). 트랜잭션 끝에 자동 해제되는 advisory lock —
 * 행이 아직 없을 때도 걸리므로 "삭제 → 삽입" 사이 경합(UNIQUE 위반)을 막는다.
 */
export async function lockOwnVendor(tx: Tx, userId: string, vendor: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`llm-cred|${userId}|${vendor}`}))`);
}

/** 본인 행 전체(암호 컬럼 포함) — 서비스의 무결성 확인 전용 */
export async function listSealedRows(db: Executor, userId: string): Promise<SealedRow[]> {
  return db.select().from(userLlmCredentials).where(eq(userLlmCredentials.userId, userId));
}

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
  /** 검증 시 목록 ∩ 상수, null = 미확인 (r2 §4.5.2). 생략하면 그대로 둔다(챗봇 인증 오류 갱신) */
  availableModels?: string[] | null;
};

/** 챗봇 사용 기록 (§4.8.1): 성공 시 last_used_at 만, 1분 이내 재갱신은 생략 (요청당 최대 1 UPDATE) */
export async function touchLastUsed(
  db: Executor,
  userId: string,
  vendor: string,
  credentialId: string,
): Promise<void> {
  await db
    .update(userLlmCredentials)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        ownRow(userId, vendor),
        eq(userLlmCredentials.id, credentialId),
        sql`(${userLlmCredentials.lastUsedAt} is null or ${userLlmCredentials.lastUsedAt} < now() - interval '1 minute')`,
      ),
    );
}

/**
 * 검증 결과 기록 — **검증한 그 행(id)** 에만 (QA L-3). 검증 도중 키가 교체되면 새 행 id 가 달라 0건이 되고 null 을 돌려준다.
 */
export async function updateOwnStatus(
  db: Executor,
  userId: string,
  vendor: string,
  credentialId: string,
  patch: StatusPatch,
): Promise<CredentialRow | null> {
  const [updated] = await db
    .update(userLlmCredentials)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(ownRow(userId, vendor), eq(userLlmCredentials.id, credentialId)))
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

/** 전체 자격 증명 행 수 — data:verify --fresh(클린 설치 직후 0, PRAMI-003 §4.9.2). 개수만 */
export async function countAllCredentials(db: Executor): Promise<number> {
  const [row] = await db.select({ total: count() }).from(userLlmCredentials);
  return row?.total ?? 0;
}

/** rewrap 대상 건수 (활성 버전보다 낮은 KEK 로 감싼 행) — `credentials:rewrap` 확인 출력용 (PRAMI-003 §4.3.4) */
export async function countBelowVersion(db: Executor, version: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(userLlmCredentials)
    .where(lt(userLlmCredentials.kekVersion, version));
  return row?.total ?? 0;
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
