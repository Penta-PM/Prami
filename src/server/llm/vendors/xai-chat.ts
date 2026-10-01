/**
 * xAI 오류 본문 정규화 (PRAMI-003 §4.7.5). xAI 오류 본문은 `{"code": "invalid-argument", "error": "<사람용 메시지>"}` 형태다
 * (문서에 형식 없음 — Plan 조사의 더미 키 관측값). OpenAI SDK(openai 7.x `APIError.generate`)는 본문의 `error` 필드만
 * 오류 객체로 쓰고, JSON 이 아니면 본문 텍스트를 오류 메시지에 넣는다. 그대로 두면 ① 기계용 `code` 가 사라지고
 * ② 사람용 메시지·프록시 HTML 등(키·요청 일부가 반복될 수 있음, T-6)이 SDK 오류 메시지에 들어간다.
 * 그래서 2xx 가 아닌 **모든** 응답을 SDK 에 넘기기 전에 `{ error: { code } }` 로 바꾼다 — `code` 는 JSON 본문의 문자열일
 * 때만 남기고 나머지 본문은 버린다(저장·로그하지 않음). 상태·헤더(요청 id 등)는 그대로다.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export function withXaiErrorBody(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok || NULL_BODY_STATUSES.has(response.status)) return response;
    const code = await readCode(response);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify({ error: code ? { code } : {} }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

async function readCode(response: Response): Promise<string | undefined> {
  try {
    const body = JSON.parse(await response.text()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}
