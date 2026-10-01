import 'server-only';

import { randomUUID } from 'node:crypto';

import type { DbHandle } from '@/db';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';

import { verifyCredential, type VerifyResult } from '../verify';
import {
  acceptsApiKey,
  findVendor,
  isAcceptableKey,
  isVendorActive,
  VENDOR_FLAGS_OFF,
  type LlmAuthType,
  type LlmVendor,
  type VendorFlags,
} from '../vendors/registry';
import { CredentialUnreadableError, isSealedIntact, openSecret, sealSecret } from './crypto';
import type { KeyProvider } from './keyring';
import { maskKey } from './mask';
import {
  deleteOwn,
  findCredentialRow,
  insertSealed,
  listSealedRows,
  loadSealed,
  lockOwnVendor,
  updateOwnStatus,
  type CredentialRow,
} from './repository';
import { EXPIRED_ERROR_CODE, isCredentialExpired } from './expiry';
import { toCredentialView, type CredentialView } from './view';

/**
 * 자격 증명 서비스 (PRAMI-002 §4.7). 모든 연산의 대상은 `ctx.actor.id`(세션 사용자) 한 명이다 — 입력에 userId 가 없다(I-4).
 * 평문 키는 `saveCredential` 의 인자와 `withDecryptedSecret` 콜백 안에만 존재하고, 반환값은 항상 `CredentialView`(힌트까지)다.
 * 감사에는 `{vendor, authType, status, kekVersion}` 만 남긴다(값·힌트 없음, T-4).
 */
export type CredentialsContext = {
  handle: DbHandle;
  actor: AuditActor & { id: string };
  meta: RequestMeta;
  keys: KeyProvider | null;
  mode: 'live' | 'fake';
  /** 벤더 노출 플래그 (env) — 없으면 모두 off. off 벤더 키는 검증·기본값 지정 불가, 삭제만 가능 (QA L-3) */
  flags?: VendorFlags;
};

export const KEYRING_MISSING_MESSAGE =
  '서버에 암호화 키가 설정되지 않아 LLM 키를 등록할 수 없습니다 (관리자 문의)';
const OAUTH_ONLY_MESSAGE = '이 벤더는 OAuth 연결로만 등록할 수 있습니다';
export const VENDOR_DISABLED_MESSAGE =
  '이 연결은 현재 관리자 설정으로 꺼져 있어 사용할 수 없습니다. 연결 해제(삭제)만 할 수 있습니다';

/** 플래그 off 벤더면 VALIDATION (삭제 경로에는 쓰지 않는다) */
export function assertVendorActive(
  ctx: Pick<CredentialsContext, 'flags'>,
  vendor: LlmVendor,
): void {
  if (!isVendorActive(vendor, ctx.flags ?? VENDOR_FLAGS_OFF)) {
    throw new AppError('VALIDATION', VENDOR_DISABLED_MESSAGE);
  }
}
const KEY_FORMAT_MESSAGE = 'API 키 형식이 올바르지 않습니다 (16~256자, 영문·숫자·- _ . 만)';

export function requireVendor(id: string): LlmVendor {
  const vendor = findVendor(id);
  if (!vendor) throw new AppError('VALIDATION', '지원하지 않는 LLM 벤더입니다');
  return vendor;
}

function requireKeys(ctx: CredentialsContext): KeyProvider {
  if (!ctx.keys) throw new AppError('CONFLICT', KEYRING_MISSING_MESSAGE);
  return ctx.keys;
}

const auditShape = (row: Pick<CredentialRow, 'vendor' | 'authType' | 'status' | 'kekVersion'>) => ({
  vendor: row.vendor,
  authType: row.authType,
  status: row.status,
  kekVersion: row.kekVersion,
});

/** 등록·교체: 교체는 새 id·새 DEK 로 한 트랜잭션에서 옛 행 삭제 + 새 행 삽입 (§4.7.1) */
async function storeSealed(
  ctx: CredentialsContext,
  vendor: LlmVendor,
  apiKey: string,
  authType: LlmAuthType = 'api_key',
) {
  const keys = requireKeys(ctx);
  const keyHint = maskKey(vendor, apiKey);
  if (!keyHint) throw new AppError('VALIDATION', KEY_FORMAT_MESSAGE);
  const userId = ctx.actor.id;
  return withTransaction(async (tx) => {
    await lockOwnVendor(tx, userId, vendor.id);
    const before = await deleteOwn(tx, userId, vendor.id);
    const id = randomUUID();
    const aad = { credentialId: id, userId, vendor: vendor.id, authType };
    const created = await insertSealed(tx, {
      id,
      userId,
      vendor: vendor.id,
      authType,
      keyHint,
      ...sealSecret(apiKey, aad, keys),
    });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: before ? AUDIT_ACTIONS.llmCredentialReplace : AUDIT_ACTIONS.llmCredentialCreate,
      target: { type: 'llm_credential', id: vendor.id, label: vendor.label },
      before: before ? auditShape(before) : null,
      after: auditShape(created),
      meta: ctx.meta,
    });
    return created;
  }, ctx.handle);
}

