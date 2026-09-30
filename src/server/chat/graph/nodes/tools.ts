import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import { logger } from '@/server/log';

import { findAllowedTool } from '../../features/registry';
import type { ChatFeature, ChatToolDef, ToolDeps } from '../../features/types';
import { assertNoCostKeys } from '../guard';
import type { ChatGraphState, ChatGraphUpdate } from '../state';
import { runtimeOf } from './util';

/**
 * tools 노드 (PRAMI-002 §4.3.2·§4.4.2): 마지막 AI 메시지의 도구 호출을 실행한다.
 * - 실행 직전 권한 재검사 — 목록 밖·권한 없는 도구 이름은 실행하지 않는다 (2중 방어, AC-233)
 * - 입력 zod 검증, 출력 **strict** 파싱 + 금지 키 검사를 통과한 값만 LLM 에 JSON 으로 전달 (AC-226)
 * - 요청당 도구 상한 초과분은 실행하지 않고 오류 ToolMessage 로 짝만 맞춘다 (tool_use ↔ tool_result 쌍 유지)
 * 오류 메시지는 고정 문구 — 예외 원문(쿼리·값)은 LLM 에 넘기지 않는다.
 */
const TOOL_ERRORS = {
  forbidden: '이 도구는 사용할 수 없습니다.',
  input: '도구 인자가 올바르지 않습니다.',
  output: '도구 결과 형식이 올바르지 않아 전달하지 않았습니다.',
  limit: '요청당 도구 호출 상한에 도달해 실행하지 않았습니다.',
  failed: '도구 실행 중 오류가 발생했습니다.',
} as const;

/** 도구 진행 표시 기본 문구 (라벨 없는 도구) */
const DEFAULT_STATUS_LABEL = '정보를 확인하는 중';

function errorMessage(call: ToolCall, code: keyof typeof TOOL_ERRORS): ToolMessage {
  return new ToolMessage({
    tool_call_id: call.id ?? call.name,
    name: call.name,
    status: 'error',
    content: JSON.stringify({ error: TOOL_ERRORS[code] }),
  });
}

async function execute(def: ChatToolDef, call: ToolCall, deps: ToolDeps): Promise<ToolMessage> {
  const args = def.input.safeParse(call.args);
  if (!args.success) return errorMessage(call, 'input');
  let result: Awaited<ReturnType<ChatToolDef['run']>>;
  try {
    result = await def.run(args.data, deps);
  } catch (error) {
    logger.error('chat.tool_failed', { tool: def.name, error });
    return errorMessage(call, 'failed');
  }
  const parsed = def.output.safeParse(result.data);
  if (!parsed.success) {
    logger.warn('chat.tool_output_rejected', { tool: def.name });
    return errorMessage(call, 'output');
  }
  try {
    assertNoCostKeys(parsed.data);
  } catch {
    logger.warn('chat.tool_output_rejected', { tool: def.name, reason: 'cost_key' });
    return errorMessage(call, 'output');
  }
  return new ToolMessage({
    tool_call_id: call.id ?? call.name,
    name: def.name,
    content: JSON.stringify(parsed.data),
    artifact: result.artifact,
  });
}

export function makeTools(features: readonly ChatFeature[]) {
  return async (
    state: ChatGraphState,
    config: LangGraphRunnableConfig,
  ): Promise<ChatGraphUpdate> => {
    const runtime = runtimeOf(config);
    const last = state.messages.at(-1);
    const calls = last instanceof AIMessage ? (last.tool_calls ?? []) : [];
    const deps: ToolDeps = { db: runtime.db, actor: state.actor };
    const messages: ToolMessage[] = [];
    let executed = state.toolCalls;
    for (const call of calls) {
      const def = findAllowedTool(features, state.actor, call.name);
      if (!def) messages.push(errorMessage(call, 'forbidden'));
      else if (executed >= runtime.settings.maxToolCalls)
        messages.push(errorMessage(call, 'limit'));
      else {
        executed += 1;
        // 스트리밍 진행 표시 (streamMode 'custom' 일 때만 writer 가 있다 — JSON 경로에는 영향 없음)
        config.writer?.({ type: 'tool_status', label: def.statusLabel ?? DEFAULT_STATUS_LABEL });
        messages.push(await execute(def, call, deps));
      }
    }
    return { messages, toolCalls: executed };
  };
}
