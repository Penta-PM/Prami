import type { Db } from '@/db';
import type { ResolvedChatCredential } from '@/server/llm/credentials/chat';

import type { ChatReply } from '../respond';

/**
 * 그래프 공용 타입 (PRAMI-002 §4.3.11 API 계약). 응답 = 기존 ChatReply + mode·llm·setup (추가 필드만).
 */
export type ChatMode = 'llm' | 'rule' | 'setup' | 'refusal';

export type SetupStatus =
  | 'missing'
  | 'invalid'
  | 'forbidden'
  | 'unreadable'
  | 'model_not_found'
  | 'rate_limited'
  | 'unavailable';

export const SETUP_HREF = '/settings#llm';

export type SetupInfo = { status: SetupStatus; message: string; href: typeof SETUP_HREF };

export type ChatReplyOut = ChatReply & {
  mode: ChatMode;
  llm: { status: string; vendor: string | null; model: string | null };
  setup?: SetupInfo;
};

/** env 에서 오는 상한·스위치 — 테스트가 요청별로 바꿀 수 있게 runtime 으로 넘긴다 */
export type ChatSettings = {
  llmEnabled: boolean;
  ruleFallback: boolean;
  maxToolCalls: number;
  maxOutputTokens: number;
  timeoutMs: number;
  historyMaxTurns: number;
};

/**
 * 요청 스코프 핸들 (config.configurable.runtime). 직렬화하지 않으며 **키 문자열 필드가 없다**(I-3) —
 * 키는 `resolveCredential` 결과의 `createModel` 클로저 안에만 있다.
 */
export type ChatRuntime = {
  db: Db;
  settings: ChatSettings;
  /** 본인 자격 증명 해석 (요청마다 조회, 캐시 없음) */
  resolveCredential: () => Promise<ResolvedChatCredential>;
  /** 채팅 인증 오류 → 자격 증명 상태 갱신 */
  markRejected: (
    credential: ResolvedChatCredential,
    status: 'invalid' | 'forbidden',
  ) => Promise<void>;
  /** LLM 경로 성공 → last_used_at */
  markUsed: (credential: ResolvedChatCredential) => Promise<void>;
  /** resolveCredential 노드가 채운다 */
  credential: ResolvedChatCredential | null;
  /** 이번 요청의 LLM 호출 수 (상한 검사·로그) */
  llmCalls: number;
  /** SSE 경로면 true (오류 진단 로그용 — LangGraph messages 모드는 모델을 스트리밍으로 부른다) */
  streaming?: boolean;
};
