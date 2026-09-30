import { simulateVendorResponse } from './vendors/fake';
import { VENDOR_HOSTS, type LlmVendor, type VerifyRequest } from './vendors/registry';

/**
 * 키 검증 (PRAMI-002 §4.6.3, AC-207). 토큰을 소비하지 않는 목록 호출 한 번으로 판정한다.
 * - 2xx → valid / 인증 실패(401, Gemini 400 API_KEY_INVALID) → invalid / 403 → forbidden / 429 → rate_limited
 * - 5xx·타임아웃(10s)·네트워크 → error (상태는 유지, last_error_code='unavailable')
 * 응답 본문은 판정에만 쓰고 저장·로그하지 않는다. 벤더 오류 메시지(키가 섞일 수 있음, T-6)는 어디로도 전달하지 않는다.
 */
export type VerifyOutcome = 'valid' | 'invalid' | 'forbidden' | 'rate_limited' | 'error';
export type VerifyErrorCode = 'invalid_key' | 'forbidden' | 'rate_limited' | 'unavailable';
export type VerifyResult = { outcome: VerifyOutcome; errorCode: VerifyErrorCode | null };

export const VERIFY_TIMEOUT_MS = 10_000;

const RESULT: Record<VerifyOutcome, VerifyResult> = {
  valid: { outcome: 'valid', errorCode: null },
  invalid: { outcome: 'invalid', errorCode: 'invalid_key' },
  forbidden: { outcome: 'forbidden', errorCode: 'forbidden' },
  rate_limited: { outcome: 'rate_limited', errorCode: 'rate_limited' },
  error: { outcome: 'error', errorCode: 'unavailable' },
};

export function classifyVerifyResponse(
  vendor: LlmVendor,
  status: number,
  body: unknown,
): VerifyResult {
  if (status >= 200 && status < 300) return RESULT.valid;
  if (status === 401 || vendor.isInvalidKeyResponse?.(status, body)) return RESULT.invalid;
  if (status === 403) return RESULT.forbidden;
  if (status === 429) return RESULT.rate_limited;
  return RESULT.error;
}

export class UnsafeVerifyRequestError extends Error {
  constructor(reason: string) {
    super(`검증 요청이 허용되지 않습니다: ${reason}`);
    this.name = 'UnsafeVerifyRequestError';
  }
}

/** 요청 빌더 검사 (T-12·AC-207): https, 상수 호스트, URL 에 키 없음 */
export function assertSafeVerifyRequest(request: VerifyRequest, secret: string): void {
  const url = new URL(request.url);
  if (url.protocol !== 'https:') throw new UnsafeVerifyRequestError('https 가 아님');
  if (!(VENDOR_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new UnsafeVerifyRequestError('허용 목록 밖 호스트');
  }
  if (request.url.includes(secret) || request.url.includes(encodeURIComponent(secret))) {
    throw new UnsafeVerifyRequestError('URL 에 키가 들어 있음');
  }
}

async function readBodyForClassification(response: Response): Promise<unknown> {
  // 판정에 본문이 필요한 경우(400)만 읽는다. 저장·로그하지 않는다
  if (response.status !== 400) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export type VerifyOptions = {
  mode: 'live' | 'fake';
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

async function liveVerify(vendor: LlmVendor, secret: string, options: VerifyOptions) {
  const request = vendor.verifyRequest(secret);
  assertSafeVerifyRequest(request, secret);
  const response = await (options.fetchImpl ?? fetch)(request.url, {
    method: 'GET',
    headers: request.headers,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(options.timeoutMs ?? VERIFY_TIMEOUT_MS),
  });
  return classifyVerifyResponse(vendor, response.status, await readBodyForClassification(response));
}

function fakeVerify(vendor: LlmVendor, secret: string): VerifyResult {
  // live 와 같은 요청 빌더 검사를 거친 뒤 응답만 흉내 낸다
  assertSafeVerifyRequest(vendor.verifyRequest(secret), secret);
  const simulated = simulateVendorResponse(secret);
  if ('throw' in simulated) throw simulated.throw;
  return classifyVerifyResponse(vendor, simulated.status, simulated.body);
}

/** 어떤 예외도 코드로만 바꾼다 — 벤더·SDK 메시지(키 반복 가능)는 버린다 */
export async function verifyCredential(
  vendor: LlmVendor,
  secret: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  try {
    return options.mode === 'fake'
      ? fakeVerify(vendor, secret)
      : await liveVerify(vendor, secret, options);
  } catch (error) {
    if (error instanceof UnsafeVerifyRequestError) throw error;
    return RESULT.error;
  }
}
