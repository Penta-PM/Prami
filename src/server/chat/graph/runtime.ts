import 'server-only';

import type { Db } from '@/db';
import type { Env } from '@/env';
import {
  markChatCredentialRejected,
  markChatCredentialUsed,
  resolveChatCredential,
} from '@/server/llm/credentials/chat';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';

import { modelLabel } from '@/server/llm/models';

import { buildChatGraph } from './build';
import { setupFor, unsupportedVendorsMessage } from './messages';
import type { ChatRuntime, ChatSettings, SetupStatus } from './types';

/**
 * 요청별 ChatRuntime (PRAMI-002 §4.3.1) — env 상한·스위치와 본인 자격 증명 해석 함수. 키 문자열 필드는 없다(I-3).
 * 그래프는 모듈 로드 시 1회 컴파일한다.
 */
export const chatGraph = buildChatGraph();

type LlmEnv = Pick<
  Env,
  | 'CHAT_LLM_ENABLED'
  | 'CHAT_RULE_FALLBACK'
  | 'CHAT_LLM_MAX_TOOL_CALLS'
  | 'CHAT_LLM_MAX_OUTPUT_TOKENS'
  | 'CHAT_LLM_TIMEOUT_MS'
  | 'CHAT_HISTORY_MAX_TURNS'
  | 'LLM_CREDENTIALS_KEKS'
  | 'LLM_CREDENTIALS_ACTIVE_KEK'
  | 'LLM_VENDOR_MODE'
  | 'LLM_OAUTH_OPENROUTER'
>;

export function chatSettingsFromEnv(env: LlmEnv): ChatSettings {
  return {
    llmEnabled: env.CHAT_LLM_ENABLED,
    ruleFallback: env.CHAT_RULE_FALLBACK,
    maxToolCalls: env.CHAT_LLM_MAX_TOOL_CALLS,
    maxOutputTokens: env.CHAT_LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: env.CHAT_LLM_TIMEOUT_MS,
    historyMaxTurns: env.CHAT_HISTORY_MAX_TURNS,
  };
}

export function createChatRuntime(input: { db: Db; userId: string; env: LlmEnv }): ChatRuntime {
  const { db, userId, env } = input;
  return {
    db,
    settings: chatSettingsFromEnv(env),
    resolveCredential: () =>
      resolveChatCredential({
        db,
        userId,
        keys: keyringFromEnv(env),
        mode: env.LLM_VENDOR_MODE,
        flags: { oauthOpenRouter: env.LLM_OAUTH_OPENROUTER },
      }),
    markRejected: (credential, status) =>
      markChatCredentialRejected(db, userId, credential, status),
    markUsed: (credential) => markChatCredentialUsed(db, userId, credential),
    credential: null,
    llmCalls: 0,
  };
}

const SETUP_STATUSES = new Set(['missing', 'invalid', 'forbidden', 'unreadable']);

/** GET /api/chat/status (§4.3.11): 키·힌트 없이 상태만. 설정이 필요하면 배너 문구(setup, §4.9)를 함께 준다 */
export async function chatStatus(input: { db: Db; userId: string; env: LlmEnv }) {
  const settings = chatSettingsFromEnv(input.env);
  if (!settings.llmEnabled) {
    return {
      llm: { status: 'disabled', vendor: null, model: null },
      ruleFallback: settings.ruleFallback,
    };
  }
  const credential = await resolveChatCredential({
    db: input.db,
    userId: input.userId,
    keys: keyringFromEnv(input.env),
    mode: input.env.LLM_VENDOR_MODE,
    flags: { oauthOpenRouter: input.env.LLM_OAUTH_OPENROUTER },
  });
  const needsSetup = SETUP_STATUSES.has(credential.status);
  const model =
    credential.vendor && credential.model
      ? modelLabel(credential.vendor, credential.model)
      : undefined;
  const setup = needsSetup
    ? setupFor(credential.status as SetupStatus, {
        vendor: credential.vendorLabel ?? undefined,
        model,
      })
    : undefined;
  const unsupported = credential.unsupportedVendorLabels;
  return {
    llm: { status: credential.status, vendor: credential.vendor, model: credential.model },
    ruleFallback: settings.ruleFallback,
    ...(setup
      ? {
          setup:
            credential.status === 'missing' && unsupported.length > 0
              ? { ...setup, message: unsupportedVendorsMessage(unsupported) }
              : setup,
        }
      : {}),
  };
}
