import 'server-only';

import { headers } from 'next/headers';

import { EMPTY_REQUEST_META, type RequestMeta } from './log';

/** 헤더 모음에서 감사용 IP·User-Agent 를 뽑는다 (Vercel/프록시 뒤에서는 x-forwarded-for 첫 값) */
export function requestMetaFromHeaders(source: Headers): RequestMeta {
  return {
    ip: source.get('x-forwarded-for') ?? source.get('x-real-ip'),
    userAgent: source.get('user-agent'),
  };
}

/** 현재 요청의 IP·User-Agent. 요청 스코프 밖(스크립트·테스트)에서는 빈 값 */
export async function currentRequestMeta(): Promise<RequestMeta> {
  try {
    return requestMetaFromHeaders(await headers());
  } catch {
    return EMPTY_REQUEST_META;
  }
}
