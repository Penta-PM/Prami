import { defaultModelFor, modelsFor } from '../models';

/**
 * 가짜 벤더 검증기 (PRAMI-002 §9.1, `LLM_VENDOR_MODE=fake`). 실벤더 없이 E2E·QA 가 전 흐름을 재현한다.
 * 키 접두로 **HTTP 응답을 흉내** 내고, 판정·페이지 처리·사용 가능 모델 계산은 live 와 같은 코드를 거친다(fetch 만 대체).
 * production·VERCEL_ENV 에서는 env.ts 가 fake 모드 기동을 거부한다(AC-212).
 *
 * | 접두 | 흉내 내는 응답 |
 * | `fake-valid-` | 200 + 상수 모델 전부(+ 상수 밖 모델) 목록 |
 * | `fake-partial-` | 200 + 벤더 기본 모델만 있는 목록 (AC-207 ⑦ 교집합 일부) |
 * | `fake-paged-` | 200 + 목록을 2페이지로 나눔 (Anthropic after_id / Gemini pageToken) |
 * | `fake-pagefail-` | 1페이지 200 + 다음 페이지 500 → 정상이지만 사용 가능 모델 미확인(NULL) |
 * | `fake-nolist-` | 200 + 목록 형식이 아님 → 정상 + 미확인(NULL) |
 * | `fake-invalid-`, `fake-401-` | 401 |
 * | `fake-gemini400-` | 400 + details[].reason=API_KEY_INVALID (Gemini 식) |
 * | `fake-403-` | 403 |  `fake-429-` | 429 |  `fake-500-` | 500 |
 * | `fake-timeout-` | 네트워크 타임아웃 |
 * | `fake-echo-` | 벤더 SDK 처럼 **오류 메시지에 키를 그대로 반복**하며 실패 (노출 방지 테스트, AC-204) |
 */
export type SimulatedResponse = { status: number; body: unknown } | { throw: Error };

/** 벤더 목록 API 가 돌려줄 ID 형태: Anthropic Haiku 4.5 는 날짜 스냅샷, Gemini 는 `models/` 접두 */
function listedIdsFor(vendorId: string, ids: readonly string[]): string[] {
  const extra = {
    anthropic: 'claude-3-legacy-x',
    openai: 'text-embedding-x',
    google: 'embedding-x',
  };
  const all = [...ids, extra[vendorId as keyof typeof extra] ?? 'other-model'];
  if (vendorId === 'anthropic') {
    return all.map((id) => (id === 'claude-haiku-4-5' ? `${id}-20251001` : id));
  }
  return vendorId === 'google' ? all.map((id) => `models/${id}`) : all;
}

function listBody(vendorId: string, ids: readonly string[], next: string | null): unknown {
  if (vendorId === 'google') {
    return { models: ids.map((name) => ({ name })), ...(next ? { nextPageToken: next } : {}) };
  }
  return {
    data: ids.map((id) => ({ id, type: 'model' })),
    has_more: Boolean(next),
    last_id: next ?? ids.at(-1) ?? null,
  };
}

function cursorOf(url: string): string | null {
  const params = new URL(url).searchParams;
  return params.get('pageToken') ?? params.get('after_id');
}

function listResponse(secret: string, vendorId: string, url: string): SimulatedResponse | null {
  const all = listedIdsFor(
    vendorId,
    modelsFor(vendorId).map((model) => model.id),
  );
  if (secret.startsWith('fake-valid-')) return { status: 200, body: listBody(vendorId, all, null) };
  if (secret.startsWith('fake-partial-')) {
    const only = listedIdsFor(vendorId, [defaultModelFor(vendorId) ?? '']);
    return { status: 200, body: listBody(vendorId, only, null) };
  }
  if (secret.startsWith('fake-nolist-')) return { status: 200, body: { unexpected: true } };
  const paged = secret.startsWith('fake-paged-');
  if (!paged && !secret.startsWith('fake-pagefail-')) return null;
  // OpenAI 목록은 페이지가 없다 — 한 번에 전부 (다음 페이지 실패도 일어나지 않음)
  if (vendorId === 'openai') return { status: 200, body: listBody(vendorId, all, null) };
  const half = Math.ceil(all.length / 2);
  if (!cursorOf(url))
    return { status: 200, body: listBody(vendorId, all.slice(0, half), 'page-2') };
  return paged
    ? { status: 200, body: listBody(vendorId, all.slice(half), null) }
    : { status: 500, body: {} };
}

function errorResponse(secret: string): SimulatedResponse {
  if (secret.startsWith('fake-invalid-') || secret.startsWith('fake-401-')) {
    return { status: 401, body: { error: { type: 'authentication_error' } } };
  }
  if (secret.startsWith('fake-gemini400-')) {
    return {
      status: 400,
      body: { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
    };
  }
  if (secret.startsWith('fake-403-')) return { status: 403, body: {} };
  if (secret.startsWith('fake-429-')) return { status: 429, body: {} };
  if (secret.startsWith('fake-500-')) return { status: 500, body: {} };
  if (secret.startsWith('fake-timeout-')) {
    return {
      throw: Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    };
  }
  if (secret.startsWith('fake-echo-')) {
    return { throw: new Error(`Incorrect API key provided: ${secret}`) };
  }
  return { status: 401, body: {} };
}

export function simulateVendorResponse(
  secret: string,
  vendorId: string,
  url: string,
): SimulatedResponse {
  return listResponse(secret, vendorId, url) ?? errorResponse(secret);
}

/** live 검증 경로에 끼울 가짜 fetch — 요청 URL(페이지 커서)만 보고 응답을 만든다 */
export function fakeFetchFor(secret: string, vendorId: string): typeof fetch {
  return async (input) => {
    const simulated = simulateVendorResponse(secret, vendorId, String(input));
    if ('throw' in simulated) throw simulated.throw;
    return Response.json(simulated.body, { status: simulated.status });
  };
}
