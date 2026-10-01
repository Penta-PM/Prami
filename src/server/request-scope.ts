import 'server-only';

import { headers } from 'next/headers';

import { REQUEST_ID_HEADER } from '@/server/security/headers';

import { withRequestContext } from './request-context';

/** proxy 가 붙인 x-request-id 로 요청 스코프를 열고 fn 을 실행한다 (AC-363). 요청 밖이면 requestId=null */
export async function inRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  let requestId: string | null = null;
  try {
    requestId = (await headers()).get(REQUEST_ID_HEADER);
  } catch {
    requestId = null;
  }
  return withRequestContext(requestId, fn);
}
