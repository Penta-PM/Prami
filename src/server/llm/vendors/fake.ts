/**
 * 가짜 벤더 검증기 (PRAMI-002 §9.1, `LLM_VENDOR_MODE=fake`). 실벤더 없이 E2E·QA 가 전 흐름을 재현한다.
 * 키 접두로 **HTTP 응답을 흉내** 내고, 판정은 live 와 같은 `classifyVerifyResponse` 를 거친다(판정 로직 공유).
 * production·VERCEL_ENV 에서는 env.ts 가 fake 모드 기동을 거부한다(AC-212).
 *
 * | 접두 | 흉내 내는 응답 |
 * | `fake-valid-` | 200 |
 * | `fake-invalid-`, `fake-401-` | 401 |
 * | `fake-gemini400-` | 400 + details[].reason=API_KEY_INVALID (Gemini 식) |
 * | `fake-403-` | 403 |  `fake-429-` | 429 |  `fake-500-` | 500 |
 * | `fake-timeout-` | 네트워크 타임아웃 |
 * | `fake-echo-` | 벤더 SDK 처럼 **오류 메시지에 키를 그대로 반복**하며 실패 (노출 방지 테스트, AC-204) |
 */
export type SimulatedResponse = { status: number; body: unknown } | { throw: Error };

export function simulateVendorResponse(secret: string): SimulatedResponse {
  if (secret.startsWith('fake-valid-')) return { status: 200, body: { data: [] } };
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
