import { AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import { isAuthError, normalizeLlmError, type LlmErrorCode } from '@/server/llm/errors';
import { logger } from '@/server/log';

import { toolsFor } from '../../features/registry';
import { toLangChainTool } from '../../features/tool-factory';
import type { ChatFeature } from '../../features/types';
import { LLM_ERROR_NOTICE, TOOL_LIMIT_NOTICE } from '../messages';
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

/** 모델 호출 신호 = 요청 타임아웃 + 클라이언트 중단(SSE 연결 끊김, §4.3.9) */
function callSignal(config: LangGraphRunnableConfig, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
}

function isRefusal(message: AIMessage): boolean {
  return (
    (message.response_metadata as { stop_reason?: unknown } | undefined)?.stop_reason === 'refusal'
  );
}

async function onError(
  state: ChatGraphState,
  runtime: ChatRuntime,
  code: LlmErrorCode,
): Promise<ChatGraphUpdate> {
  logger.warn('chat.llm_error', { code, vendor: state.llm.vendor, model: state.llm.model });
  const next: ChatGraphState = { ...state, llmError: code };
  if (isAuthError(code)) {
    const status = code === 'invalid_key' ? 'invalid' : 'forbidden';
    if (runtime.credential) await runtime.markRejected(runtime.credential, status);
    return { llmError: code, llm: { ...state.llm, status } };
  }
  const notices = code === 'llm_error' ? [{ code, text: LLM_ERROR_NOTICE }] : [];
  return { llmError: code, notices, ...errorSetup(next, runtime) };
}

export function makeAgent(features: readonly ChatFeature[]) {
  return async (
    state: ChatGraphState,
    config: LangGraphRunnableConfig,
  ): Promise<ChatGraphUpdate> => {
    const runtime = runtimeOf(config);
    const createModel = runtime.credential?.createModel;
    if (!createModel) return onError(state, runtime, 'llm_error');
    const { maxOutputTokens, timeoutMs, maxToolCalls } = runtime.settings;
    const model = createModel({ maxTokens: maxOutputTokens, timeoutMs });
    const tools = toolsFor(features, state.actor).map(toLangChainTool);
    runtime.llmCalls += 1;
    let message: AIMessage;
    try {
      const bound = model.bindTools ? model.bindTools(tools, BIND_OPTIONS) : model;
      message = (await bound.invoke(state.messages, {
        signal: callSignal(config, timeoutMs),
      })) as AIMessage;
    } catch (error) {
      return onError(state, runtime, normalizeLlmError(error));
    }
    if (isRefusal(message)) return { llmError: 'refused' };
    const limitReached = (message.tool_calls?.length ?? 0) > 0 && state.toolCalls >= maxToolCalls;
    return {
      messages: [message],
      notices: limitReached ? [{ code: 'tool_limit', text: TOOL_LIMIT_NOTICE }] : [],
    };
  };
}
