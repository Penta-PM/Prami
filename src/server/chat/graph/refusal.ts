import type { BaseMessage } from '@langchain/core/messages';

/**
 * 벤더 거부(stop_reason = 'refusal', §4.5.3) 판정. 비스트리밍 응답은 `response_metadata.stop_reason` 에,
 * 스트리밍(LangGraph streamMode 'messages' 가 모델을 스트리밍으로 부른다)은 마지막 `message_delta` 청크의
 * `additional_kwargs.stop_reason` 에 실린다(@langchain/anthropic 1.5.11) — 두 곳을 모두 본다 (PR-C QA L-1 후속).
 */
export function isRefusal(message: BaseMessage): boolean {
  const fromMetadata = (message.response_metadata as { stop_reason?: unknown } | undefined)
    ?.stop_reason;
  const fromKwargs = (message.additional_kwargs as { stop_reason?: unknown } | undefined)
    ?.stop_reason;
  return fromMetadata === 'refusal' || fromKwargs === 'refusal';
}
