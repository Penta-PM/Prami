/**
 * 벤더 오류 정규화 (PRAMI-002 §4.8.3). 판정 순서: `err.status` → `lc_error_code` → 벤더 본문 코드.
 * 벤더·SDK 오류 **메시지는 절대 쓰지 않는다** — 벤더 원문(키 반복 가능, T-6)이 응답·로그로 새지 않게 코드만 돌려준다.
 * (설치 버전 확인: @langchain/anthropic 1.5.11 은 SDK 오류의 `.status` 를 보존하고 `lc_error_code` 에
 *  MODEL_AUTHENTICATION·MODEL_RATE_LIMIT·MODEL_NOT_FOUND 를 붙인다. 메시지에는 벤더 본문 JSON 이 들어 있다.)
 */
export const LLM_ERROR_CODES = [
  'invalid_key',
  'forbidden',
  'model_not_found',
  'rate_limited',
  'unavailable',
  'refused',
  'too_long',
  'llm_error',
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

type ErrorLike = {
  status?: unknown;
  lc_error_code?: unknown;
  name?: unknown;
  code?: unknown;
  error?: unknown;
};

const LC_CODES: Record<string, LlmErrorCode> = {
  MODEL_AUTHENTICATION: 'invalid_key',
  MODEL_NOT_FOUND: 'model_not_found',
  MODEL_RATE_LIMIT: 'rate_limited',
  CONTEXT_OVERFLOW: 'too_long',
};

/** 벤더 본문의 기계용 코드(OpenAI invalid_api_key·insufficient_quota, Gemini API_KEY_INVALID 등 — PR-C 벤더 포함) */
const BODY_CODES: Record<string, LlmErrorCode> = {
  invalid_api_key: 'invalid_key',
  API_KEY_INVALID: 'invalid_key',
  authentication_error: 'invalid_key',
  PERMISSION_DENIED: 'forbidden',
  permission_error: 'forbidden',
  insufficient_quota: 'rate_limited',
  RESOURCE_EXHAUSTED: 'rate_limited',
  rate_limit_error: 'rate_limited',
  not_found_error: 'model_not_found',
  overloaded_error: 'unavailable',
};

function fromStatus(status: number, bodyCodes: readonly string[]): LlmErrorCode | null {
  if (status === 401) return 'invalid_key';
  if (status === 400 && bodyCodes.includes('API_KEY_INVALID')) return 'invalid_key';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status >= 500) return 'unavailable';
  return null;
}

/**
 * 본문 객체에서 코드 후보 문자열만 모은다 — 벤더별 오류 형태(설치 버전으로 확인):
 * Anthropic/LangChain `error.error.{type,code,status,details[].reason}`, OpenAI SDK `error.{type,code}`·`code`,
 * Gemini SDK(GoogleGenerativeAIFetchError) `errorDetails[].reason`. 메시지 문자열은 읽지 않는다.
 */
type Body = { type?: unknown; code?: unknown; status?: unknown; details?: unknown; error?: Body };

function reasons(details: unknown): unknown[] {
  return Array.isArray(details) ? (details as { reason?: unknown }[]).map((d) => d?.reason) : [];
}

function bodyCodesOf(error: ErrorLike & { errorDetails?: unknown }): string[] {
  const body = error.error as Body | undefined;
  const inner = body?.error;
  return [
    body?.type,
    body?.code,
    body?.status,
    inner?.type,
    inner?.code,
    inner?.status,
    error.code,
    ...reasons(body?.details),
    ...reasons(inner?.details),
    ...reasons(error.errorDetails),
  ].filter((value): value is string => typeof value === 'string');
}

function isTimeout(error: ErrorLike): boolean {
  return error.name === 'TimeoutError' || error.name === 'AbortError' || error.code === 'ETIMEDOUT';
}

export function normalizeLlmError(raw: unknown): LlmErrorCode {
  if (!raw || typeof raw !== 'object') return 'llm_error';
  const error = raw as ErrorLike;
  if (isTimeout(error)) return 'unavailable';
  const bodyCodes = bodyCodesOf(error);
  if (typeof error.status === 'number') {
    const byStatus = fromStatus(error.status, bodyCodes);
    if (byStatus) return byStatus;
  }
  if (typeof error.lc_error_code === 'string' && LC_CODES[error.lc_error_code]) {
    return LC_CODES[error.lc_error_code]!;
  }
  for (const code of bodyCodes) if (BODY_CODES[code]) return BODY_CODES[code]!;
  if (error.name === 'APIConnectionError' || error.code === 'ECONNRESET') return 'unavailable';
  return 'llm_error';
}

/** 자격 증명 상태를 바꿔야 하는 인증 계열 (→ setupGuide) */
export function isAuthError(code: LlmErrorCode): code is 'invalid_key' | 'forbidden' {
  return code === 'invalid_key' || code === 'forbidden';
}

/** 규칙 폴백으로 넘기는 일시·기타 오류 */
export function isTransientError(code: LlmErrorCode): boolean {
  return code === 'rate_limited' || code === 'unavailable' || code === 'llm_error';
}
