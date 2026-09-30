import 'server-only';

import { randomUUID } from 'node:crypto';

import type { DbHandle } from '@/db';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';

import { verifyCredential, type VerifyResult } from '../verify';
import { findVendor, isAcceptableKey, type LlmVendor } from '../vendors/registry';
import { CredentialUnreadableError, openSecret, sealSecret } from './crypto';
import type { KeyProvider } from './keyring';
import { maskKey } from './mask';
import {
  deleteOwn,
  findCredentialRow,
  insertSealed,
  loadSealed,
  updateOwnStatus,
  type CredentialRow,
} from './repository';
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
};

export const KEYRING_MISSING_MESSAGE =
  '서버에 암호화 키가 설정되지 않아 LLM 키를 등록할 수 없습니다 (관리자 문의)';
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
async function storeSealed(ctx: CredentialsContext, vendor: LlmVendor, apiKey: string) {
  const keys = requireKeys(ctx);
  const keyHint = maskKey(vendor, apiKey);
  if (!keyHint) throw new AppError('VALIDATION', KEY_FORMAT_MESSAGE);
  const userId = ctx.actor.id;
  return withTransaction(async (tx) => {
    const before = await deleteOwn(tx, userId, vendor.id);
    const id = randomUUID();
    const aad = { credentialId: id, userId, vendor: vendor.id, authType: 'api_key' as const };
    const created = await insertSealed(tx, {
      id,
      userId,
      vendor: vendor.id,
      authType: 'api_key',
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
  if (!isAcceptableKey(vendor, input.apiKey, ctx.mode === 'fake')) {
    throw new AppError('VALIDATION', KEY_FORMAT_MESSAGE);
  }
  // 저장 직후 자동 검증도 벤더 호출이므로 같은 상한(llmVerify)에 센다 — 저장 경로로 "키 오라클" 상한을 우회하지 못하게.
  // 상한 초과면 저장하지 않는다(DB·벤더 호출 모두 없음)
  assertVerifyAllowed(ctx.actor.id);
  await storeSealed(ctx, vendor, input.apiKey);
  // 저장 성공 시 자동 검증 1회 (§4.6.1)
  return runVerify(ctx, vendor);
}

/** 사용자당 분당 LLM_VERIFY_PER_MIN (§4.7.3 키 오라클 방지). 수동 검증·저장 후 자동 검증 모두 1회로 센다 */
function assertVerifyAllowed(userId: string): void {
  const decision = rateLimiters.llmVerify.hit(userId);
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
  ctx: Pick<CredentialsContext, 'handle' | 'keys'>,
  userId: string,
  vendor: string,
  fn: (secret: string) => Promise<T>,
): Promise<T> {
  const row = await loadSealed(ctx.handle.db, userId, vendor);
  if (!row) throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  if (!ctx.keys) throw new CredentialUnreadableError('kek_missing');
  const aad = { credentialId: row.id, userId, vendor, authType: row.authType };
  return fn(openSecret(row, aad, ctx.keys));
}

function statusPatch(result: VerifyResult, now: Date) {
  if (result.outcome === 'error') return { lastErrorCode: result.errorCode };
  return { status: result.outcome, lastVerifiedAt: now, lastErrorCode: result.errorCode };
}

async function runVerify(ctx: CredentialsContext, vendor: LlmVendor): Promise<CredentialView> {
  const userId = ctx.actor.id;
  let result: VerifyResult | 'unreadable';
  try {
    result = await withDecryptedSecret(ctx, userId, vendor.id, (secret) =>
      verifyCredential(vendor, secret, { mode: ctx.mode }),
    );
  } catch (error) {
    if (!(error instanceof CredentialUnreadableError)) throw error;
    result = 'unreadable';
  }
  return recordVerify(ctx, vendor, result);
}

async function recordVerify(
  ctx: CredentialsContext,
  vendor: LlmVendor,
  result: VerifyResult | 'unreadable',
): Promise<CredentialView> {
  const userId = ctx.actor.id;
  const updated =
    result === 'unreadable'
      ? await findCredentialRow(ctx.handle.db, userId, vendor.id)
      : await updateOwnStatus(ctx.handle.db, userId, vendor.id, statusPatch(result, new Date()));
  if (!updated) throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  const outcome = result === 'unreadable' ? 'unreadable' : result.outcome;
  await writeAudit(ctx.handle.db, {
    actor: ctx.actor,
    action: AUDIT_ACTIONS.llmCredentialVerify,
    target: { type: 'llm_credential', id: vendor.id, label: vendor.label },
    after: { vendor: vendor.id, status: updated.status, outcome },
    result: outcome === 'valid' ? 'success' : 'error',
    meta: ctx.meta,
  });
  return toCredentialView(updated, ctx.keys, result === 'unreadable');
}

export async function verifyOwnCredential(
  ctx: CredentialsContext,
  input: { vendor: string },
): Promise<CredentialView> {
  const vendor = requireVendor(input.vendor);
  if (!(await findCredentialRow(ctx.handle.db, ctx.actor.id, vendor.id))) {
    throw new AppError('NOT_FOUND', '등록된 키가 없습니다');
  }
  assertVerifyAllowed(ctx.actor.id);
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
    return { deleted: true as const };
  }, ctx.handle);
}