export async function saveCredential(
  ctx: CredentialsContext,
  input: { vendor: string; apiKey: string },
): Promise<CredentialView> {
  const vendor = requireVendor(input.vendor);
  // OAuth 전용 벤더(OpenRouter)는 키 직접 입력을 받지 않는다 — PKCE 콜백 경로(saveOAuthCredential)만
  if (!acceptsApiKey(vendor)) throw new AppError('VALIDATION', OAUTH_ONLY_MESSAGE);
  if (!isAcceptableKey(vendor, input.apiKey, ctx.mode === 'fake')) {
    throw new AppError('VALIDATION', KEY_FORMAT_MESSAGE);
  }
  // 저장 직후 자동 검증도 벤더 호출이므로 같은 상한(llmVerify)에 센다 — 저장 경로로 "키 오라클" 상한을 우회하지 못하게.
  // 상한 초과면 저장하지 않는다(DB·벤더 호출 모두 없음)
  await assertVerifyAllowed(ctx.actor.id);
  await storeSealed(ctx, vendor, input.apiKey);
  // 저장 성공 시 자동 검증 1회 (§4.6.1)
  return runVerify(ctx, vendor);
}

/**
 * OAuth PKCE 교환으로 받은 키 저장 (PRAMI-002 §4.6.2, PR-C) — 봉투 암호화(PR-A)를 그대로 쓰고 auth_type='oauth_pkce',
 * 감사 `settings.oauth.connect`(값 없이 벤더만). 교환 응답의 키는 이 함수 인자와 암호화 과정에만 있다.
 * 자동 검증은 하지 않는다(교환 자체가 벤더 발급 확인) — 상태는 검증 대기, 사용자가 [검증] 또는 챗봇 사용 시 판정.
 */
export async function saveOAuthCredential(
  ctx: CredentialsContext,
  input: { vendor: string; apiKey: string },
): Promise<CredentialView> {
  const vendor = requireVendor(input.vendor);
  if (!vendor.authTypes.includes('oauth_pkce'))
    throw new AppError('VALIDATION', OAUTH_ONLY_MESSAGE);
  const created = await storeSealed(ctx, vendor, input.apiKey, 'oauth_pkce');
  await writeAudit(ctx.handle.db, {
    actor: ctx.actor,
    action: AUDIT_ACTIONS.oauthConnect,
    target: { type: 'llm_credential', id: vendor.id, label: vendor.label },
    after: { vendor: vendor.id },
    meta: ctx.meta,
  });
  return toCredentialView(created, ctx.keys);
}

/** 사용자당 분당 LLM_VERIFY_PER_MIN (§4.7.3 키 오라클 방지). 수동 검증·저장 후 자동 검증 모두 1회로 센다 */
async function assertVerifyAllowed(userId: string): Promise<void> {
  const decision = await rateLimiters.llmVerify.hit(userId);
  if (decision.allowed) return;
  const seconds = retryAfterSeconds(decision);
  throw new AppError(
    'RATE_LIMITED',
    `검증 요청이 너무 잦습니다. ${seconds}초 후 다시 시도하세요`,
    undefined,
    { retryAfterSeconds: seconds },
  );
}

/** 복호화는 이 함수 하나로만 (§4.7.1). 평문은 콜백 안에서만 존재한다 */
export async function withDecryptedSecret<T>(
  ctx: { handle: Pick<DbHandle, 'db'>; keys: KeyProvider | null },
  userId: string,
  vendor: string,
  fn: (secret: string, credentialId: string) => Promise<T>,
): Promise<T> {
  const row = await loadSealed(ctx.handle.db, userId, vendor);
  if (!row) throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  if (!ctx.keys) throw new CredentialUnreadableError('kek_missing');
  const aad = { credentialId: row.id, userId, vendor, authType: row.authType };
  return fn(openSecret(row, aad, ctx.keys), row.id);
}

/**
 * 읽을 수 없는 본인 자격 증명의 벤더 (QA L-1). 변조(무결성 실패)·KEK 누락 행은 DB 상태와 무관하게 조회 시점에 "unreadable".
 * 키링이 없으면 전부 읽을 수 없다.
 */
export async function unreadableVendors(
  db: DbHandle['db'],
  userId: string,
  keys: KeyProvider | null,
): Promise<Set<string>> {
  const rows = await listSealedRows(db, userId);
  const broken = rows.filter(
    (row) =>
      !keys ||
      !isSealedIntact(
        row,
        { credentialId: row.id, userId, vendor: row.vendor, authType: row.authType },
        keys,
      ),
  );
  return new Set(broken.map((row) => row.vendor));
}

