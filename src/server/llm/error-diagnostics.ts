import { dependencies } from '../../../package.json';

/**
 * 벤더 오류 진단 필드 (PRAMI-003): `chat.llm_error` 구조화 로그에 원인을 남긴다 — **비밀값 없이**.
 * 남기는 것: HTTP 상태, 벤더 오류 type·code·param, 벤더 요청 ID, LangChain 오류 코드, 오류 클래스 이름,
 * (HTTP 가 아닌 로컬 예외면) 맨 위 스택 프레임의 함수 이름. 어댑터 패키지·버전은 호출자가 붙인다.
 * 남기지 않는 것: 오류 메시지(벤더 원문에 키·요청 일부가 반복될 수 있음, T-6/T-17), 헤더, 요청 본문, 사용자 메시지.
 * 모든 문자열은 식별자 모양(영숫자·`_.-[]:/`, 100자 이하)일 때만 통과한다 — 그 외는 버린다.
 */
export type LlmErrorDiagnostics = {
  source: 'http' | 'timeout' | 'abort' | 'network' | 'local';
  status?: number;
  errorType?: string;
  errorCode?: string;
  errorParam?: string;
  requestId?: string;
  lcCode?: string;
  errorName?: string;
  frame?: string;
};

type ErrorShape = {
  status?: unknown;
  type?: unknown;
  code?: unknown;
  param?: unknown;
  requestID?: unknown;
  lc_error_code?: unknown;
  name?: unknown;
  stack?: unknown;
  error?: { type?: unknown; code?: unknown; param?: unknown; error?: unknown };
  constructor?: { name?: unknown };
};

const SAFE_TOKEN = /^[\w.\-[\]:/]{1,100}$/;

function safe(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
}

/** 스택에서 메시지 줄을 건너뛴 첫 프레임의 함수 이름만 ("at fn (" 의 fn) */
function topFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frame = stack.split('\n').find((line) => /^\s+at\s/.test(line));
  return safe(/^\s+at\s+([^\s(]+)\s+\(/.exec(frame ?? '')?.[1]);
}

function sourceOf(error: ErrorShape, status: number | undefined): LlmErrorDiagnostics['source'] {
  if (error.name === 'TimeoutError') return 'timeout';
  if (error.name === 'AbortError') return 'abort';
  if (status !== undefined) return 'http';
  const name = safe(error.name) ?? '';
  if (/Connection|Network|Fetch/i.test(name)) return 'network';
  return 'local';
}

export function describeLlmError(raw: unknown): LlmErrorDiagnostics {
  if (!raw || typeof raw !== 'object') return { source: 'local' };
  const error = raw as ErrorShape;
  const body = (error.error ?? {}) as NonNullable<ErrorShape['error']>;
  const inner = (body.error ?? {}) as NonNullable<ErrorShape['error']>;
  const status = typeof error.status === 'number' ? error.status : undefined;
  const source = sourceOf(error, status);
  const diagnostics: LlmErrorDiagnostics = {
    source,
    status,
    errorType: safe(error.type) ?? safe(body.type) ?? safe(inner.type),
    errorCode: safe(error.code) ?? safe(body.code) ?? safe(inner.code),
    errorParam: safe(error.param) ?? safe(body.param) ?? safe(inner.param),
    requestId: safe(error.requestID),
    lcCode: safe(error.lc_error_code),
    errorName: safe(error.name) ?? safe(error.constructor?.name),
    frame: source === 'local' ? topFrame(error.stack) : undefined,
  };
  return Object.fromEntries(
    Object.entries(diagnostics).filter(([, value]) => value !== undefined),
  ) as LlmErrorDiagnostics;
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
