import { AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import {
  adapterOf,
  debugMessageOf,
  describeLlmError,
  type LlmErrorDiagnostics,
} from '@/server/llm/error-diagnostics';
import { isAuthError, normalizeLlmError, type LlmErrorCode } from '@/server/llm/errors';
import { XAI_REQUEST_GUARD_FRAME } from '@/server/llm/vendors/xai-chat';
import { logger } from '@/server/log';

import { toolsFor } from '../../features/registry';
import { toLangChainTool } from '../../features/tool-factory';
import type { ChatFeature } from '../../features/types';
import { recentHistory } from '../history';
import { checkModelInput, withModelMessageId } from '../message-id';
import { LLM_ERROR_NOTICE, TOOL_LIMIT_NOTICE, TRUNCATED_OUTPUT_NOTICE } from '../messages';
import { classifyResponse, type ResponseVerdict } from '../refusal';
import type { ChatGraphState, ChatGraphUpdate } from '../state';
import type { ChatRuntime } from '../types';
import { errorSetup } from './basic';
import { runtimeOf } from './util';

/**
 * agent 노드 (PRAMI-002 §4.3.2): 요청마다 새 모델 인스턴스에 이 사용자에게 허용된 도구만 바인딩해 호출한다.
 * - 강제 tool_choice 없음 + 모든 도구 strict (§4.5.3). 호출 직전 마지막 메시지는 항상 Human/Tool (프리필 금지)
 * - refusal(stop_reason·refusal 콘텐츠)·미완료·빈 출력은 메타데이터로 판정한다 — 거부면 content 를 버린다 (§4.5.3, PRAMI-003 L-1)
 * - 벤더 오류는 코드로만 정규화 (§4.8.3). 인증 계열이면 자격 증명 상태를 갱신한다
 */
/**
 * 도구 바인딩 옵션 — 모든 벤더 공통: 강제 tool_choice 없음 + strict (Anthropic·OpenAI 는 도구별 strict:true 로 싣고,
 * Gemini 어댑터는 strict 를 무시한다 — 계약 테스트 AC-241)
 */
const BIND_OPTIONS: Record<string, unknown> = { strict: true };

/** 응답 사후 검사 진단 토큰 (§4.7.7 ③) */
const SERVER_TOOL_USED = 'server_tool_used';

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
function attemptCounter(runnable: unknown): (succeeded: boolean) => number {
  let failures = 0;
  for (const caller of new Set(callersOf(runnable as CallerHost))) {
    const original = caller.onFailedAttempt;
    caller.onFailedAttempt = (error: unknown) => {
      failures += 1;
      return original?.(error);
    };
  }
  // 성공: 실패한 시도 + 마지막 성공 1회, 실패: 관측된 실패 수(최소 1 — 중단 시 진행 중이던 시도)
  return (succeeded) => (succeeded ? failures + 1 : Math.max(1, failures));
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

/**
 * 운영 알림 대상(§4.3.8)은 warn 이 아니라 error 수준 (PRAMI-003 §4.7.7): 벤더 폐기(410·`deprecated`) = 어댑터 갱신 필요,
 * 서버측 도구 사용 = 검색 비사용 보장 위반, 요청 가드 = 금지 키가 본문에 들어간 코드 결함
 */
function isAlert(diagnostics: LlmErrorDiagnostics): boolean {
  return (
    diagnostics.httpStatus === 410 ||
    diagnostics.vendorErrorCode === 'deprecated' ||
    diagnostics.vendorErrorType === SERVER_TOOL_USED ||
    diagnostics.frame === XAI_REQUEST_GUARD_FRAME
  );
}

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
  else if (isAlert(diagnostics)) logger.error('chat.llm_error', fields);
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
 * 출력 상한에 잘린 응답의 도구 호출은 인자가 잘렸을 수 있어 실행하지 않는다 (리뷰 후속) — 보이는 텍스트만 남긴 새 메시지.
 * id 는 유지한다(SSE 메시지 스트림이 같은 답을 다시 내보내지 않게, H1-2 참고).
 */
function withoutToolCalls(message: AIMessage): AIMessage {
  if (!message.tool_calls?.length && typeof message.content === 'string') return message;
  const content =
    typeof message.content === 'string'
      ? message.content
      : message.content.filter((block) => block.type === 'text');
  return new AIMessage({
    content,
    id: message.id,
    response_metadata: message.response_metadata,
  });
}

/**
 * 2xx 인데 거부·미완료·빈 출력 (PRAMI-003 §4.5.5 L-1) — `chat.llm_error` warn 1행(source response, httpStatus 200,
 * vendorErrorType = 판정 토큰). code 는 거부면 `refused`, 그 밖은 `llm_error`(미분류 응답). 응답 본문은 남기지 않는다.
 */
function logResponseIssue(
  state: ChatGraphState,
  runtime: ChatRuntime,
  verdict: ResponseVerdict,
  stats: CallStats,
) {
  if (!verdict.issue) return;
  const code: LlmErrorCode = verdict.outcome === 'refused' ? 'refused' : 'llm_error';
  const diagnostics: LlmErrorDiagnostics = {
    source: 'response',
    httpStatus: 200,
    vendorErrorType: verdict.issue,
  };
  logger.warn('chat.llm_error', llmErrorFields(state, runtime, code, diagnostics, stats));
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
    // 서버측 도구(검색 등) 사용이 감지되면 성공·실패와 관계없이 그 출력을 버리고 규칙 답 (§4.7.7 ③)
    let serverToolUsed = false;
    const model = createModel({
      maxTokens: maxOutputTokens,
      timeoutMs,
      onServerToolUse: () => {
        serverToolUsed = true;
      },
    });
    const serverToolError = (stats: CallStats) =>
      onError(
        state,
        runtime,
        'llm_error',
        { source: 'response', httpStatus: 200, vendorErrorType: SERVER_TOOL_USED },
        { stats },
      );
    const tools = toolsFor(features, state.actor).map(toLangChainTool);
    const signals = callSignals(config, timeoutMs);
    runtime.llmCalls += 1;
    const started = Date.now();
    let attempts: (succeeded: boolean) => number = () => 1;
    let message: AIMessage;
    try {
      const bound = model.bindTools ? model.bindTools(tools, BIND_OPTIONS) : model;
      attempts = attemptCounter(bound);
      message = (await bound.invoke(state.messages, { signal: signals.signal })) as AIMessage;
    } catch (error) {
      if (serverToolUsed) {
        return serverToolError({ attempts: attempts(true), latencyMs: Date.now() - started });
      }
      const aborted = { timedOut: signals.timeout.aborted, aborted: !!signals.client?.aborted };
      return onError(state, runtime, normalizeLlmError(error), describeLlmError(error, aborted), {
        stats: { attempts: attempts(false), latencyMs: Date.now() - started },
        debugMessage: debugMessageOf(error),
      });
    }
    const stats = { attempts: attempts(true), latencyMs: Date.now() - started };
    if (serverToolUsed) return serverToolError(stats);
    const verdict = classifyResponse(message);
    logResponseIssue(state, runtime, verdict, stats);
    // 거부(refusal 콘텐츠·stop_reason·content_filter 미완료)는 content 를 버린다 (§4.5.3)
    if (verdict.outcome === 'refused') return { llmError: 'refused' };
    const answer = verdict.outcome === 'answer' ? message : withoutToolCalls(message);
    const limitReached = (answer.tool_calls?.length ?? 0) > 0 && state.toolCalls >= maxToolCalls;
    return {
      messages: [withModelMessageId(answer)],
      notices: [
        ...(limitReached ? [{ code: 'tool_limit', text: TOOL_LIMIT_NOTICE }] : []),
        ...(verdict.outcome === 'truncated'
          ? [{ code: 'truncated_output', text: TRUNCATED_OUTPUT_NOTICE }]
          : []),
      ],
    };
  };
}
