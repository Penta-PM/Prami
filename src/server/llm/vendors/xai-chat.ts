import { deprecationToken } from '../error-diagnostics';
import { LlmRequestGuardError } from '../request-guard';

/**
 * xAI 전송 계층 (PRAMI-003 §4.7.5·§4.7.7) — 어댑터가 주입한 `fetch` 를 세 겹으로 감싼다. 실벤더로 나가는 바이트는 바꾸지 않는다.
 * ① 요청 가드(`withXaiRequestGuard`): 전송 직전 본문에 금지 키가 있으면 보내지 않는다
 * ② 오류 본문 정규화(`withXaiErrorBody`): 사람용 메시지를 버리고 기계용 `code` 만 SDK 에 넘긴다
 * ③ 서버측 도구 사후 검사(`withXaiServerToolCheck`): 2xx 응답이 서버측 도구(검색 등)를 썼으면 호출자에게 알린다
 */

/**
 * ① 요청 가드 (§4.7.7 ①, r3 B-1). xAI 는 `search_parameters` 가 있으면 `mode:'off'` 여도 인증보다 먼저
 * 410 "Live search is deprecated" 로 거부한다(PR #22 QA 더미 키 관측). `max_turns` 는 에이전트(서버측) 도구용,
 * `function` 이 아닌 도구(web_search·x_search·코드 실행·MCP 등)는 서버측 검색·실행 경로다. 어느 것이든 본문에 있으면
 * **전송하지 않고** `LlmRequestGuardError` 를 던진다(fail-closed — LangChain 기본값·코드 변경으로 다시 들어오는 것 차단).
 * 본문을 읽을 수 없으면(문자열 JSON 이 아님) 역시 막는다. 본문 없는 요청(검증 GET 등)은 그대로 보낸다.
 */
export const XAI_REQUEST_GUARD_FRAME = 'xai_request_guard';
const FORBIDDEN_BODY_KEYS = ['search_parameters', 'max_turns'] as const;

function forbiddenBody(body: unknown): boolean {
  if (typeof body !== 'string') return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return true;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true;
  const request = parsed as { tools?: unknown };
  if (FORBIDDEN_BODY_KEYS.some((key) => key in request)) return true;
  if (request.tools === undefined) return false;
  if (!Array.isArray(request.tools)) return true;
  return request.tools.some((tool) => (tool as { type?: unknown } | null)?.type !== 'function');
}

export function withXaiRequestGuard(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (init?.body !== undefined && init.body !== null && forbiddenBody(init.body)) {
      throw new LlmRequestGuardError(XAI_REQUEST_GUARD_FRAME);
    }
    return baseFetch(input, init);
  };
}

/**
 * ② 오류 본문 정규화. xAI 오류 본문은 `{"code": "invalid-argument", "error": "<사람용 메시지>"}` 형태다
 * (문서에 형식 없음 — 더미 키 관측값. 410 은 `code` 없이 `{"error": "Live search is deprecated…"}`). OpenAI SDK
 * (openai 7.x `APIError.generate`)는 본문의 `error` 필드만 오류 객체로 쓰고, JSON 이 아니면 본문 텍스트를 오류 메시지에 넣는다.
 * 그대로 두면 ① 기계용 `code` 가 사라지고 ② 사람용 메시지·프록시 HTML 등(키·요청 일부가 반복될 수 있음, T-6)이 SDK 오류
 * 메시지에 들어간다. 그래서 2xx 가 아닌 **모든** 응답을 SDK 에 넘기기 전에 `{ error: { code } }` 로 바꾼다 — `code` 는 JSON
 * 본문의 문자열일 때만 남기고 나머지 본문은 버린다(저장·로그하지 않음). 상태·헤더(요청 id 등)는 그대로다.
 * 버리기 전에 사람용 메시지가 폐기 고정 패턴(§4.7.7 ②)과 맞는지만 보고, 맞으면 SDK 메시지 자리에 고정 토큰 `deprecated` 만
 * 남긴다(공통 진단 `deprecationOf` 가 같은 패턴으로 읽는다).
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** 같은 상태로 본문만 바꾼 응답 — 길이·압축 헤더는 새 본문과 맞지 않으므로 뺀다 */
function withBody(response: Response, body: BodyInit, contentType?: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  if (contentType) headers.set('content-type', contentType);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export function withXaiErrorBody(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok || NULL_BODY_STATUSES.has(response.status)) return response;
    const { code, deprecated } = await readErrorBody(response);
    const error = { ...(code ? { code } : {}), ...(deprecated ? { message: deprecated } : {}) };
    return withBody(response, JSON.stringify({ error }), 'application/json');
  };
}

async function readErrorBody(response: Response): Promise<{ code?: string; deprecated?: string }> {
  try {
    const body = JSON.parse(await response.text()) as { code?: unknown; error?: unknown } | null;
    return {
      code: typeof body?.code === 'string' ? body.code : undefined,
      deprecated: deprecationToken(body?.error),
    };
  } catch {
    return {};
  }
}

