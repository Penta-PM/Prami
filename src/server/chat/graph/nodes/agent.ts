import { AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import {
  adapterOf,
  debugMessageOf,
  describeLlmError,
  type LlmErrorDiagnostics,
} from '@/server/llm/error-diagnostics';
import { isAuthError, normalizeLlmError, type LlmErrorCode } from '@/server/llm/errors';
import { logger } from '@/server/log';

import { toolsFor } from '../../features/registry';
import { toLangChainTool } from '../../features/tool-factory';
import type { ChatFeature } from '../../features/types';
import { recentHistory } from '../history';
import { checkModelInput, withModelMessageId } from '../message-id';
import { LLM_ERROR_NOTICE, TOOL_LIMIT_NOTICE } from '../messages';
import { isRefusal } from '../refusal';
import type { ChatGraphState, ChatGraphUpdate } from '../state';
import type { ChatRuntime } from '../types';
import { errorSetup } from './basic';
import { runtimeOf } from './util';

/**
 * agent 노드 (PRAMI-002 §4.3.2): 요청마다 새 모델 인스턴스에 이 사용자에게 허용된 도구만 바인딩해 호출한다.
 * - 강제 tool_choice 없음 + 모든 도구 strict (§4.5.3). 호출 직전 마지막 메시지는 항상 Human/Tool (프리필 금지)
 * - refusal(stop_reason) 은 content 를 읽기 전에 확인하고 content 를 버린다 (§4.5.3)
 * - 벤더 오류는 코드로만 정규화 (§4.8.3). 인증 계열이면 자격 증명 상태를 갱신한다
 */
/**
 * 도구 바인딩 옵션 — 모든 벤더 공통: 강제 tool_choice 없음 + strict (Anthropic·OpenAI 는 도구별 strict:true 로 싣고,
 * Gemini 어댑터는 strict 를 무시한다 — 계약 테스트 AC-241)
 */
const BIND_OPTIONS: Record<string, unknown> = { strict: true };

/**
 * 모델 호출 신호 = 요청 타임아웃 + 클라이언트 중단(SSE 연결 끊김, §4.3.9). 두 신호를 따로 보관해 오류 시 **어느 쪽이
 * 끊었는지**로 `source` 를 `timeout`/`abort` 로 가른다 (PRAMI-003 L-4)
 */
type CallSignals = { signal: AbortSignal; timeout: AbortSignal; client: AbortSignal | undefined };

function callSignals(config: LangGraphRunnableConfig, timeoutMs: number): CallSignals {
  const timeout = AbortSignal.timeout(timeoutMs);
  const client = config.signal;
  return { signal: client ? AbortSignal.any([client, timeout]) : timeout, timeout, client };
}

/** 이번 모델 호출의 시도 수·경과 (진단 `attempts`·`latencyMs`) */
type CallStats = { attempts: number; latencyMs: number };

type FailureHook = { onFailedAttempt?: (error: unknown) => unknown };
type CallerHost = {
  caller?: FailureHook;
  responses?: CallerHost;
  completions?: CallerHost;
  bound?: CallerHost;
};

function callersOf(host: CallerHost | undefined, depth = 0): FailureHook[] {
  if (!host || depth > 2) return [];
  return [
    ...(host.caller ? [host.caller] : []),
    ...callersOf(host.responses, depth + 1),
    ...callersOf(host.completions, depth + 1),
    ...callersOf(host.bound, depth + 1),
  ];
}

/**
 * 재시도 포함 시도 수: LangChain AsyncCaller 의 실패 콜백을 요청별 인스턴스에서 감싸 센다(벤더 공통, 재시도 판단은 원래 콜백).
 * **바인딩된(호출할) 실행체**에 건다 — 설치 버전(@langchain/core 1.2.13·@langchain/openai 1.6.0) 확인: `onFailedAttempt` 는
 * protected 필드, ChatOpenAI 의 bindTools 는 새 인스턴스를 만들고 내부 `responses`/`completions` 모델의 caller 로 호출한다,
 * 다른 어댑터는 RunnableBinding(`bound`). 벤더 4종 테스트로 고정. 실패가 관측되지 않았으면(중단·로컬 예외) 진행 중이던 1회로 본다.
 */
function attemptCounter(runnable: unknown): () => number {
  let failures = 0;
  for (const caller of new Set(callersOf(runnable as CallerHost))) {
    const original = caller.onFailedAttempt;
    caller.onFailedAttempt = (error: unknown) => {
      failures += 1;
      return original?.(error);
    };
  }
  return () => Math.max(1, failures);
}

/**
 * `chat.llm_error` 필드 (PRAMI-003 §4.5.1 r2): 원인 진단 필드만 — 메시지·헤더·본문·키 없음.
 * `requestId` = 앱 요청 id(x-request-id), 벤더 요청 id 는 diagnostics.vendorRequestId.
 */
function llmErrorFields(
  state: ChatGraphState,
  runtime: ChatRuntime,
  code: LlmErrorCode,
  diagnostics: LlmErrorDiagnostics,
  stats: Partial<CallStats>,
  debugMessage?: string,
) {
  return {
    code,
    vendor: state.llm.vendor,
    model: state.llm.model,
    adapter: adapterOf(state.llm.vendor),
    ...diagnostics,
    stream: runtime.streaming === true,
    ...stats,
    ...(runtime.requestId ? { requestId: runtime.requestId } : {}),
    ...(debugMessage ? { debugMessage } : {}),
  };
}

type ErrorContext = { stats?: Partial<CallStats>; debugMessage?: string };

async function onError(
  state: ChatGraphState,
  runtime: ChatRuntime,
  code: LlmErrorCode,
  diagnostics: LlmErrorDiagnostics = { source: 'local' },
  context: ErrorContext = {},
): Promise<ChatGraphUpdate> {
  const fields = llmErrorFields(
    state,
    runtime,
    code,
    diagnostics,
    context.stats ?? {},
    context.debugMessage,
  );
  // 클라이언트 중단(SSE 끊김)은 사용자 행위 — 경고가 아니라 info (L-4)
  if (diagnostics.source === 'abort') logger.info('chat.llm_aborted', fields);
  else logger.warn('chat.llm_error', fields);
  const next: ChatGraphState = { ...state, llmError: code };
  if (isAuthError(code)) {
    const status = code === 'invalid_key' ? 'invalid' : 'forbidden';
    if (runtime.credential) await runtime.markRejected(runtime.credential, status);
    return { llmError: code, llm: { ...state.llm, status } };
  }
  const notices =
    code === 'llm_error' || code === 'request_rejected' ? [{ code, text: LLM_ERROR_NOTICE }] : [];
  return { llmError: code, notices, ...errorSetup(next, runtime) };
}

/**
 * 모델 입력 불변식 (PRAMI-003 H1-3, 모든 환경 — 비용 0): 위반이면 모델을 부르지 않는다(시스템 프롬프트 없는 호출 원천 차단,
 * fail-closed). 로그는 메시지 수·타입 순서만 — 본문 없음.
 */
function invariantViolation(state: ChatGraphState, runtime: ChatRuntime): boolean {
  const prefix = 1 + recentHistory(state.history, runtime.settings.historyMaxTurns).length + 1;
  const reason = checkModelInput(state.messages, prefix);
  if (!reason) return false;
  logger.error('chat.message_invariant_violation', {
    reason,
    count: state.messages.length,
    types: state.messages.map((message) => message.getType()),
  });
  return true;
}

export function makeAgent(features: readonly ChatFeature[]) {
  return async (
    state: ChatGraphState,
    config: LangGraphRunnableConfig,
  ): Promise<ChatGraphUpdate> => {
    const runtime = runtimeOf(config);
    const createModel = runtime.credential?.createModel;
    if (!createModel) return onError(state, runtime, 'llm_error');
    if (invariantViolation(state, runtime)) {
      return onError(state, runtime, 'llm_error', { source: 'local', frame: 'message_invariant' });
    }
    const { maxOutputTokens, timeoutMs, maxToolCalls } = runtime.settings;
    const model = createModel({ maxTokens: maxOutputTokens, timeoutMs });
    const tools = toolsFor(features, state.actor).map(toLangChainTool);
    const signals = callSignals(config, timeoutMs);
    runtime.llmCalls += 1;
    const started = Date.now();
    let attempts = () => 1;
    let message: AIMessage;
    try {
      const bound = model.bindTools ? model.bindTools(tools, BIND_OPTIONS) : model;
      attempts = attemptCounter(bound);
      message = (await bound.invoke(state.messages, { signal: signals.signal })) as AIMessage;
    } catch (error) {
      const aborted = { timedOut: signals.timeout.aborted, aborted: !!signals.client?.aborted };
      return onError(state, runtime, normalizeLlmError(error), describeLlmError(error, aborted), {
        stats: { attempts: attempts(), latencyMs: Date.now() - started },
        debugMessage: debugMessageOf(error),
      });
    }
    if (isRefusal(message)) return { llmError: 'refused' };
    const limitReached = (message.tool_calls?.length ?? 0) > 0 && state.toolCalls >= maxToolCalls;
    return {
      messages: [withModelMessageId(message)],
      notices: limitReached ? [{ code: 'tool_limit', text: TOOL_LIMIT_NOTICE }] : [],
    };
  };
}
