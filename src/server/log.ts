/**
 * 구조화 로그 (§4.8 관측): 한 줄 JSON (`level`, `event`, `requestId`, `time`, …) → Vercel 로그에서 필드로 검색된다.
 * 외부 의존(pino) 없이 console 로 쓴다 — 서버리스 번들 크기를 늘리지 않기 위함. 비밀값은 키 이름·값 패턴 두 겹으로 가린다.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export const MASK = '[REDACTED]';

/** 키 이름에 이 단어가 들어가면 값을 통째로 가린다 */
const SECRET_KEY_RE =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|database_url|credential|session/i;

/** 값 안에 섞인 비밀값 패턴: URL 의 userinfo, Bearer 토큰 */
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s/@]+)@/gi;
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g;

export function maskString(value: string): string {
  return value.replace(URL_USERINFO_RE, `$1$2:${MASK}@`).replace(BEARER_RE, `$1 ${MASK}`);
}

const MAX_DEPTH = 5;

export function maskValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value instanceof Error) return serializeError(value, depth);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => maskValue(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_RE.test(key) ? MASK : maskValue(entry, depth + 1),
    ]),
  );
}

function serializeError(error: Error, depth: number): Record<string, unknown> {
  const withCode = error as Error & { code?: unknown; cause?: unknown };
  return {
    name: error.name,
    message: maskString(error.message),
    code: withCode.code,
    stack: error.stack ? maskString(error.stack).split('\n').slice(0, 8).join('\n') : undefined,
    cause: withCode.cause === undefined ? undefined : maskValue(withCode.cause, depth + 1),
  };
}

export type LogRecord = { level: LogLevel; event: string; time: string } & LogFields;

export function formatLog(level: LogLevel, event: string, fields: LogFields = {}): LogRecord {
  return {
    level,
    event,
    time: new Date().toISOString(),
    ...(maskValue(fields) as LogFields),
  };
}

const SINK: Record<LogLevel, (line: string) => void> = {
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function write(level: LogLevel, event: string, fields?: LogFields): void {
  SINK[level](JSON.stringify(formatLog(level, event, fields)));
}

export const logger = {
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};
