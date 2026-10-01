import type { AIMessage, BaseMessage } from '@langchain/core/messages';

/**
 * 벤더 거부(stop_reason = 'refusal', §4.5.3) 판정. 비스트리밍 응답은 `response_metadata.stop_reason` 에,
 * 스트리밍(LangGraph streamMode 'messages' 가 모델을 스트리밍으로 부른다)은 마지막 `message_delta` 청크의
 * `additional_kwargs.stop_reason` 에 실린다(@langchain/anthropic 1.5.11) — 두 곳을 모두 본다 (PR-C QA L-1 후속).
 * OpenAI Responses·xAI 의 refusal 콘텐츠는 `additional_kwargs.refusal` 에 실린다(@langchain/openai 1.6.0 — 본문
 * content 에서는 빠진다, 비스트리밍 `refusal` 부분·스트리밍 `response.refusal.done`). 거부 원문은 읽지 않고 존재만 본다.
 */
export function isRefusal(message: BaseMessage): boolean {
  const fromMetadata = (message.response_metadata as { stop_reason?: unknown } | undefined)
    ?.stop_reason;
  const kwargs = message.additional_kwargs as
    { stop_reason?: unknown; refusal?: unknown } | undefined;
  const refusalPart = typeof kwargs?.refusal === 'string' && kwargs.refusal.length > 0;
  return fromMetadata === 'refusal' || kwargs?.stop_reason === 'refusal' || refusalPart;
}

/** 응답 판정 진단 토큰 (§4.5.1 허용 목록의 응답 판정 묶음) */
export type ResponseIssue =
  | 'refusal'
  | 'incomplete_max_output_tokens'
  | 'incomplete_content_filter'
  | 'incomplete_other'
  | 'empty_output';

/**
 * - answer: 정상(또는 도구 호출) — issue 가 있으면 진단만 남긴다
 * - refused: 거부 문구, 원문 폐기
 * - truncated: 보이는 텍스트를 쓰고(출력 가드 통과) notice `truncated_output`
 * - empty: 기존 빈 답 안내
 */
export type ResponseVerdict = {
  outcome: 'answer' | 'refused' | 'truncated' | 'empty';
  issue?: ResponseIssue;
};

/** 사용자에게 보일 텍스트가 있는지 (사고·도구 인자 블록 제외 — 내용은 판정에 쓰지 않는다) */
function hasVisibleText(message: BaseMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0;
  return message.content.some(
    (block) => block.type === 'text' && 'text' in block && String(block.text).trim().length > 0,
  );
}

function incompleteIssue(reason: unknown): ResponseIssue {
  if (reason === 'max_output_tokens') return 'incomplete_max_output_tokens';
  if (reason === 'content_filter') return 'incomplete_content_filter';
  return 'incomplete_other';
}

/**
 * 어댑터 공통 응답 판정 (PRAMI-003 §4.5.5 L-1). 응답 메타데이터(`response_metadata`·`additional_kwargs`)만 읽는다 —
 * Responses 미완료는 `status:'incomplete'` + `incomplete_details.reason` (비스트리밍·스트리밍 `response.incomplete` 동일).
 */
export function classifyResponse(message: AIMessage): ResponseVerdict {
  if (isRefusal(message)) return { outcome: 'refused', issue: 'refusal' };
  const metadata = message.response_metadata as
    { status?: unknown; incomplete_details?: { reason?: unknown } | null } | undefined;
  const text = hasVisibleText(message);
  const toolCalls = (message.tool_calls?.length ?? 0) > 0;
  if (metadata?.status === 'incomplete') {
    const issue = incompleteIssue(metadata.incomplete_details?.reason);
    if (issue === 'incomplete_content_filter') return { outcome: 'refused', issue };
    if (text) return { outcome: 'truncated', issue };
    return toolCalls ? { outcome: 'answer', issue } : { outcome: 'empty', issue };
  }
  if (!text && !toolCalls) return { outcome: 'empty', issue: 'empty_output' };
  return { outcome: 'answer' };
}
