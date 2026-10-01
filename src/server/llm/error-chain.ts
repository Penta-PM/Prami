/**
 * 오류 `cause` 체인 판정 (PRAMI-003 §4.5.5 L-2·L-4). LangChain·벤더 SDK 는 원인 오류를 `cause` 로 감싼다 — 설치 버전 확인
 * (`@langchain/openai` 1.6.0·`@langchain/anthropic` 1.5.11, 전송 가로채기): 소켓 끊김 = `APIConnectionError`(name 은 `Error`,
 * 생성자 이름이 클래스) → `TypeError` → `{ code: 'ECONNRESET' }`. 판정은 자기 자신 + `cause` 최대 3단계만 본다.
 * 오류 **메시지는 기록하지 않는다** — undici 고정 문구 `fetch failed` 일치 비교만 한다(벤더 원문 아님).
 */
export const CAUSE_DEPTH = 3;

type ErrorObject = { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };

export function causeChain(raw: unknown, depth = CAUSE_DEPTH): ErrorObject[] {
  const chain: ErrorObject[] = [];
  let current: unknown = raw;
  while (current && typeof current === 'object' && chain.length <= depth) {
    chain.push(current as ErrorObject);
    current = (current as ErrorObject).cause;
  }
  return chain;
}

/** 오류 객체의 클래스 이름 후보: `name` 이 일반 `Error` 면 생성자 이름 (SDK 클래스는 name 을 바꾸지 않는다) */
export function classNameOf(error: ErrorObject): string | undefined {
  if (typeof error.name === 'string' && error.name !== 'Error') return error.name;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof ctor === 'string' ? ctor : undefined;
}

const NETWORK_ERROR_CLASSES = new Set(['APIConnectionError', 'APIConnectionTimeoutError']);
const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const UNDICI_FETCH_FAILED = 'fetch failed';

function isNetworkLink(error: ErrorObject): boolean {
  const name = classNameOf(error);
  if (name && NETWORK_ERROR_CLASSES.has(name)) return true;
  if (name === 'TypeError' && error.message === UNDICI_FETCH_FAILED) return true;
  const code = typeof error.code === 'string' ? error.code : '';
  return NETWORK_ERROR_CODES.has(code) || code.startsWith('UND_ERR_');
}

/** 연결 계층 오류 (L-2: → `unavailable`, `source='network'`) */
export function isNetworkError(raw: unknown): boolean {
  return causeChain(raw).some(isNetworkLink);
}

/**
 * LangChain 컨텍스트 초과 래퍼 (`@langchain/core` `ContextOverflowError`, PRAMI-003 L-1 r3) — 자신 또는 cause 체인의 클래스 이름.
 * `@langchain/openai` 1.6.0 `wrapOpenAIClientError` 가 원래 SDK 오류를 cause 로 감싼다.
 */
export const CONTEXT_OVERFLOW_ERROR = 'ContextOverflowError';

export function isContextOverflowWrapper(raw: unknown): boolean {
  return causeChain(raw).some((link) => classNameOf(link) === CONTEXT_OVERFLOW_ERROR);
}
