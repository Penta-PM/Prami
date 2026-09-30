import type { z } from 'zod';

import type { Db } from '@/db';
import type { PermissionKey, Role } from '@/lib/constants/permissions';

import type { ChatCandidate, ChatReply } from '../respond';

/**
 * 챗봇 기능(도구) 레지스트리 타입 (PRAMI-002 §4.3.4 — 플러그인 구조). 새 기능 = ChatFeature 1개 + registry 배열 1줄.
 * 도구는 **읽기 전용**이다(`sideEffect: 'none'`, I-7). 쓰기 기능은 확인 단계(interrupt)를 도입하는 별도 스펙으로.
 */
export type ToolActor = { userId: string; role: Role };

/** 도구가 쓸 수 있는 의존성 — 키·자격 증명·모델은 없다 (I-3) */
export type ToolDeps = { db: Db; actor: ToolActor };

/** UI 용 결과 (LLM 에는 가지 않는다): 후보 칩·견적 시작 링크 */
export type ChatArtifact = {
  candidates?: ChatCandidate[];
  action?: NonNullable<ChatReply['action']>;
};

export type ChatToolResult<O> = { data: O; artifact?: ChatArtifact };

export type ChatToolDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  /** snake_case, 전역 유일 */
  name: string;
  /** 고정 문자열 (원가 언급 금지) */
  description: string;
  /** 스트리밍 진행 표시 (SSE `event: status`, §4.3.9) — 없으면 기본 문구 */
  statusLabel?: string;
  /** LLM 인자 검증 — strict 객체. 선택 인자는 nullable 로 (strict tool use 호환) */
  input: I;
  /** strict — 이 스키마를 통과한 값만 LLM 에 전달된다 (§4.4.2) */
  output: O;
  run: (args: z.infer<I>, deps: ToolDeps) => Promise<ChatToolResult<z.infer<O>>>;
};

export type ChatFeature = {
  id: string;
  title: string;
  /** 도구 노출·실행 모두 이 권한으로 거른다 */
  permission: PermissionKey;
  sideEffect: 'none';
  /** 기능 플래그 (§4.3.4·§4.3.6 ③, r4 시그니처) — 없으면 항상 켜짐. 예: `enabled: () => env.CHAT_FEATURE_X` (`@/env`) */
  enabled?: () => boolean;
  /** 시스템 프롬프트 "사용 가능한 기능" 한 줄 (고정) */
  promptHint: string;
  /** 규칙 폴백에서도 같은 기능을 처리하는지 (도움말 표기용) */
  ruleIntent?: 'price' | 'compare' | 'quote';
  tools: ChatToolDef[];
};
