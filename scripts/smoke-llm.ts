/**
 * [선택] 실벤더 스모크 (PRAMI-002 AC-246, PR-C) — `pnpm smoke:llm`. **CI 에서 실행하지 않는다.**
 * 개발자 로컬 env 에 키가 있는 벤더만: ① 검증 호출(목록 API — 토큰 미소비) ② 그래프로 "Wapples-500 가격" 1회(판매단가 도구 사용).
 * 키가 없는 벤더는 skip 을 출력한다. 결과는 벤더·모델·성공 여부·토큰 수만 출력한다 — **키 값은 어디에도 출력·저장하지 않는다.**
 * DB 는 현재 env(DB_DRIVER·DATABASE_URL)의 판매단가를 읽는다(쓰기 없음). 사용자 자격 증명 테이블은 쓰지 않는다.
 *
 * 키 env 이름: ANTHROPIC_API_KEY · OPENAI_API_KEY · GOOGLE_API_KEY(또는 GEMINI_API_KEY) · OPENROUTER_API_KEY
 */
import type { LLMResult } from '@langchain/core/outputs';

import { getDb } from '@/db';
import { env } from '@/env';
import { buildChatGraph } from '@/server/chat/graph/build';
import { initialState, runConfig } from '@/server/chat/graph/run';
import { chatSettingsFromEnv } from '@/server/chat/graph/runtime';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { defaultModelFor } from '@/server/llm/models';
import { verifyCredential } from '@/server/llm/verify';
import { findVendor, type LlmVendor } from '@/server/llm/vendors/registry';

const KEY_ENV: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
};

type SmokeResult = {
  vendor: string;
  model: string | null;
  verify: string;
  chat: string;
  inputTokens: number;
  outputTokens: number;
};

function keyFor(vendorId: string): string | undefined {
  return KEY_ENV[vendorId]?.map((name) => process.env[name]).find((value) => value && value.trim());
}

function runtimeFor(
  vendor: LlmVendor,
  secret: string,
  model: string,
  db: ChatRuntime['db'],
): ChatRuntime {
  const credential = {
    status: 'ready' as const,
    vendor: vendor.id,
    vendorLabel: vendor.label,
    model,
    credentialId: null,
    createModel: (options: Parameters<NonNullable<LlmVendor['createChatModel']>>[2]) =>
      vendor.createChatModel!(secret, model, options),
    unsupportedVendorLabels: [],
  };
  return {
    db,
    settings: { ...chatSettingsFromEnv(env), llmEnabled: true },
    resolveCredential: async () => credential,
    markRejected: async () => undefined,
    markUsed: async () => undefined,
    credential: null,
    llmCalls: 0,
  };
}

async function chatOnce(vendor: LlmVendor, secret: string, model: string) {
  const usage = { input: 0, output: 0 };
  const handler = {
    handleLLMEnd(output: LLMResult) {
      for (const generation of output.generations.flat()) {
        const meta = (
          generation as {
            message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } };
          }
        ).message?.usage_metadata;
        usage.input += meta?.input_tokens ?? 0;
        usage.output += meta?.output_tokens ?? 0;
      }
    },
  };
  const runtime = runtimeFor(vendor, secret, model, await getDb());
  const input = {
    text: 'Wapples-500 가격',
    truncated: false,
    history: [],
    actor: { userId: 'smoke', role: 'USER' as const },
  };
  const result = await buildChatGraph().invoke(initialState(input), {
    ...runConfig(runtime),
    callbacks: [handler],
  });
  const reply = result.reply as ChatReplyOut;
  return { reply, usage };
}

async function smoke(vendorId: string): Promise<SmokeResult | null> {
  const vendor = findVendor(vendorId);
  const secret = keyFor(vendorId);
  if (!vendor?.createChatModel || !secret) return null;
  const model = defaultModelFor(vendorId);
  const verified = await verifyCredential(vendor, secret, { mode: 'live' });
  const { reply, usage } = await chatOnce(vendor, secret, model ?? '');
  const chat =
    reply.mode === 'llm'
      ? `ok (${reply.intent})`
      : `fail (${reply.mode}/${reply.setup?.status ?? 'none'})`;
  return {
    vendor: vendorId,
    model,
    verify: verified.outcome,
    chat,
    inputTokens: usage.input,
    outputTokens: usage.output,
  };
}

async function main() {
  const results: SmokeResult[] = [];
  for (const vendorId of Object.keys(KEY_ENV)) {
    const result = await smoke(vendorId);
    if (!result) {
      console.log(`[smoke:llm] ${vendorId}: skip (키 env 없음)`);
      continue;
    }
    results.push(result);
    console.log(`[smoke:llm] ${JSON.stringify(result)}`);
  }
  if (results.length === 0) console.log('[smoke:llm] 실행한 벤더 없음 — 모두 skip');
  process.exit(
    results.every((result) => result.verify === 'valid' && result.chat.startsWith('ok')) ? 0 : 1,
  );
}

main().catch((error: unknown) => {
  // 예외 메시지에 벤더 원문(키 반복 가능)이 섞일 수 있어 이름만 출력한다
  console.error(`[smoke:llm] 실패: ${error instanceof Error ? error.name : 'unknown'}`);
  process.exit(1);
});
