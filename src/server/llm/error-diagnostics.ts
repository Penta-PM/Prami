import { dependencies } from '../../../package.json';

import { causeChain, classNameOf, isNetworkError } from './error-chain';
import { sanitizeForLog } from '../log';

/**
 * 벤더 오류 진단 필드 (PRAMI-003 §4.5.1 r2 최종 계약): `chat.llm_error` 구조화 로그에 원인을 남긴다 — **비밀값 없이**.
 * 남기는 것: HTTP 상태, 벤더 오류 type·code(허용 목록, 밖이면 `other`)·param(소문자 식별자만), 벤더 요청 id, LangChain 오류 코드
 * (허용 목록), SDK 오류 클래스 이름(`cause` 체인), (로컬 예외면) 맨 위 스택 프레임 함수 이름. 어댑터·시도 수·지연은 호출자가 붙인다.
 * 남기지 않는 것: 오류 메시지(벤더 원문에 키·요청 일부가 반복될 수 있음, T-6/T-17), 헤더, 요청 본문, 사용자 메시지.
 * 예외: 개발 환경(`NODE_ENV=development`)에서만 `debugMessage`(sanitizeForLog 후 120자) — production·preview 빌드에는 없다.
 * `requestId` 는 로거 규약상 **앱 요청 id** 다 — 벤더 요청 id 는 `vendorRequestId` (r2, QA M-1 충돌 해소).
 */
export const LLM_VENDOR_ERROR_TOKENS = [
  // 공통·OpenAI·xAI
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'not_found_error',
  'rate_limit_error',
  'server_error',
  'api_error',
  'invalid_api_key',
  'insufficient_quota',
  'model_not_found',
  'context_length_exceeded',
  'unsupported_parameter',
  'unsupported_value',
  'invalid_value',
  'content_filter',
  // Anthropic
  'overloaded_error',
  'request_too_large',
  // Gemini
  'API_KEY_INVALID',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'INVALID_ARGUMENT',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  // 응답 판정 (§4.5.5 L-1)
  'refusal',
  'incomplete_max_output_tokens',
  'incomplete_content_filter',
  'incomplete_other',
  'empty_output',
] as const;

/** 허용 목록 밖 값 */
export const OTHER_TOKEN = 'other';

export const LC_ERROR_CODES = [
  'MODEL_AUTHENTICATION',
  'MODEL_NOT_FOUND',
  'MODEL_RATE_LIMIT',
  'CONTEXT_OVERFLOW',
  'INVALID_PROMPT_INPUT',
  'INVALID_TOOL_RESULTS',
  'OUTPUT_PARSING_FAILURE',
] as const;

/**
 * `timeout` = 앱 타임아웃 신호, `abort` = 클라이언트 중단(SSE 끊김)만, `network` = 연결 오류,
 * `response` = 2xx 인데 거부·미완료·빈 출력(§4.5.5), `local` = 그 외 로컬 예외
 */
export type LlmErrorSource = 'http' | 'timeout' | 'abort' | 'network' | 'local' | 'response';

export type LlmErrorDiagnostics = {
  source: LlmErrorSource;
  httpStatus?: number;
  vendorErrorType?: string;
  vendorErrorCode?: string;
  vendorErrorParam?: string;
  vendorRequestId?: string;
  lcCode?: string;
  sdkErrorName?: string;
  frame?: string;
};

/** 어느 신호가 모델 호출을 끊었는지 (agent 노드가 판별 — L-4) */
export type CallAbortState = { timedOut: boolean; aborted: boolean };

const TOKENS: ReadonlySet<string> = new Set(LLM_VENDOR_ERROR_TOKENS);
const LC_CODES: ReadonlySet<string> = new Set(LC_ERROR_CODES);
const PARAM_RE = /^[a-z][a-z0-9_.[\]]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CLASS_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const FRAME_RE = /^[A-Za-z_$][\w$.]{0,99}$/;
const DEBUG_MESSAGE_MAX = 120;

type Body = {
  type?: unknown;
  code?: unknown;
  status?: unknown;
  param?: unknown;
  details?: unknown;
  error?: Body;
};

type ErrorShape = Body & {
  requestID?: unknown;
  request_id?: unknown;
  headers?: unknown;
  lc_error_code?: unknown;
  errorDetails?: unknown;
  stack?: unknown;
  message?: unknown;
};

const strings = (values: unknown[]): string[] =>
  values.filter((value): value is string => typeof value === 'string');

