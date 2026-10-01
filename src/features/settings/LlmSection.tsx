'use client';

import { useState, useTransition } from 'react';

import { WarningIcon } from '@/features/shell/icons';
import type { ChatDefaultsView, VendorView } from '@/server/llm/credentials/settings';
import type { CredentialView } from '@/server/llm/credentials/view';

import {
  deleteLlmCredentialAction,
  saveLlmCredentialAction,
  updateChatDefaultsAction,
  verifyLlmCredentialAction,
} from './actions';
import { ChatDefaultsForm } from './ChatDefaultsForm';
import {
  COMPANY_KEY_WARNING_BODY,
  COMPANY_KEY_WARNING_TITLE,
  DELETE_DONE_MESSAGE,
  KEYRING_MISSING_NOTICE,
  NO_CREDENTIAL_NOTICE,
  NOTICES,
  oauthDisconnectNotice,
  verifyResultMessage,
} from './labels';
import { LlmCredentialCard, type CardHandlers } from './LlmCredentialCard';

/** link: 연결 해제 후 벤더 대시보드 폐기 안내 (PRAMI-003 AC-347) */
type Flash = { tone: 'ok' | 'error'; text: string; link?: { href: string; label: string } };

/** 삭제 성공 문구 — OAuth 연결이면 벤더 대시보드에서 키 라벨로 폐기하라는 안내와 링크 (AC-347) */
function deletedFlash(vendor: VendorView | undefined, removed: CredentialView | undefined): Flash {
  if (removed?.authType === 'oauth_pkce' && vendor?.oauthKeyLabel) {
    return {
      tone: 'ok',
      text: oauthDisconnectNotice(vendor.label, vendor.oauthKeyLabel),
      link: { href: vendor.consoleUrl, label: `${vendor.label} 키 관리 열기` },
    };
  }
  return { tone: 'ok', text: DELETE_DONE_MESSAGE };
}

/**
 * LLM 연결 `#llm` + 챗봇 기본값 + 안내 (PRAMI-002 §4.6.1 ②③④). 서버 응답은 CredentialView(힌트까지)뿐이라
 * 클라이언트 상태에 키가 들어오지 않는다. 오류는 서버가 준 고정 문구만 보인다.
 */
export function LlmSection({
  vendors,
  initialCredentials,
  initialDefaults,
  keyringReady,
}: {
  vendors: VendorView[];
  initialCredentials: CredentialView[];
  initialDefaults: ChatDefaultsView;
  keyringReady: boolean;
}) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [defaults, setDefaults] = useState(initialDefaults);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, startTransition] = useTransition();

  const upsert = (view: CredentialView) =>
    setCredentials((list) => [...list.filter((entry) => entry.vendor !== view.vendor), view]);

  const handlers: CardHandlers = {
    onSave: async (vendor, apiKey) => {
      const result = await saveLlmCredentialAction({ vendor, apiKey });
      if (!result.ok) {
        setFlash({ tone: 'error', text: result.error.message });
        return false;
      }
      upsert(result.data);
      setFlash(verifyResultMessage(result.data, 'save'));
      return true;
    },
    onVerify: async (vendor) =>
      startTransition(async () => {
        const result = await verifyLlmCredentialAction({ vendor });
        if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
        upsert(result.data);
        setFlash(verifyResultMessage(result.data, 'verify'));
      }),
    onDelete: async (vendor) =>
      startTransition(async () => {
        const result = await deleteLlmCredentialAction({ vendor });
        if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
        const removed = credentials.find((entry) => entry.vendor === vendor);
        setCredentials((list) => list.filter((entry) => entry.vendor !== vendor));
        setFlash(
          deletedFlash(
            vendors.find((entry) => entry.id === vendor),
            removed,
          ),
        );
      }),
  };

  const saveDefaults = async (vendor: string, model: string) =>
    startTransition(async () => {
      const result = await updateChatDefaultsAction({ vendor, model });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setDefaults(result.data);
      setFlash({ tone: 'ok', text: '챗봇 기본값을 저장했습니다' });
    });

  const available = Object.fromEntries(
    credentials
      .filter((entry) => entry.status === 'valid')
      .map((entry) => [entry.vendor, entry.availableModels]),
  );
  const orphaned = credentials.filter(
    (entry) => !vendors.some((vendor) => vendor.id === entry.vendor),
  );

  return (
    <>
      <section
        id="llm"
        aria-labelledby="llm-title"
        className="flex scroll-mt-24 flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
      >
        <h2 id="llm-title" className="m-0 text-[15px] font-semibold">
          LLM 연결
        </h2>
        <CompanyKeyWarning />
        {!keyringReady ? (
          <p role="alert" className="m-0 rounded-lg bg-amber-500/15 px-3.5 py-2.5 text-[13px]">
            {KEYRING_MISSING_NOTICE}
          </p>
        ) : null}
        {credentials.length === 0 ? (
          <p className="m-0 text-[13px] text-text-secondary">{NO_CREDENTIAL_NOTICE}</p>
        ) : null}
        {flash ? (
          <p
            role={flash.tone === 'error' ? 'alert' : 'status'}
            className={
              flash.tone === 'error'
                ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500'
                : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-600'
            }
          >
            {flash.text}
            {flash.link ? (
              <>
                {' '}
                <a
                  href={flash.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  {flash.link.label}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            ...vendors,
            ...orphaned.map((entry) => ({
              id: entry.vendor,
              label: entry.vendorLabel,
              consoleUrl: '#',
            })),
          ].map((vendor) => (
            <LlmCredentialCard
              key={vendor.id}
              vendor={vendor}
              credential={credentials.find((entry) => entry.vendor === vendor.id) ?? null}
              keyringReady={keyringReady}
              busy={busy}
              handlers={handlers}
            />
          ))}
        </div>
      </section>
      <ChatDefaultsForm
        key={JSON.stringify(available)}
        vendors={vendors.filter((vendor) => !vendor.disabled)}
        available={available}
        defaults={defaults}
        busy={busy}
        onSave={saveDefaults}
      />
      <section aria-label="요금·데이터 안내" className="rounded-xl bg-gray-75 p-5">
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-text-secondary">
          {NOTICES.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * 회사 API 키 주의 안내 (PRAMI-003 §4.8.2 ①·§4.8.3): 자격 증명 유무와 관계없이 항상, 닫기 없음.
 * 정적 안내라 role="alert"·aria-live 를 쓰지 않는다(진입마다 스크린 리더가 끼어들지 않게) — role="note".
 */
function CompanyKeyWarning() {
  return (
    <aside
      role="note"
      aria-labelledby="llm-company-key-title"
      className="flex gap-2.5 rounded-lg border-l-[3px] border-border-danger bg-surface-danger px-3.5 py-2.5 text-[13px] text-text-danger"
    >
      <WarningIcon className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p id="llm-company-key-title" className="m-0">
          <strong>{COMPANY_KEY_WARNING_TITLE}</strong>
        </p>
        <p className="m-0 break-keep">{COMPANY_KEY_WARNING_BODY}</p>
      </div>
    </aside>
  );
}
