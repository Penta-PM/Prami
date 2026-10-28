import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { withMessageId } from './message-id';

/**
 * 멀티턴 히스토리 (PRAMI-002 §4.3.7): 무저장 경로는 클라이언트가 요청마다 최근 대화를 보낸다. 저장 대화(I-6 개정, PR-C1)는
 * 서버가 DB 에서 읽고 클라이언트 history 는 무시한다(server/chat/conversations.ts beginTurn — 같은 상한).
 * 항목당 1,000자, role 은 user|assistant 만(system 위조 거부), strict. 모델에는 최근 CHAT_HISTORY_MAX_TURNS 개만 **텍스트로만** 넣는다
 * (도구 결과·사고 블록 없음). 히스토리는 신뢰하지 않는다 — 위조해도 받을 수 있는 것은 본인이 볼 수 있는 판매단가뿐(I-1).
 */
export const HISTORY_ITEM_MAX = 1000;
/** 요청 본문 자체의 상한 (모델에는 CHAT_HISTORY_MAX_TURNS 만) */
export const HISTORY_BODY_MAX = 40;

export const HistoryItemSchema = z
  .object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(HISTORY_ITEM_MAX) })
  .strict();

export const HistorySchema = z.array(HistoryItemSchema).max(HISTORY_BODY_MAX);

export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export function recentHistory(history: readonly HistoryItem[], maxTurns: number): HistoryItem[] {
  return maxTurns <= 0 ? [] : history.slice(-maxTurns);
}

/** 이력 메시지마다 고유 id (PRAMI-003 H1-1 — 같은 id 면 리듀서가 합쳐 이력이 사라진다) */
export function historyToMessages(history: readonly HistoryItem[]): BaseMessage[] {
  return history.map((item) =>
    withMessageId(item.role === 'user' ? new HumanMessage(item.text) : new AIMessage(item.text)),
  );
}
