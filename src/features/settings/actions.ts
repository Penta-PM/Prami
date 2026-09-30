'use server';

import { z } from 'zod';

import { getDbHandle } from '@/db';
import { env } from '@/env';
import type { ActionResult } from '@/lib/result';
import { AUDIT_ACTIONS } from '@/server/audit/log';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { signIn } from '@/server/auth/auth';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import {
  deleteOwnCredential,
  saveCredential,
  verifyOwnCredential,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { updateChatDefaults, type ChatDefaultsView } from '@/server/llm/credentials/settings';
import type { CredentialView } from '@/server/llm/credentials/view';

/**
 * 사용자 설정 Server Actions (PRAMI-002 §4.12). 권한 `settings.self`, 대상은 항상 세션 사용자 본인.
 * 입력 스키마는 모두 `.strict()` — `userId` 같은 추가 필드는 VALIDATION (AC-205). 오류 메시지에 입력값을 넣지 않는다(T-6).
 * 반환값은 `CredentialView`(힌트까지) — 키·암호문은 어떤 경로로도 돌려주지 않는다(AC-204).
 */
const vendorField = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, '벤더 형식이 올바르지 않습니다');

const saveSchema = z
  .object({
    vendor: vendorField,
    apiKey: z
      .string()
      .trim()
      .min(16, 'API 키는 16자 이상입니다')
      .max(256, 'API 키는 256자 이하입니다')
      .regex(/^[A-Za-z0-9_\-.]+$/, 'API 키에 허용되지 않는 문자가 있습니다'),
  })
  .strict();
const vendorSchema = z.object({ vendor: vendorField }).strict();
const defaultsSchema = z
  .object({ vendor: vendorField, model: z.string().trim().min(1).max(100) })
  .strict();

function context(
  actor: SessionUser,
  handle: CredentialsContext['handle'],
  meta: CredentialsContext['meta'],
): CredentialsContext {
  return {
    handle,
    actor: { id: actor.id, label: actor.email },
    meta,
    keys: keyringFromEnv(env),
    mode: env.LLM_VENDOR_MODE,
    flags: { oauthOpenRouter: env.LLM_OAUTH_OPENROUTER },
  };
}

async function buildContext(actor: SessionUser): Promise<CredentialsContext> {
  return context(actor, await getDbHandle(), await currentRequestMeta());
}

export async function saveLlmCredentialAction(
  input: unknown,
): Promise<ActionResult<CredentialView>> {
  return runAction(
    {
      permission: 'settings.self',
      auditAction: AUDIT_ACTIONS.llmCredentialCreate,
      name: 'saveLlmCredential',
    },
    async (actor) => saveCredential(await buildContext(actor), saveSchema.parse(input)),
  );
}

export async function verifyLlmCredentialAction(
  input: unknown,
): Promise<ActionResult<CredentialView>> {
  return runAction(
    {
      permission: 'settings.self',
      auditAction: AUDIT_ACTIONS.llmCredentialVerify,
      name: 'verifyLlmCredential',
    },
    async (actor) => verifyOwnCredential(await buildContext(actor), vendorSchema.parse(input)),
  );
}

export async function deleteLlmCredentialAction(
  input: unknown,
): Promise<ActionResult<{ deleted: true }>> {
  return runAction(
    {
      permission: 'settings.self',
      auditAction: AUDIT_ACTIONS.llmCredentialDelete,
      name: 'deleteLlmCredential',
    },
    async (actor) => deleteOwnCredential(await buildContext(actor), vendorSchema.parse(input)),
  );
}

export async function updateChatDefaultsAction(
  input: unknown,
): Promise<ActionResult<ChatDefaultsView>> {
  return runAction(
    {
      permission: 'settings.self',
      auditAction: AUDIT_ACTIONS.llmDefaultUpdate,
      name: 'updateChatDefaults',
    },
    async (actor) => updateChatDefaults(await buildContext(actor), defaultsSchema.parse(input)),
  );
}

/** 계정 연결 섹션 "Google 계정으로 다시 로그인" (§4.6.1 ①, AC-209) — 계정 전환·세션 갱신. JWT 세션은 새 로그인으로 교체된다 */
export async function reloginWithGoogleAction(): Promise<void> {
  await signIn('google', { redirectTo: '/settings' });
}
