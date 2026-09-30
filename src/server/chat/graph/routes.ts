import { AIMessage } from '@langchain/core/messages';

import { isAuthError, isTransientError } from '@/server/llm/errors';

import type { ChatGraphState } from './state';

/**
 * 조건부 라우터 (PRAMI-002 §4.3.3) — 순수 함수. 표 기반 단위 테스트(AC-221)가 모든 분기를 검사한다.
 * 상한·폴백 스위치는 상태가 아니라 인자로 받는다(요청별 runtime.settings).
 */
export type PrecheckNext = 'costRefusal' | 'resolveCredential';
export type CredentialNext = 'agent' | 'ruleAnswer' | 'setupGuide';
export type GuideNext = 'ruleAnswer' | 'compose';
export type AgentNext = 'tools' | 'setupGuide' | 'ruleAnswer' | 'compose';

type RouteSettings = { ruleFallback: boolean; maxToolCalls: number };

export function routeAfterPrecheck(state: Pick<ChatGraphState, 'route'>): PrecheckNext {
  return state.route === 'cost_refusal' ? 'costRefusal' : 'resolveCredential';
}

export function routeAfterCredential(state: Pick<ChatGraphState, 'llm'>): CredentialNext {
  if (state.llm.status === 'ready') return 'agent';
  if (state.llm.status === 'disabled') return 'ruleAnswer';
  return 'setupGuide';
}

export function routeAfterGuide(settings: Pick<RouteSettings, 'ruleFallback'>): GuideNext {
  return settings.ruleFallback ? 'ruleAnswer' : 'compose';
}

function hasPendingToolCalls(state: Pick<ChatGraphState, 'messages'>): boolean {
  const last = state.messages.at(-1);
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
}

export function routeAfterAgent(
  state: Pick<ChatGraphState, 'messages' | 'llmError' | 'toolCalls'>,
  settings: RouteSettings,
): AgentNext {
  const error = state.llmError;
  if (error) {
    if (isAuthError(error)) return 'setupGuide';
    // 모델 없음·일시 오류·기타는 폴백 켜짐이면 규칙 답 (모델 없음은 설정 안내를 병기)
    if (isTransientError(error) || error === 'model_not_found') {
      return settings.ruleFallback ? 'ruleAnswer' : 'compose';
    }
    return 'compose';
  }
  if (hasPendingToolCalls(state) && state.toolCalls < settings.maxToolCalls) return 'tools';
  return 'compose';
}