function reasons(details: unknown): unknown[] {
  return Array.isArray(details) ? (details as { reason?: unknown }[]).map((d) => d?.reason) : [];
}

/** 후보 중 허용 목록 값이 있으면 그것, 후보는 있는데 모두 목록 밖이면 `other`, 후보가 없으면 생략 */
function allowlisted(candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.find((value) => TOKENS.has(value)) ?? OTHER_TOKEN;
}

function headerOf(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  return (headers as Record<string, unknown>)[name];
}

function vendorRequestIdOf(error: ErrorShape): string | undefined {
  return strings([
    error.requestID,
    error.request_id,
    headerOf(error.headers, 'x-request-id'),
    headerOf(error.headers, 'request-id'),
  ]).find((value) => REQUEST_ID_RE.test(value));
}

/** `cause` 체인에서 `Error` 가 아닌 첫 클래스 이름 (L-4: 래핑 후에도 BadRequestError·APIConnectionError) */
function sdkErrorNameOf(raw: unknown): string | undefined {
  const names = causeChain(raw).map(classNameOf);
  const found = names.find((name) => name && name !== 'Error') ?? names[0];
  return found && CLASS_NAME_RE.test(found) ? found : undefined;
}

/** 스택에서 메시지 줄을 건너뛴 첫 프레임의 함수 이름만 ("at fn (" 의 fn) */
function topFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frame = stack.split('\n').find((line) => /^\s+at\s/.test(line));
  const name = /^\s+at\s+([^\s(]+)\s+\(/.exec(frame ?? '')?.[1];
  return name && FRAME_RE.test(name) ? name : undefined;
}

function sourceOf(
  raw: unknown,
  error: ErrorShape,
  signals: CallAbortState | undefined,
): LlmErrorSource {
  if (signals?.timedOut) return 'timeout';
  if (signals?.aborted) return 'abort';
  if (typeof error.status === 'number') return 'http';
  if (isNetworkError(raw)) return 'network';
  // 신호 정보가 없는 호출자(검증 등) — 이름으로만
  const name = classNameOf(error);
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'abort';
  return 'local';
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function describeLlmError(raw: unknown, signals?: CallAbortState): LlmErrorDiagnostics {
  if (!raw || typeof raw !== 'object') {
    return { source: signals?.timedOut ? 'timeout' : signals?.aborted ? 'abort' : 'local' };
  }
  const error = raw as ErrorShape;
  const body = error.error ?? {};
  const inner = body.error ?? {};
  const source = sourceOf(raw, error, signals);
  const param = strings([error.param, body.param, inner.param]).find((value) =>
    PARAM_RE.test(value),
  );
  const lcCode = typeof error.lc_error_code === 'string' ? error.lc_error_code : undefined;
  return withoutUndefined<LlmErrorDiagnostics>({
    source,
    httpStatus: typeof error.status === 'number' ? error.status : undefined,
    vendorErrorType: allowlisted(
      strings([error.type, inner.type, body.type, inner.status, body.status]),
    ),
    vendorErrorCode: allowlisted(
      strings([
        error.code,
        inner.code,
        body.code,
        ...reasons(inner.details),
        ...reasons(body.details),
        ...reasons(error.errorDetails),
      ]),
    ),
    vendorErrorParam: param,
    vendorRequestId: vendorRequestIdOf(error),
    lcCode: lcCode && LC_CODES.has(lcCode) ? lcCode : undefined,
    sdkErrorName: sdkErrorNameOf(raw),
    frame: source === 'local' ? topFrame(error.stack) : undefined,
  });
}

/** 개발 환경 전용 디버그 메시지 (§4.5.1) — production·preview·test 에서는 항상 undefined */
export function debugMessageOf(raw: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  const message = (raw as { message?: unknown } | null)?.message;
  return typeof message === 'string'
    ? sanitizeForLog(message).slice(0, DEBUG_MESSAGE_MAX)
    : undefined;
}

/** 벤더별 LangChain 어댑터 패키지·버전 (package.json 고정 버전) */
const ADAPTER_PACKAGES: Record<string, keyof typeof dependencies> = {
  anthropic: '@langchain/anthropic',
  openai: '@langchain/openai',
  openrouter: '@langchain/openai',
  google: '@langchain/google-genai',
};

export function adapterOf(vendor: string | null): string | undefined {
  const name = vendor ? ADAPTER_PACKAGES[vendor] : undefined;
  return name ? `${name}@${dependencies[name]}` : undefined;
}
