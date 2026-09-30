import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import { LLM_ERROR_CODES } from '@/server/llm/errors';

import type { ChatReplyOut, SetupInfo } from './types';

/**
 * 챗봇 그래프 상태 (PRAMI-002 §4.3.1, 설치 버전 @langchain/langgraph 1.4.18 의 StateSchema·MessagesValue·ReducedValue).
 * **키·복호화된 자격 증명·모델 인스턴스·DB 핸들·이메일은 상태에 넣지 않는다**(I-3) — 요청별 핸들은 config.configurable.runtime.
 * 키 목록은 스냅샷 테스트가 고정한다(AC-228).
 */
export const LLM_STATUSES = [
  'ready',
  'missing',
  'invalid',
  'forbidden',
  'unreadable',
  'disabled',
] as const;
export type LlmStatus = (typeof LLM_STATUSES)[number];

export const CHAT_ROUTES = ['pending', 'cost_refusal', 'setup_guide', 'agent', 'rule'] as const;

const NoticeSchema = z.object({ code: z.string(), text: z.string() });
export type ChatNotice = z.infer<typeof NoticeSchema>;

const HistoryItemSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string() });

export const ChatState = new StateSchema({
  /** 이번 요청의 LLM 대화: [System(고정), …history(텍스트만), Human(이번 질문), AI/Tool(이번 턴 루프)] */
  messages: MessagesValue,
  input: z.object({ text: z.string().max(200), truncated: z.boolean() }),
  /** 검증된 최근 대화(텍스트만) — prepare 가 messages 로 바꾼다 */
  history: z.array(HistoryItemSchema).default([]),
  actor: z.object({ userId: z.string(), role: z.enum(['USER', 'ADMIN']) }),
  llm: z
    .object({
      status: z.enum(LLM_STATUSES),
      vendor: z.string().nullable(),
      model: z.string().nullable(),
    })
    .default({ status: 'missing', vendor: null, model: null }),
  route: z.enum(CHAT_ROUTES).default('pending'),
  /** 이번 요청에서 실행된 도구 호출 수 (상한 §4.8.1) */
  toolCalls: z.number().int().default(0),
  /** agent 의 마지막 벤더 오류 코드 (정규화된 코드만 — 벤더 원문 없음) */
  llmError: z.enum(LLM_ERROR_CODES).nullable().default(null),
  /** 설정 안내 (응답 setup) */
  setup: z.custom<SetupInfo>().nullable().default(null),
  /** 여러 노드가 덧붙이는 안내 (응답 notice) */
  notices: new ReducedValue(z.array(NoticeSchema).default([]), {
    reducer: (current: ChatNotice[], next: ChatNotice[]) => [...current, ...next],
  }),
  /** 최종 응답 (compose·ruleAnswer·costRefusal 가 채운다) */
  reply: z.custom<ChatReplyOut>().nullable().default(null),
});

export type ChatGraphState = typeof ChatState.State;
export type ChatGraphUpdate = typeof ChatState.Update;
