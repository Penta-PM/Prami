import { getDb } from '@/db';
import { env } from '@/env';
import { runRoute } from '@/server/auth/rbac';
import { deepHealth } from '@/server/ops/health-deep';
import { rateLimitBackendStatus } from '@/server/rate-limit';

/**
 * 상세 헬스 (PRAMI-003 §4.3.10, AC-330 ②) — ADMIN(system.settings). USER 는 PRAMI-001 §4.7.1 거부(403 + 감사 denied).
 * 개수·불리언만: fixture 계정 수, stub 품목 수, 품목·판매단가·원가 행 수, 활성 KEK 존재, rate limit 백엔드 왕복.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const guard = {
    permission: 'system.settings',
    auditAction: 'health.deep',
    target: '/api/health/deep',
  } as const;
  return runRoute(guard, async () => {
    const body = await deepHealth(await getDb(), {
      keks: env.LLM_CREDENTIALS_KEKS,
      activeKek: env.LLM_CREDENTIALS_ACTIVE_KEK,
      rateLimitStatus: rateLimitBackendStatus,
    });
    return Response.json({ ok: true, data: body }, { headers: { 'cache-control': 'no-store' } });
  });
}