function statusPatch(result: VerifyResult, now: Date) {
  // 사용 가능 모델은 정상 + 목록 전체를 읽었을 때만, 그 밖(목록 실패·비정상 판정)은 NULL = 미확인 (AC-207 ⑦)
  const availableModels = result.availableModels;
  if (result.outcome === 'error') return { lastErrorCode: result.errorCode, availableModels };
  return {
    status: result.outcome,
    lastVerifiedAt: now,
    lastErrorCode: result.errorCode,
    availableModels,
  };
}

/** 만료된 자격 증명은 벤더를 호출하지 않고 invalid·code=expired 로 기록한다 (PRAMI-003 §4.4.4, AC-346) */
const EXPIRED_RESULT: VerifyResult = {
  outcome: 'invalid',
  errorCode: EXPIRED_ERROR_CODE,
  availableModels: null,
};

async function runVerify(ctx: CredentialsContext, vendor: LlmVendor): Promise<CredentialView> {
  const userId = ctx.actor.id;
  let result: VerifyResult | 'unreadable';
  let credentialId: string | null = null;
  const current = await findCredentialRow(ctx.handle.db, userId, vendor.id);
  if (current && isCredentialExpired(current)) {
    return recordVerify(ctx, vendor, EXPIRED_RESULT, current.id);
  }
  try {
    result = await withDecryptedSecret(ctx, userId, vendor.id, (secret, id) => {
      credentialId = id;
      return verifyCredential(vendor, secret, { mode: ctx.mode });
    });
  } catch (error) {
    if (!(error instanceof CredentialUnreadableError)) throw error;
    result = 'unreadable';
  }
  return recordVerify(ctx, vendor, result, credentialId);
}

async function recordVerify(
  ctx: CredentialsContext,
  vendor: LlmVendor,
  result: VerifyResult | 'unreadable',
  credentialId: string | null,
): Promise<CredentialView> {
  const userId = ctx.actor.id;
  const written =
    result === 'unreadable' || !credentialId
      ? null
      : await updateOwnStatus(
          ctx.handle.db,
          userId,
          vendor.id,
          credentialId,
          statusPatch(result, new Date()),
        );
  // 검증 도중 교체됐으면(행 id 불일치) 결과를 쓰지 않고 현재 행을 그대로 보여준다 (QA L-3)
  const superseded = result !== 'unreadable' && !written;
  const updated = written ?? (await findCredentialRow(ctx.handle.db, userId, vendor.id));
  if (!updated) throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  const outcome = result === 'unreadable' ? 'unreadable' : result.outcome;
  await writeAudit(ctx.handle.db, {
    actor: ctx.actor,
    action: AUDIT_ACTIONS.llmCredentialVerify,
    target: { type: 'llm_credential', id: vendor.id, label: vendor.label },
    after: {
      vendor: vendor.id,
      status: updated.status,
      outcome,
      ...(result !== 'unreadable' &&
        result.errorCode === EXPIRED_ERROR_CODE && { code: EXPIRED_ERROR_CODE }),
      ...(superseded && { superseded }),
    },
    result: outcome === 'valid' ? 'success' : 'error',
    meta: ctx.meta,
  });
  return toCredentialView(updated, ctx.keys, result === 'unreadable' && !superseded);
}

export async function verifyOwnCredential(
  ctx: CredentialsContext,
  input: { vendor: string },
): Promise<CredentialView> {
  const vendor = requireVendor(input.vendor);
  if (!(await findCredentialRow(ctx.handle.db, ctx.actor.id, vendor.id))) {
    throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  }
  assertVendorActive(ctx, vendor);
  await assertVerifyAllowed(ctx.actor.id);
  return runVerify(ctx, vendor);
}

/** 즉시 파기 (soft delete 없음, AC-206) */
export async function deleteOwnCredential(
  ctx: CredentialsContext,
  input: { vendor: string },
): Promise<{ deleted: true }> {
  // 레지스트리에서 빠진(지원 종료) 벤더 행도 삭제할 수 있어야 한다 — 형식만 검사
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(input.vendor))
    throw new AppError('VALIDATION', '지원하지 않는 LLM 벤더입니다');
  return withTransaction(async (tx) => {
    const before = await deleteOwn(tx, ctx.actor.id, input.vendor);
    if (!before) throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_ACTIONS.llmCredentialDelete,
      target: {
        type: 'llm_credential',
        id: input.vendor,
        label: findVendor(input.vendor)?.label ?? input.vendor,
      },
      before: { vendor: before.vendor, authType: before.authType },
      after: null,
      meta: ctx.meta,
    });
    // OAuth 연결 해제 = 자격 증명 삭제 (§4.6.2 ③) — 벤더 측 키 폐기는 콘솔 링크로 안내
    if (before.authType === 'oauth_pkce') {
      await writeAudit(tx, {
        actor: ctx.actor,
        action: AUDIT_ACTIONS.oauthDisconnect,
        target: { type: 'llm_credential', id: input.vendor, label: input.vendor },
        before: { vendor: before.vendor },
        after: null,
        meta: ctx.meta,
      });
    }
    return { deleted: true as const };
  }, ctx.handle);
}
