import { dependencies } from '../../../package.json';

import { causeChain, classNameOf, CONTEXT_OVERFLOW_ERROR, isNetworkError } from './error-chain';
import { requestGuardOf } from './request-guard';
import { maskString } from '../log';

/**
 * 벤더 오류 진단 필드 (PRAMI-003 §4.5.1 r2 최종 계약): `chat.llm_error` 구조화 로그에 원인을 남긴다 — **비밀값 없이**.
 * 남기는 것: HTTP 상태, 벤더 오류 type·code(허용 목록, 밖이면 `other`)·param(소문자 식별자만), 벤더 요청 id, LangChain 오류 코드
 * (허용 목록), SDK 오류 클래스 이름(`cause` 체인), (로컬 예외면) 맨 위 스택 프레임 함수 이름. 어댑터·시도 수·지연은 호출자가 붙인다.
 * 남기지 않는 것: 오류 메시지(벤더 원문에 키·요청 일부가 반복될 수 있음, T-6/T-17), 헤더, 요청 본문, 사용자 메시지.
 * 예외: 개발 환경(`NODE_ENV=development`)에서만 `debugMessage`(maskString — 키 형식·Bearer·URL userinfo 마스킹 후 120자) — production·preview 빌드에는 없다.
 * `requestId` 는 로거 규약상 **앱 요청 id** 다 — 벤더 요청 id 는 `vendorRequestId` (r2, QA M-1 충돌 해소).
 */
const DEPRECATED_TOKEN = 'deprecated';

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
  // xAI 본문 code (더미 키 관측값·문서 404 예시, PRAMI-003 §4.7.5 — 하이픈·콜론 형식이라 OpenAI 와 겹치지 않는다)
  'invalid-argument',
  'unauthenticated:no-credentials',
  'not-found',
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
  // 공통 파생 토큰 (§4.7.7 ②·③): 본문 메시지의 고정 패턴 일치 여부만 뽑은 값, 응답 사후 검사의 서버측 도구 사용
  DEPRECATED_TOKEN,
  'server_tool_used',
] as const;

/**
 * 폐기(deprecation) 고정 패턴 (§4.7.7 ②) — 벤더 사람용 메시지는 **이 패턴 일치 여부만** 보고 즉시 버린다.
 * 남는 것은 고정 토큰 `deprecated` 1개뿐이다(메시지 원문은 로그·응답·SSE·감사 어디에도 없다, PRAMI-002 T-6).
 */
const DEPRECATION_PATTERN = /deprecat(ed|ion)/i;

export function deprecationToken(message: unknown): typeof DEPRECATED_TOKEN | undefined {
  return typeof message === 'string' && DEPRECATION_PATTERN.test(message)
    ? DEPRECATED_TOKEN
    : undefined;
}

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
  /** 사람용 메시지 — 폐기 패턴 판정에만 쓰고 기록하지 않는다 */
  message?: unknown;
  error?: Body;
};

type ErrorShape = Body & {
  requestID?: unknown;
  request_id?: unknown;
  headers?: unknown;
  lc_error_code?: unknown;
  errorDetails?: unknown;
  stack?: unknown;
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
  // 실제 HTTP 응답이 있으면 신호보다 우선 — 응답 직후 끊김·타이머가 벤더 오류를 가리지 않게 (리뷰 후속)
  if (typeof error.status === 'number') return 'http';
  if (signals?.timedOut) return 'timeout';
  if (signals?.aborted) return 'abort';
  if (isNetworkError(raw)) return 'network';
  // 신호 정보가 없는 호출자(검증 등) — 이름으로만
  const name = classNameOf(error);
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'abort';
  return 'local';
}

/**
 * 오류 체인(자신 + cause 3단계)과 본문(`error.message`·`error.error.message`)의 사람용 메시지 중 폐기 패턴이 있는지 —
 * 벤더 공통. xAI 는 `withXaiErrorBody` 가 원문을 버리기 전에 같은 판정을 하고 고정 토큰만 남긴다(xai-chat.ts).
 */
function deprecationOf(raw: unknown): string | undefined {
  const messages = causeChain(raw).flatMap((link) => {
    const body = (link as ErrorShape).error;
    return [link.message, body?.message, body?.error?.message];
  });
  return messages.map(deprecationToken).find(Boolean);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function describeLlmError(raw: unknown, signals?: CallAbortState): LlmErrorDiagnostics {
  if (!raw || typeof raw !== 'object') {
    return { source: signals?.timedOut ? 'timeout' : signals?.aborted ? 'abort' : 'local' };
  }
  const guard = requestGuardOf(raw);
  if (guard) return { source: 'local', sdkErrorName: guard.name, frame: guard.frame };
  // LangChain 컨텍스트 초과 래퍼는 상태·본문을 잃는다 — 원래 SDK 오류(cause)로 진단한다 (L-1 r3: sdkErrorName = BadRequestError)
  const unwrapped = (raw as ErrorShape & { cause?: unknown }).cause;
  if (
    classNameOf(raw as ErrorShape) === CONTEXT_OVERFLOW_ERROR &&
    unwrapped &&
    typeof unwrapped === 'object'
  ) {
    return describeLlmError(unwrapped, signals);
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
    vendorErrorCode:
      deprecationOf(raw) ??
      allowlisted(
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
  return typeof message === 'string' ? maskString(message).slice(0, DEBUG_MESSAGE_MAX) : undefined;
}

/** 벤더별 LangChain 어댑터 패키지·버전 (package.json 고정 버전) */
const ADAPTER_PACKAGES: Record<string, keyof typeof dependencies> = {
  anthropic: '@langchain/anthropic',
  openai: '@langchain/openai',
  openrouter: '@langchain/openai',
  google: '@langchain/google-genai',
  // xAI 는 OpenAI 호환 Responses — 같은 패키지를 프로필만 바꿔 쓴다 (PRAMI-003 §4.7.2)
  xai: '@langchain/openai',
};

export function adapterOf(vendor: string | null): string | undefined {
  const name = vendor ? ADAPTER_PACKAGES[vendor] : undefined;
  return name ? `${name}@${dependencies[name]}` : undefined;
}
