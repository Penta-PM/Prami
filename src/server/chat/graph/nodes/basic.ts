import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import { modelLabel } from '@/server/llm/models';

import type { ChatFeature } from '../../features/types';
import { classifyIntent } from '../../intent';
import { COST_REPLY, COST_REPLY_USER, respondToChat } from '../../respond';
import { historyToMessages, recentHistory } from '../history';
import { withMessageId } from '../message-id';
import { setupFor, TRUNCATED_NOTICE, unsupportedVendorsMessage } from '../messages';
import { buildSystemPrompt } from '../prompt';
import type { ChatGraphState, ChatGraphUpdate } from '../state';
import type { ChatRuntime, SetupStatus } from '../types';
import { baseReply, runtimeOf } from './util';

/**
 * 결정적 노드 (PRAMI-002 §4.3.2) — LLM 을 부르지 않는다.
 * prepare → precheck → (costRefusal | resolveCredential) → (setupGuide) → ruleAnswer
 */
export function makePrepare(features: readonly ChatFeature[]) {
  const system = buildSystemPrompt(features);
  return (state: ChatGraphState, config: LangGraphRunnableConfig): ChatGraphUpdate => {
    const { settings } = runtimeOf(config);
    const history = recentHistory(state.history, settings.historyMaxTurns);
    // 모든 메시지에 고유 id (PRAMI-003 H1-1): id 없이 반환하면 SSE(messages 모드)에서 같은 run id 로 합쳐진다(H-1)
    return {
      messages: [
        withMessageId(new SystemMessage(system)),
        ...historyToMessages(history),
        withMessageId(new HumanMessage(state.input.text)),
      ],
      notices: state.input.truncated ? [{ code: 'truncated', text: TRUNCATED_NOTICE }] : [],
    };
  };
}

/** cost 의도는 LLM·DB 전에 결정적으로 거부 (PRAMI-001 AC-81 경로) */
export function precheck(state: ChatGraphState): ChatGraphUpdate {
  return { route: classifyIntent(state.input.text).kind === 'cost' ? 'cost_refusal' : 'agent' };
}

/** DB 0·LLM 0 — 역할별 기존 문구 */
export function costRefusal(state: ChatGraphState): ChatGraphUpdate {
  const text = state.actor.role === 'ADMIN' ? COST_REPLY : COST_REPLY_USER;
  return { reply: { ...baseReply(state, 'refusal'), intent: 'cost', reply: text } };
}

export async function resolveCredential(
  _state: ChatGraphState,
  config: LangGraphRunnableConfig,
): Promise<ChatGraphUpdate> {
  const runtime = runtimeOf(config);
  if (!runtime.settings.llmEnabled) {
    return { llm: { status: 'disabled', vendor: null, model: null } };
  }
  const credential = await runtime.resolveCredential();
  runtime.credential = credential;
  return { llm: { status: credential.status, vendor: credential.vendor, model: credential.model } };
}

function labelsOf(runtime: ChatRuntime) {
  const credential = runtime.credential;
  const vendor = credential?.vendorLabel ?? undefined;
  const model =
    credential?.vendor && credential.model
      ? modelLabel(credential.vendor, credential.model)
      : undefined;
  return { vendor, model };
}

/** 상태별 안내 (§4.9). 폴백이면 규칙 답이 이어진다 */
export function setupGuide(
  state: ChatGraphState,
  config: LangGraphRunnableConfig,
): ChatGraphUpdate {
  const runtime = runtimeOf(config);
  const status = state.llm.status as SetupStatus;
  const setup = setupFor(status, labelsOf(runtime));
  const unsupported = runtime.credential?.unsupportedVendorLabels ?? [];
  if (status === 'missing' && unsupported.length > 0) {
    return {
      setup: { ...setup, message: unsupportedVendorsMessage(unsupported) },
      route: 'setup_guide',
    };
  }
  return { setup, route: 'setup_guide' };
}

/** 기존 규칙 엔진 그대로 (PRAMI-001 §4.5.9 — sales_prices 만) */
export async function ruleAnswer(
  state: ChatGraphState,
  config: LangGraphRunnableConfig,
): Promise<ChatGraphUpdate> {
  const runtime = runtimeOf(config);
  const answer = await respondToChat(runtime.db, { role: state.actor.role }, state.input.text);
  return { route: 'rule', reply: { ...baseReply(state, 'rule'), ...answer } };
}

/** agent 오류(모델 없음·한도·일시)의 안내 — ruleAnswer 전에 setup 으로 남긴다 */
export function errorSetup(state: ChatGraphState, runtime: ChatRuntime): ChatGraphUpdate {
  const code = state.llmError;
  if (code !== 'model_not_found' && code !== 'rate_limited' && code !== 'unavailable') return {};
  return { setup: setupFor(code, labelsOf(runtime)) };
}
