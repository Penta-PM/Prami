import { getDb } from '@/db';
import { checkHealth } from '@/server/ops/health';

/**
 * 헬스체크 (PRAMI-003 §4.3.10, AC-330 ①) — 비인증, IP 분당 30(proxy), 캐시 금지.
 * 응답 `{ ok, release, db, schema, data }` 만. 배포 스모크·preview 스모크(PR-4)가 쓴다.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { status, body } = await checkHealth({ getDb });
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
