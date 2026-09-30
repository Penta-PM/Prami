'use client';

import { useState, useTransition } from 'react';

import type { ChatDefaultsView, VendorView } from '@/server/llm/credentials/settings';
import type { CredentialView } from '@/server/llm/credentials/view';

import {
  deleteLlmCredentialAction,
  saveLlmCredentialAction,
  updateChatDefaultsAction,
  verifyLlmCredentialAction,
} from './actions';
import { ChatDefaultsForm } from './ChatDefaultsForm';
import { DELETE_DONE_MESSAGE, KEYRING_MISSING_NOTICE, NOTICES } from './labels';
import { LlmCredentialCard, type CardHandlers } from './LlmCredentialCard';

type Flash = { tone: 'ok' | 'error'; text: string };

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
      setFlash({ tone: 'ok', text: `${result.data.vendorLabel} 키를 저장하고 검증했습니다` });
      return true;
    },
    onVerify: async (vendor) =>
      startTransition(async () => {
        const result = await verifyLlmCredentialAction({ vendor });
        if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
        upsert(result.data);
        setFlash({ tone: 'ok', text: `${result.data.vendorLabel} 키 검증을 마쳤습니다` });
      }),
    onDelete: async (vendor) =>
      startTransition(async () => {
        const result = await deleteLlmCredentialAction({ vendor });
        if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
        setCredentials((list) => list.filter((entry) => entry.vendor !== vendor));
        setFlash({ tone: 'ok', text: DELETE_DONE_MESSAGE });
      }),
  };

  const saveDefaults = async (vendor: string, model: string) =>
    startTransition(async () => {
      const result = await updateChatDefaultsAction({ vendor, model });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setDefaults(result.data);
      setFlash({ tone: 'ok', text: '챗봇 기본값을 저장했습니다' });
    });

  const validVendorIds = credentials
    .filter((entry) => entry.status === 'valid')
    .map((entry) => entry.vendor);
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
        {!keyringReady ? (
          <p role="alert" className="m-0 rounded-lg bg-amber-500/15 px-3.5 py-2.5 text-[13px]">
            {KEYRING_MISSING_NOTICE}
          </p>
        ) : null}
        {credentials.length === 0 ? (
          <p className="m-0 text-[13px] text-text-secondary">
            아직 등록한 LLM API 키가 없습니다. Anthropic·OpenAI·Google 중 하나의 키를 등록하면
            챗봇에서 자연어로 질문할 수 있게 됩니다.
          </p>
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
        key={validVendorIds.join(',')}
        vendors={vendors}
        validVendorIds={validVendorIds}
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
