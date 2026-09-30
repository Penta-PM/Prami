import { runRoute } from '@/server/auth/rbac';
import { notFound, OAUTH_GUARD, oauthEnabled, startFlow } from '@/server/llm/oauth/routes';

/**
 * GET /api/settings/oauth/openrouter/start (PRAMI-002 §4.6.2 ①, settings.self) — 플래그 `LLM_OAUTH_OPENROUTER` off 면 404.
 * PKCE code_verifier·state 를 암호화 쿠키(10분)에 두고 OpenRouter 인증 화면으로 302.
 */
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  if (!oauthEnabled()) return notFound();
  return runRoute(OAUTH_GUARD, async (user) => startFlow(user));
}
