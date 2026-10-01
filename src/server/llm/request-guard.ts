import { causeChain } from './error-chain';

/**
 * 어댑터 요청 가드 오류 (PRAMI-003 §4.7.7 ①, r3 B-1). 전송 직전 본문 검사가 금지 키를 찾으면 **전송하지 않고** 이 오류를 던진다
 * (fail-closed). SDK 가 fetch 예외를 `APIConnectionError` 로 감싸므로 판정은 `cause` 체인으로 한다 — 연결 오류(`unavailable`)
 * 로 오분류하지 않고 `llm_error` + `source='local'` + `frame=<가드 이름>` 이 된다. 메시지는 고정 문구(본문·키 없음).
 */
export class LlmRequestGuardError extends Error {
  override name = 'LlmRequestGuardError';
  constructor(readonly frame: string) {
    super('vendor request blocked by adapter guard');
  }
}

/** 오류 또는 `cause` 체인(3단계)의 요청 가드 오류 */
export function requestGuardOf(raw: unknown): LlmRequestGuardError | undefined {
  return causeChain(raw).find(
    (link): link is LlmRequestGuardError => link instanceof LlmRequestGuardError,
  );
}
