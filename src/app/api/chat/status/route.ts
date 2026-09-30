import { getDb } from '@/db';
import { env } from '@/env';
import { runRoute } from '@/server/auth/rbac';
import { chatStatus } from '@/server/chat/graph/runtime';

/**
 * GET /api/chat/status (PRAMI-002 §4.3.11, chat.use): 패널이 열릴 때·포커스 복귀 시 호출한다.
 * `{ llm: { status, vendor, model }, ruleFallback }` — 키·힌트는 포함하지 않는다. 캐시하지 않는다(등록 후 즉시 반영).
 */
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: 'chat.status',
    target: '/api/chat/status',
  } as const;
  return runRoute(guard, async (user) => {
    const data = await chatStatus({ db: await getDb(), userId: user.id, env });
    return Response.json({ ok: true, data }, { headers: { 'cache-control': 'no-store' } });
  });
}
