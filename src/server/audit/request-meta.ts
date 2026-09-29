import 'server-only';

import { headers } from 'next/headers';

import { env, proxyTrustMode } from '@/env';

import { EMPTY_REQUEST_META, requestMetaFromHeaders, type RequestMeta } from './log';

/** 현재 요청의 x-request-id (proxy 가 부여). 요청 스코프 밖이면 null */
export async function currentRequestId(): Promise<string | null> {
  try {
    return (await headers()).get('x-request-id');
  } catch {
    return null;
  }
}

/** 현재 요청의 감사 메타 (산출 규칙은 log.ts 의 requestMetaFromHeaders). 요청 스코프 밖에서는 빈 값 */
export async function currentRequestMeta(): Promise<RequestMeta> {
  try {
    return requestMetaFromHeaders(await headers(), proxyTrustMode(env));
  } catch {
    return EMPTY_REQUEST_META;
  }
}
