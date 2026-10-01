import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 요청 스코프 (PRAMI-003 §4.3.8, AC-363): runAction·runRoute 가 proxy 의 x-request-id 를 여기에 싣고,
 * 그 안에서 남기는 구조화 로그는 필드로 넘기지 않아도 `requestId` 를 갖는다. 스코프 밖(스크립트·기동)은 null.
 * log.ts 가 import 하므로 env.ts·next/headers 에 의존하지 않는다.
 */
type RequestContext = { requestId: string | null };

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(requestId: string | null, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function contextRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
