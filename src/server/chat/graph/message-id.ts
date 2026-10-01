import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';

/**
 * 그래프 메시지 고유 id (PRAMI-003 §4.5.4 H1-1·H1-2, 결함 H-1).
 * `streamMode` 에 `messages` 가 있으면 LangGraph(1.4.18)가 노드가 반환한 **id 없는** 메시지에 그 노드 실행의 id
 * `run-<runId>` 를 똑같이 붙이고, add-messages 리듀서(MessagesValue)는 같은 id 를 덮어쓰기로 합친다 — prepare 의
 * System·이력·Human 이 마지막 Human 하나로 줄어 SSE 경로 모델 입력에서 시스템 프롬프트·이력이 빠졌다.
 * 노드는 메시지를 만들 때 이 헬퍼로 id 를 채운다 — 스트림 모드·LangGraph 내부 동작에 의존하지 않는다.
 */
/** id 가 없으면 `crypto.randomUUID()` 로 채운다 (있으면 그대로) — 같은 인스턴스를 돌려준다 */
export function withMessageId<T extends BaseMessage>(message: T): T {
  if (!message.id) message.id = crypto.randomUUID();
  return message;
}

/**
 * 모델이 반환한 AI 메시지 (H1-2): id 가 없을 때만 새 id. 있는 id 는 유지한다 — 벤더 응답 id 또는 SSE 에서 LangGraph 가 붙인
 * `run-<모델 호출 run id>`(모델 호출마다 다름 → 같은 턴의 AI 메시지 2개가 합쳐지지 않는다). `run-` id 를 바꾸면 메시지 스트림
 * 처리기의 id 중복 제거(seen)를 벗어나 같은 답이 노드 출력으로 한 번 더 방출돼 SSE 토큰이 두 번 나간다(H1-4·H1-5 위반, 테스트로 확인).
 */
export const withModelMessageId = withMessageId;

/** 모델 입력 불변식 위반 사유 (로그용 — 본문 없음) */
export type MessageInvariantViolation =
  'missing_id' | 'duplicate_id' | 'system_not_first' | 'history_lost';

/**
 * 모델 호출 직전 입력 불변식 (H1-3): 모든 id 가 있고 유일, System 은 맨 앞에 1개, `[System, …이력, Human]` 접두가 보존됐다
 * (`prefixLength` = 1 + 이력 수 + 1 — 그 위치가 마지막 Human = 이번 질문). 통과면 null.
 */
export function checkModelInput(
  messages: readonly BaseMessage[],
  prefixLength: number,
): MessageInvariantViolation | null {
  const ids = messages.map((message) => message.id);
  if (ids.some((id) => !id)) return 'missing_id';
  if (new Set(ids).size !== ids.length) return 'duplicate_id';
  const systems = messages.filter((message) => message instanceof SystemMessage).length;
  if (!(messages[0] instanceof SystemMessage) || systems !== 1) return 'system_not_first';
  const question = messages.findLastIndex((message) => message instanceof HumanMessage);
  if (question !== prefixLength - 1) return 'history_lost';
  return null;
}