/**
 * ③ 검색 비사용 사후 검사 (§4.7.7 ③, r3). 1차 보장은 ①(서버측 도구·`search_parameters` 미전송)이고 이것은 보조 방어다.
 * 설치 버전 @langchain/openai 1.6.0 은 비스트리밍 응답의 `usage` 를 `usage_metadata`(토큰 수만)로 바꿔
 * `num_server_side_tools_used`·`num_sources_used` 를 잃으므로 전송 계층에서 읽는다(JSON·SSE 공통).
 * 판정: `usage.num_server_side_tools_used > 0` 또는 `usage.num_sources_used > 0`, 또는 출력 항목에 서버측 도구 항목
 * (`message`·`reasoning`·`function_call` 이 아닌 항목 — web_search_call 등). 값이 없거나 0 이면 통과.
 * - JSON: 응답 전체를 먼저 읽어 판정한다(모델 텍스트가 어디로도 나가기 전).
 * - SSE: 바이트는 그대로 흘리며 이벤트를 읽는다. 서버측 도구 항목(`output_item.*`)이나 완료 이벤트 `usage` 에서 감지하면
 *   즉시 스트림을 끊는다. 완료 이벤트 전에 이미 나간 텍스트는 agent·SSE 가 refusal 과 같은 discard 로 폐기한다
 *   (점진 스트리밍 유지 — Main 결정 A, AC-368 ⑤ 편차).
 * 감지하면 `onServerToolUse` 를 부른다 — agent 가 그 모델 출력을 버리고 규칙 답으로 폴백한다.
 */
const CLIENT_OUTPUT_TYPES = new Set(['message', 'reasoning', 'function_call']);

type ResponseLike = { usage?: unknown; output?: unknown };

function positive(value: unknown): boolean {
  return typeof value === 'number' && value > 0;
}

function usedServerTool(usage: unknown): boolean {
  const counts = (usage ?? {}) as {
    num_server_side_tools_used?: unknown;
    num_sources_used?: unknown;
  };
  return positive(counts.num_server_side_tools_used) || positive(counts.num_sources_used);
}

function isServerToolItem(item: unknown): boolean {
  const type = (item as { type?: unknown } | null)?.type;
  return typeof type === 'string' && !CLIENT_OUTPUT_TYPES.has(type);
}

export function responseUsedServerTool(response: unknown): boolean {
  const body = (response ?? {}) as ResponseLike;
  const output = Array.isArray(body.output) ? body.output : [];
  return usedServerTool(body.usage) || output.some(isServerToolItem);
}

/** SSE 이벤트 1개(`data:` JSON) — 서버측 도구 항목 또는 완료·미완료 응답의 usage */
function eventUsedServerTool(event: unknown): boolean {
  const data = (event ?? {}) as { item?: unknown; response?: unknown };
  return isServerToolItem(data.item) || responseUsedServerTool(data.response);
}

export class XaiServerToolUsedError extends Error {
  override name = 'XaiServerToolUsedError';
  constructor() {
    super('vendor response used a server-side tool');
  }
}

function dataUsedServerTool(data: string): boolean {
  if (!data || data === '[DONE]') return false;
  try {
    return eventUsedServerTool(JSON.parse(data));
  } catch {
    return false;
  }
}

/**
 * SSE 응답 사후 검사 — 이벤트 단위로 판정한다(PR #22 QA I-18). SSE 규격상 한 이벤트의 `data:` 가 여러 줄이면 `\n` 으로 이어
 * 붙인 값이 데이터다(빈 줄이 이벤트 끝, `\r\n` 허용). 한 줄짜리 data 는 줄이 끝나는 즉시 판정한다(텍스트 델타보다 먼저 끊기).
 * 판정 실패(파싱 불가)는 통과 — 1차 요청 가드가 금지 파라미터를 이미 막았고, 이 검사는 2차 방어다.
 */
export function scanSse(body: ReadableStream<Uint8Array>, onDetect: () => void) {
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines: string[] = [];
  const endEvent = () => {
    const used = dataLines.length > 1 && dataUsedServerTool(dataLines.join('\n').trim());
    dataLines = [];
    return used;
  };
  const feed = (raw: string): boolean => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') return endEvent();
    if (!line.startsWith('data:')) return false;
    const value = line.slice('data:'.length);
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    return dataLines.length === 1 && dataUsedServerTool(value.trim());
  };
  const stop = (controller: TransformStreamDefaultController<Uint8Array>) => {
    onDetect();
    controller.error(new XaiServerToolUsedError());
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        if (lines.some(feed)) return stop(controller);
        controller.enqueue(chunk);
      },
      flush(controller) {
        const rest = pending + decoder.decode();
        if ((rest !== '' && feed(rest)) || endEvent()) stop(controller);
      },
    }),
  );
}

export function withXaiServerToolCheck(
  baseFetch: typeof fetch,
  onDetect: () => void,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || !response.body) return response;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream'))
      return withBody(response, scanSse(response.body, onDetect));
    if (!type.includes('application/json')) return response;
    const text = await response.text();
    try {
      if (responseUsedServerTool(JSON.parse(text))) onDetect();
    } catch {
      // 파싱 실패는 SDK 가 같은 본문으로 판정한다(응답 파싱 오류 → llm_error)
    }
    return withBody(response, text);
  };
}
