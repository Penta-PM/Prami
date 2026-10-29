import { END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ChatDomain } from '@/lib/chat/conversations';

import { CHAT_FEATURES } from '../features/registry';
import type { ChatFeature } from '../features/types';
import { makeAgent } from './nodes/agent';
import {
  costRefusal,
  makePrepare,
  precheck,
  ruleAnswerForProcurement,
  resolveCredential,
  ruleAnswer,
  setupGuide,
} from './nodes/basic';
import { compose } from './nodes/compose';
import { makeTools } from './nodes/tools';
import { runtimeOf } from './nodes/util';
import {
  routeAfterAgent,
  routeAfterCredential,
  routeAfterGuide,
  routeAfterPrecheck,
} from './routes';
import { ChatState, type ChatGraphState } from './state';

/**
 * 챗봇 그래프 빌더 (PRAMI-002 §4.3.3). 기능 레지스트리를 인자로 받는다 — 테스트는 sample-feature 를 넣어
 * **그래프·노드 코드 수정 없이** 새 도구가 라우팅되는지 확인한다(AC-233).
 * domain(UX 4건 §4.2, PR-C3): 시스템 프롬프트 규칙과 규칙 폴백 노드만 바꾼다 — 도구는 인자로 받은 features 뿐이라
 * 가격 그래프에는 조달 도구가, 조달 그래프에는 가격 도구가 노출·실행되지 않는다(조립은 server/chat/domains.ts).
 * 체크포인터 없음(I-6 개정 후에도 — 대화 저장은 그래프 밖 conversations.ts 가 최종 답만. compile() 인자 없음, 코드 검사 테스트). 요청별 값은 입력 상태와 config.configurable.runtime.
 */
export function buildChatGraph(
  features: readonly ChatFeature[] = CHAT_FEATURES,
  domain: ChatDomain = 'pricing',
) {
  const settingsOf = (config: LangGraphRunnableConfig) => runtimeOf(config).settings;
  return new StateGraph(ChatState)
    .addNode('prepare', makePrepare(features, domain))
    .addNode('precheck', precheck)
    .addNode('costRefusal', costRefusal)
    .addNode('resolveCredential', resolveCredential)
    .addNode('setupGuide', setupGuide)
    .addNode('ruleAnswer', domain === 'procurement' ? ruleAnswerForProcurement : ruleAnswer)
    .addNode('agent', makeAgent(features))
    .addNode('tools', makeTools(features))
    .addNode('compose', compose)
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'precheck')
    .addConditionalEdges('precheck', routeAfterPrecheck, ['costRefusal', 'resolveCredential'])
    .addConditionalEdges('resolveCredential', routeAfterCredential, [
      'agent',
      'ruleAnswer',
      'setupGuide',
    ])
    .addConditionalEdges(
      'setupGuide',
      (_state: ChatGraphState, config: LangGraphRunnableConfig) =>
        routeAfterGuide(settingsOf(config)),
      ['ruleAnswer', 'compose'],
    )
    .addConditionalEdges(
      'agent',
      (state: ChatGraphState, config: LangGraphRunnableConfig) =>
        routeAfterAgent(state, settingsOf(config)),
      ['tools', 'setupGuide', 'ruleAnswer', 'compose'],
    )
    .addEdge('tools', 'agent')
    .addEdge('costRefusal', 'compose')
    .addEdge('ruleAnswer', 'compose')
    .addEdge('compose', END)
    .compile();
}

export type ChatGraph = ReturnType<typeof buildChatGraph>;
