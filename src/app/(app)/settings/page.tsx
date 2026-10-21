import type { Metadata } from 'next';

import { getDb } from '@/db';
import { env } from '@/env';
import { AccountSection } from '@/features/settings/AccountSection';
import { LlmSection } from '@/features/settings/LlmSection';
import { PageStateResetSection } from '@/features/settings/PageStateResetSection';
import { requirePagePermission } from '@/server/auth/rbac';
import { isGoogleConfigured, isTestModeEnabled } from '@/server/auth/providers';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import { getMySettings } from '@/server/llm/credentials/settings';

export const metadata: Metadata = { title: '사용자 설정' };

/**
 * 사용자 설정 (PRAMI-002 §4.6.1, settings.self). 계정 연결 · LLM 연결 · 챗봇 기본값 · 안내.
 * 대상은 항상 본인 — ADMIN 도 다른 사용자의 설정을 볼 수 없다(I-4). 키·암호문·google_sub 값은 이 페이지로 내려오지 않는다.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** OAuth 콜백 실패 안내 (§4.6.2 — 원인 코드만, 벤더 메시지 미표시) */
const OAUTH_ERROR_NOTICE = 'LLM 벤더 연결에 실패했습니다. 다시 시도해주세요.';

export default async function SettingsPage(props: { searchParams?: SearchParams } = {}) {
  const oauthFailed = (await props.searchParams)?.error === 'oauth';
  const user = await requirePagePermission('settings.self', '/settings');
  const settings = await getMySettings({
    db: await getDb(),
    userId: user.id,
    keys: keyringFromEnv(env),
    mode: env.LLM_VENDOR_MODE,
    testMode: isTestModeEnabled(env),
    flags: { oauthOpenRouter: env.LLM_OAUTH_OPENROUTER },
  });

  return (
    <section aria-labelledby="page-title" className="flex max-w-[1080px] flex-col gap-5">
      <div>
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          사용자 설정
        </h1>
        <p className="m-0 mt-1 text-[13px] text-text-tertiary">
          로그인 계정과 챗봇에 쓸 본인 LLM API 키를 관리합니다.
        </p>
      </div>
      {oauthFailed ? (
        <p
          role="alert"
          className="m-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500"
        >
          {OAUTH_ERROR_NOTICE}
        </p>
      ) : null}
      <AccountSection account={settings.account} googleReady={isGoogleConfigured(env)} />
      <LlmSection
        vendors={settings.vendors}
        initialCredentials={settings.credentials}
        initialDefaults={settings.defaults}
        keyringReady={settings.keyringReady}
      />
      <PageStateResetSection />
    </section>
  );
}
