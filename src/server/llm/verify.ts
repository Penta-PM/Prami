import { intersectAvailableModels } from './models';
import { fakeFetchFor } from './vendors/fake';
import { VENDOR_HOSTS, type LlmVendor, type VerifyRequest } from './vendors/registry';

/**
 * 키 검증 (PRAMI-002 §4.6.3, AC-207). 토큰을 소비하지 않는 목록 호출 한 번으로 판정한다.
 * - 2xx → valid / 인증 실패(401, Gemini 400 API_KEY_INVALID) → invalid / 403 → forbidden / 429 → rate_limited
 * - 5xx·타임아웃(10s)·네트워크 → error (상태는 유지, last_error_code='unavailable')
 * 응답 본문은 판정과 **사용 가능 모델**(목록 ID ∩ models.ts 상수, AC-207 ⑦) 계산에만 쓰고 저장·로그하지 않는다.
 * 벤더 오류 메시지(키가 섞일 수 있음, T-6)는 어디로도 전달하지 않는다.
 * availableModels: 정상 판정 + 목록 전 페이지를 읽었을 때만 배열, 그 밖(목록 형식 이상·다음 페이지 실패·페이지 상한 초과·비정상 판정)은 null(미확인).
 */
export type VerifyOutcome = 'valid' | 'invalid' | 'forbidden' | 'rate_limited' | 'error';
/** expired: 자격 증명 만료 (PRAMI-003 §4.4.4 — 벤더 호출 없이 판정) */
export type VerifyErrorCode =
  'invalid_key' | 'forbidden' | 'rate_limited' | 'unavailable' | 'expired';
export type VerifyResult = {
  outcome: VerifyOutcome;
  errorCode: VerifyErrorCode | null;
  availableModels: string[] | null;
};

export const VERIFY_TIMEOUT_MS = 10_000;
/** 목록 페이지 상한 (§4.6.3 Gemini 최대 5페이지) — 넘으면 미확인 */
export const MAX_MODEL_LIST_PAGES = 5;

const RESULT: Record<VerifyOutcome, VerifyResult> = {
  valid: { outcome: 'valid', errorCode: null, availableModels: null },
  invalid: { outcome: 'invalid', errorCode: 'invalid_key', availableModels: null },
  forbidden: { outcome: 'forbidden', errorCode: 'forbidden', availableModels: null },
  rate_limited: { outcome: 'rate_limited', errorCode: 'rate_limited', availableModels: null },
  error: { outcome: 'error', errorCode: 'unavailable', availableModels: null },
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
export function assertSafeVerifyRequest(
  request: VerifyRequest,
  secret: string,
  allowedHosts: readonly string[] = VENDOR_HOSTS,
): void {
  const url = new URL(request.url);
  if (url.protocol !== 'https:') throw new UnsafeVerifyRequestError('https 가 아님');
  if (!allowedHosts.includes(url.hostname)) {
    throw new UnsafeVerifyRequestError('허용 목록 밖 호스트');
  }
  if (request.url.includes(secret) || request.url.includes(encodeURIComponent(secret))) {
    throw new UnsafeVerifyRequestError('URL 에 키가 들어 있음');
  }
}

async function readJson(response: Response): Promise<unknown> {
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

type PageFetcher = (cursor?: string) => Promise<Response>;

function pageFetcher(vendor: LlmVendor, secret: string, options: VerifyOptions): PageFetcher {
  const fetchImpl =
    options.fetchImpl ?? (options.mode === 'fake' ? fakeFetchFor(secret, vendor.id) : fetch);
  return (cursor) => {
    const request = vendor.verifyRequest(secret, cursor);
    // 이 벤더의 상수 호스트만 (벤더 추가 시에도 다른 벤더 호스트로 키가 가지 않는다)
    assertSafeVerifyRequest(request, secret, [vendor.host]);
    return fetchImpl(request.url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? VERIFY_TIMEOUT_MS),
    });
  };
}

/** 첫 페이지 이후를 읽어 목록 ID 를 모은다. 실패·형식 이상·상한 초과면 null (판정은 이미 정상) */
async function collectModelIds(
  vendor: LlmVendor,
  firstBody: unknown,
  fetchPage: PageFetcher,
): Promise<string[] | null> {
  let page = vendor.parseModelList(firstBody);
  const ids: string[] = [];
  for (let count = 1; page; count += 1) {
    ids.push(...page.ids);
    if (!page.next) return ids;
    if (count >= MAX_MODEL_LIST_PAGES) return null;
    try {
      const response = await fetchPage(page.next);
      if (!response.ok) return null;
      page = vendor.parseModelList(await readJson(response));
    } catch (error) {
      if (error instanceof UnsafeVerifyRequestError) throw error;
      return null;
    }
  }
  return null;
}

async function runVerify(vendor: LlmVendor, secret: string, options: VerifyOptions) {
  const fetchPage = pageFetcher(vendor, secret, options);
  const response = await fetchPage();
  // 판정에 본문이 필요한 경우(2xx 목록, 400 Gemini 키 오류)만 읽는다. 저장·로그하지 않는다
  const body = response.ok || response.status === 400 ? await readJson(response) : null;
  const result = classifyVerifyResponse(vendor, response.status, body);
  if (result.outcome !== 'valid') return result;
  const listed = await collectModelIds(vendor, body, fetchPage);
  return {
    ...result,
    availableModels: listed ? intersectAvailableModels(vendor.id, listed) : null,
  };
}

/** 어떤 예외도 코드로만 바꾼다 — 벤더·SDK 메시지(키 반복 가능)는 버린다 */
export async function verifyCredential(
  vendor: LlmVendor,
  secret: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  try {
    return await runVerify(vendor, secret, options);
  } catch (error) {
    if (error instanceof UnsafeVerifyRequestError) throw error;
    return RESULT.error;
  }
}
