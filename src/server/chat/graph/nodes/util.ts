import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ChatGraphState } from '../state';
import type { ChatMode, ChatReplyOut, ChatRuntime } from '../types';

/** 요청 스코프 핸들 꺼내기 (config.configurable.runtime) — 없으면 프로그래밍 오류 */
export function runtimeOf(config: LangGraphRunnableConfig): ChatRuntime {
  const runtime = (config.configurable as { runtime?: ChatRuntime } | undefined)?.runtime;
  if (!runtime) throw new Error('chat runtime 이 config.configurable 에 없습니다');
  return runtime;
}

export function baseReply(state: Pick<ChatGraphState, 'llm'>, mode: ChatMode): ChatReplyOut {
  return {
    intent: 'help',
    reply: '',
    candidates: [],
    showProductChips: false,
    action: null,
    mode,
    llm: { ...state.llm },
  };
}
