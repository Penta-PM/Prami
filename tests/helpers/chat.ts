import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { vi } from 'vitest';

import type { DbHandle } from '@/db';
import type { ChatFeature } from '@/server/chat/features/types';
import { buildChatGraph } from '@/server/chat/graph/build';
import { runChat } from '@/server/chat/graph/run';
import type { ChatRuntime, ChatSettings } from '@/server/chat/graph/types';
import { applyPolicy } from '@/server/imports/apply-policy';
import type { ChatCredentialStatus, ResolvedChatCredential } from '@/server/llm/credentials/chat';

import { TEST_ACTOR, TEST_META, uploadFixture } from './imports';
import { createTestDb, insertUser } from './pglite';

/** 챗봇 그래프 테스트 공용 (PRAMI-002 §9.2): PGlite + 판매단가 200행 픽스처 + USER·ADMIN, 스크립트 모델 런타임, SQL 수집 */
export const DEFAULT_SETTINGS: ChatSettings = {
  llmEnabled: true,
  ruleFallback: true,
  maxToolCalls: 4,
  maxOutputTokens: 1024,
  timeoutMs: 2000,
  historyMaxTurns: 10,
};

/**
 * 벤더 오류 재시도 경로 전용 설정. LangChain AsyncCaller(p-retry, randomize)의 첫 재시도 대기가 1000~2000ms 라
 * 기본 timeoutMs 2000 과 경합해, 고부하·운 나쁜 지터에서 5xx·429·fetch failed 가 'timeout' 으로 분류되던 타이밍 flake 를
 * 막는다 (CI 사용량 절감 PR-C — xai-adapter 503, llm-diagnostics-r2 attempts). 재시도 1회 + 응답이 여유 있게 들어간다.
 * 8000 의 근거: 벤더 모델은 maxRetries: 1(src/server/llm/vendors/*)이고 @langchain/openai 는 SDK 재시도를 끈다(maxRetries: 0).
 * p-retry 대기는 randomize(1~2배) × minTimeout 1000 × factor 2^(n-1) 이라 재시도 1회의 최악 누적 대기는 2000ms 다 —
 * 8000 은 그 4배라 고부하에서도 첫 시도·재시도 응답 시간까지 들어간다. maxRetries 를 올리면 이 값도 다시 계산한다.
 * 타임아웃 자체를 검증하는 테스트는 기본값(2000)을 그대로 쓴다.
 */
export const RETRY_SAFE_SETTINGS: Partial<ChatSettings> = { timeoutMs: 8000 };

export type ChatTestDb = { handle: DbHandle; userId: string; adminId: string };

export async function setupChatDb(): Promise<ChatTestDb> {
  const handle = await createTestDb();
  const userId = (await insertUser(handle, { email: 'chat-user@pentasecurity.com', role: 'USER' }))
    .id;
  const adminId = (
    await insertUser(handle, { email: 'chat-admin@pentasecurity.com', role: 'ADMIN' })
  ).id;
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  return { handle, userId, adminId };
}

type RuntimeOptions = {
  status?: ChatCredentialStatus;
  model?: BaseChatModel;
  settings?: Partial<ChatSettings>;
  vendor?: string;
  modelId?: string;
};

export function scriptedRuntime(handle: DbHandle, options: RuntimeOptions = {}): ChatRuntime {
  const status = options.status ?? (options.model ? 'ready' : 'missing');
  const credential: ResolvedChatCredential = {
    status,
    vendor: status === 'missing' ? null : (options.vendor ?? 'anthropic'),
    vendorLabel: status === 'missing' ? null : 'Anthropic (Claude)',
    model: status === 'missing' ? null : (options.modelId ?? 'claude-opus-5-5'),
    credentialId: status === 'missing' ? null : '00000000-0000-4000-8000-000000000001',
    createModel: options.model && status === 'ready' ? () => options.model! : null,
    unsupportedVendorLabels: [],
  };
  return {
    db: handle.db,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    resolveCredential: vi.fn(async () => credential),
    markRejected: vi.fn(async () => undefined),
    markUsed: vi.fn(async () => undefined),
    credential: null,
    llmCalls: 0,
  };
}

export function ask(
  runtime: ChatRuntime,
  text: string,
  options: {
    role?: 'USER' | 'ADMIN';
    userId?: string;
    features?: readonly ChatFeature[];
    history?: { role: 'user' | 'assistant'; text: string }[];
  } = {},
) {
  const graph = options.features ? buildChatGraph(options.features) : buildChatGraph();
  return runChat(
    graph,
    {
      text,
      truncated: false,
      history: options.history ?? [],
      actor: {
        userId: options.userId ?? '00000000-0000-4000-8000-00000000000a',
        role: options.role ?? 'USER',
      },
    },
    runtime,
  );
}

/** PGlite 로 나가는 모든 SQL 수집 (Drizzle → client.query) */
export function captureSql(handle: DbHandle) {
  const client = (handle.db as unknown as { $client: { query: (...args: unknown[]) => unknown } })
    .$client;
  const statements: string[] = [];
  const original = client.query.bind(client);
  const spy = vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
    statements.push(String(args[0]));
    return original(...args);
  });
  return { statements, restore: () => spy.mockRestore() };
}
