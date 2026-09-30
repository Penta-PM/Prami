import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ChatArtifact } from '../../features/types';
import type { ChatReply } from '../../respond';
import { assertNoCostKeys, guardReplyText, productTermsOf } from '../guard';
import { EMPTY_LLM_REPLY, REFUSED_REPLY, TOO_LONG_REPLY } from '../messages';
import type { ChatGraphState, ChatGraphUpdate } from '../state';
import type { ChatReplyOut } from '../types';
import { baseReply, runtimeOf } from './util';

/**
 * compose 노드 (PRAMI-002 §4.3.2): 최종 응답 조립 — 규칙·거부 경로는 이미 만든 reply 를, LLM 경로는 마지막 AI 텍스트 +
 * 도구 아티팩트(candidates·action)를 쓴다. 모든 경로에 notice·setup·llm 을 붙이고 출력 가드(§4.4.3)와 금지 키 검사(§4.4.2)를 한다.
 */
const TOOL_INTENTS: Record<string, ChatReply['intent']> = {
  price_lookup: 'price',
  price_compare_previous: 'compare',
  quote_start: 'quote',
};

/** 이번 질문 이후(마지막 Human 뒤)의 메시지 */
function thisTurn(messages: BaseMessage[]): BaseMessage[] {
  const start = messages.findLastIndex((message) => message instanceof HumanMessage);
  return messages.slice(start + 1);
}

function textOf(message: AIMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
    .join('');
}

function llmReply(state: ChatGraphState): ChatReplyOut {
  const turn = thisTurn(state.messages);
  const tools = turn.filter((message): message is ToolMessage => message instanceof ToolMessage);
  const artifacts = tools.map((message) => message.artifact as ChatArtifact | undefined);
  const lastAi = turn
    .filter((message): message is AIMessage => message instanceof AIMessage)
    .at(-1);
  const candidates = artifacts.findLast((artifact) => artifact?.candidates)?.candidates ?? [];
  const action = artifacts.findLast((artifact) => artifact?.action)?.action ?? null;
  const lastTool = tools.findLast((message) => message.status !== 'error');
  return {
    ...baseReply(state, 'llm'),
    intent: TOOL_INTENTS[lastTool?.name ?? ''] ?? 'help',
    reply: textOf(lastAi).trim() || EMPTY_LLM_REPLY,
    candidates,
    action,
  };
}

function draft(state: ChatGraphState): ChatReplyOut {
  if (state.reply) return state.reply;
  if (state.llmError === 'refused') return { ...baseReply(state, 'refusal'), reply: REFUSED_REPLY };
  if (state.llmError === 'too_long') return { ...baseReply(state, 'llm'), reply: TOO_LONG_REPLY };
  if (state.setup && state.llm.status !== 'ready') {
    return { ...baseReply(state, 'setup'), reply: state.setup.message };
  }
  if (state.llmError) return { ...baseReply(state, 'setup'), reply: state.setup?.message ?? '' };
  return llmReply(state);
}

export function compose(state: ChatGraphState, config: LangGraphRunnableConfig): ChatGraphUpdate {
  runtimeOf(config);
  const reply = draft(state);
  // 출력 가드는 LLM 이 만든 텍스트에만 (PR-B QA L-2): 규칙·거부·안내 문구는 판매단가 DB 에서 만든 결정적 템플릿이라
  // 품명에 가드 단어가 들어 있어도 정상 가격 답이 거부 문구로 바뀌면 안 된다
  const text =
    reply.mode === 'llm'
      ? guardReplyText({
          text: reply.reply,
          terms: productTermsOf(
            thisTurn(state.messages).filter(
              (message): message is ToolMessage => message instanceof ToolMessage,
            ),
          ),
          role: state.actor.role,
          vendor: state.llm.vendor,
          model: state.llm.model,
        })
      : reply.reply;
  const notice = state.notices.map((entry) => entry.text).join(' ') || undefined;
  const final: ChatReplyOut = {
    ...reply,
    reply: text,
    llm: { ...state.llm },
    ...(notice ? { notice } : {}),
    ...(state.setup ? { setup: state.setup } : {}),
  };
  assertNoCostKeys(final);
  return { reply: final };
}
