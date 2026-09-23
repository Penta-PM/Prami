import 'server-only';

import { headers } from 'next/headers';

import { env, trustsProxyHeaders } from '@/env';

import { EMPTY_REQUEST_META, requestMetaFromHeaders, type RequestMeta } from './log';

/** 현재 요청의 감사 메타 (산출 규칙은 log.ts 의 requestMetaFromHeaders). 요청 스코프 밖에서는 빈 값 */
export async function currentRequestMeta(): Promise<RequestMeta> {
  try {
    return requestMetaFromHeaders(await headers(), trustsProxyHeaders(env));
  } catch {
    return EMPTY_REQUEST_META;
  }
}
