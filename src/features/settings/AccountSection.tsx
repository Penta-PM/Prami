import { Button, Pill } from '@/components/ui';
import type { AccountView } from '@/server/llm/credentials/settings';

import { reloginWithGoogleAction } from './actions';
import { formatDateTime } from './labels';

/**
 * 계정 연결 (PRAMI-002 §4.6.1 ①, "OAuth" 해석 (a), AC-209). Google 연결 여부는 boolean 으로만 — `google_sub` 값은 내려오지 않는다.
 * "Google 계정으로 다시 로그인" 은 계정 전환·세션 갱신용이다.
 */
const PROVIDER_LABELS: Record<AccountView['provider'], string> = {
  google: 'Google',
  test: '테스트 로그인(TEST MODE)',
  pending: 'Google 미연결',
};

export function AccountSection({
  account,
  googleReady,
}: {
  account: AccountView;
  googleReady: boolean;
}) {
  return (
    <section
      aria-labelledby="account-title"
      className="flex flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="account-title" className="m-0 text-[15px] font-semibold">
          계정 연결
        </h2>
        <Pill tone={account.googleConnected ? 'positive' : 'neutral'}>
          {account.googleConnected ? 'Google 연결됨' : 'Google 미연결'}
        </Pill>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
        <Field label="로그인 방식" value={PROVIDER_LABELS[account.provider]} />
        <Field label="이메일" value={account.email} />
        <Field label="이름" value={account.name} />
        <Field label="마지막 로그인" value={formatDateTime(account.lastLoginAt)} />
      </dl>
      <form action={reloginWithGoogleAction} className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!googleReady}>
          Google 계정으로 다시 로그인
        </Button>
        {googleReady ? null : (
          <span className="text-[12px] text-text-tertiary">
            Google OAuth 클라이언트가 아직 설정되지 않았습니다.
          </span>
        )}
      </form>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-tertiary">{label}</dt>
      <dd className="m-0 font-semibold">{value}</dd>
    </div>
  );
}
