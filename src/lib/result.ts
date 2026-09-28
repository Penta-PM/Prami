/**
 * Server Action / Route Handler 공통 응답 봉투 (§4.7).
 * 예외를 클라이언트로 흘리지 않고 코드·메시지로 변환한다.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

export type ActionError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  /** 오류에 딸린 안내 데이터 (예: 409 의 기존 배치 id) */
  details?: Record<string, unknown>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): { ok: false; error: ActionError } {
  return { ok: false, error: fieldErrors ? { code, message, fieldErrors } : { code, message } };
}

/** HTTP 응답으로 내보낼 때의 상태 코드 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

/** 서버 코드에서 던지고 경계(action/route 래퍼)에서 봉투로 바꾸는 오류 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
