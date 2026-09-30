import { runRoute } from '@/server/auth/rbac';
import { finishFlow, notFound, OAUTH_GUARD, oauthEnabled } from '@/server/llm/oauth/routes';

/**
 * GET /api/settings/oauth/openrouter/callback (PRAMI-002 §4.6.2 ②, settings.self) — 플래그 off 면 404.
 * 쿠키·state·세션 사용자가 일치할 때만 서버에서 코드를 교환하고 키를 봉투 암호화해 `auth_type='oauth_pkce'` 로 저장한다.
 * 실패하면 행을 만들지 않고 `/settings?error=oauth#llm`.
 */
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  if (!oauthEnabled()) return notFound();
  return runRoute(OAUTH_GUARD, async (user) => finishFlow(request, user));
}
