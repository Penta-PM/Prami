import { isNetworkError } from './error-chain';
import { requestGuardOf } from './request-guard';

/**
 * 벤더 오류 정규화 (PRAMI-002 §4.8.3 + PRAMI-003 §4.5.5 L-2). 판정 순서: 요청 가드 → 타임아웃 → 컨텍스트 초과 → `err.status` →
 * `lc_error_code` → 벤더 본문 코드 → 연결 오류(cause 체인).
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
  /** 벤더가 요청 형식·파라미터를 거부(400/422 invalid_request 등) — 어댑터·모델 조합 결함 신호 (PRAMI-003, §4.8.3 보강) */
  'request_rejected',
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
  // 410 Gone = 벤더가 요청 기능을 폐기(예: xAI `search_parameters` → "Live search is deprecated", PRAMI-003 B-1) —
  // 키·모델 문제가 아니라 어댑터 요청 형태 결함이다. 벤더 공통 (§4.7.7 ②)
  if (status === 410) return 'request_rejected';
  // 그 밖의 400·422 = 벤더가 요청을 거부 (예: OpenAI invalid_request_error param=reasoning_effort, PRAMI-003)
  // 415(본문·Content-Type, xAI 문서 debugging) 도 어댑터 결함 신호 (PRAMI-003 §4.7.5)
  if (status === 400 || status === 415 || status === 422) return 'request_rejected';
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

/**
 * 컨텍스트 초과 (L-2 ①) → too_long("대화를 새로 시작해주세요"). OpenAI·xAI 는 400 + 본문 코드 `context_length_exceeded`
 * (설치 버전 @langchain/openai 1.6.0 은 CONTEXT_OVERFLOW 를 붙이지 않는다 — 전송 가로채기로 확인), Anthropic 은 `request_too_large`(413).
 */
function isContextOverflow(error: ErrorLike, bodyCodes: readonly string[]): boolean {
  if (error.lc_error_code === 'CONTEXT_OVERFLOW') return true;
  if (bodyCodes.includes('request_too_large')) return true;
  return error.status === 400 && bodyCodes.includes('context_length_exceeded');
}

function isTimeout(error: ErrorLike): boolean {
  return error.name === 'TimeoutError' || error.name === 'AbortError' || error.code === 'ETIMEDOUT';
}

export function normalizeLlmError(raw: unknown): LlmErrorCode {
  if (!raw || typeof raw !== 'object') return 'llm_error';
  const error = raw as ErrorLike;
  // 전송 전 요청 가드(§4.7.7 ①) — SDK 가 APIConnectionError 로 감싸도 연결 오류가 아니다
  if (requestGuardOf(raw)) return 'llm_error';
  if (isTimeout(error)) return 'unavailable';
  const bodyCodes = bodyCodesOf(error);
  if (isContextOverflow(error, bodyCodes)) return 'too_long';
  if (typeof error.status === 'number') {
    const byStatus = fromStatus(error.status, bodyCodes);
    if (byStatus) return byStatus;
  }
  if (typeof error.lc_error_code === 'string' && LC_CODES[error.lc_error_code]) {
    return LC_CODES[error.lc_error_code]!;
  }
  for (const code of bodyCodes) if (BODY_CODES[code]) return BODY_CODES[code]!;
  // 연결 오류 (L-2 ②): APIConnectionError·fetch failed·ECONNRESET 등 — cause 체인 3단계까지
  if (isNetworkError(raw)) return 'unavailable';
  return 'llm_error';
}

/** 자격 증명 상태를 바꿔야 하는 인증 계열 (→ setupGuide) */
export function isAuthError(code: LlmErrorCode): code is 'invalid_key' | 'forbidden' {
  return code === 'invalid_key' || code === 'forbidden';
}

/** 규칙 폴백으로 넘기는 일시·기타 오류 */
export function isTransientError(code: LlmErrorCode): boolean {
  return (
    code === 'rate_limited' ||
    code === 'unavailable' ||
    code === 'request_rejected' ||
    code === 'llm_error'
  );
}
