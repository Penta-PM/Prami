import 'server-only';

import type { ChatDomain } from '@/lib/chat/conversations';
import { PROCUREMENT_CHAT_FEATURE } from '@/server/procurement/chat/tools';

import { CHAT_FEATURES } from './features/registry';
import type { ChatFeature } from './features/types';
import { buildChatGraph, type ChatGraph } from './graph/build';
import { chatGraph } from './graph/runtime';

/**
 * 챗봇 domain 조립 (UX 4건 §4.2, PR-C3) — domain 별 기능(도구) 목록과 컴파일된 그래프. **조달 격리 규칙의 단일 예외 파일**:
 * server/chat 에서 조달 모듈을 import 하는 곳은 여기뿐이다(eslint PROCUREMENT_ALLOWLIST·격리 테스트가 이 파일만 허용).
 * - pricing = 기존 레지스트리 그대로(가격 조회·비교·견적), procurement = 조달 조회 도구만(읽기 전용, procurement.read).
 * - 서로의 도구는 노출도 실행도 되지 않는다 — 그래프가 자기 features 로만 bindTools·실행 재검사를 한다.
 * 어느 그래프를 쓸지는 라우트가 **서버가 검증한 대화 domain**(beginTurn: 소유·domain 일치·권한)으로 고른다.
 */
export const CHAT_DOMAIN_FEATURES: Readonly<Record<ChatDomain, readonly ChatFeature[]>> = {
  pricing: CHAT_FEATURES,
  procurement: [PROCUREMENT_CHAT_FEATURE],
};

const graphs: Record<ChatDomain, ChatGraph> = {
  pricing: chatGraph,
  procurement: buildChatGraph(CHAT_DOMAIN_FEATURES.procurement, 'procurement'),
};

export function chatGraphFor(domain: ChatDomain): ChatGraph {
  return graphs[domain];
}
