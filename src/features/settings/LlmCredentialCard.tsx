'use client';

import { useState } from 'react';

import { Button, Modal, Pill } from '@/components/ui';
import type { CredentialView } from '@/server/llm/credentials/view';
import type { VendorView } from '@/server/llm/credentials/settings';

import { ERROR_CODE_LABELS, formatDateTime, STATUS_LABELS } from './labels';
import { LlmCredentialForm } from './LlmCredentialForm';

/**
 * 벤더 카드 (PRAMI-002 §4.6.1 ②): 상태 필·마스킹 힌트·연결 방식·마지막 검증/사용·[등록]/[교체]/[검증]/[삭제]·콘솔 링크.
 * 삭제는 디자인 모달로 확인한다(브라우저 confirm 금지). 저장된 키를 다시 보여주는 UI 는 없다 — 교체만(AC-213).
 */
export type CardHandlers = {
  onSave: (vendor: string, apiKey: string) => Promise<boolean>;
  onVerify: (vendor: string) => Promise<void>;
  onDelete: (vendor: string) => Promise<void>;
};

export function LlmCredentialCard({
  vendor,
  credential,
  keyringReady,
  busy,
  handlers,
}: {
  vendor: Pick<VendorView, 'id' | 'label' | 'consoleUrl'>;
  credential: CredentialView | null;
  keyringReady: boolean;
  busy: boolean;
  handlers: CardHandlers;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const status = STATUS_LABELS[credential?.status ?? 'missing'];
  const supported = credential?.status !== 'unsupported';

  return (
    <article
      aria-label={`${vendor.label} 연결`}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-card p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[14px] font-semibold">{vendor.label}</h3>
        <Pill tone={status.tone} data-testid={`status-${vendor.id}`}>
          {status.label}
        </Pill>
      </header>
      {credential ? (
        <CredentialFacts credential={credential} />
      ) : (
        <p className="m-0 text-[12px] text-text-tertiary">등록된 키가 없습니다.</p>
      )}
      {editing ? (
        <LlmCredentialForm
          vendorId={vendor.id}
          vendorLabel={vendor.label}
          replacing={credential !== null}
          disabled={!keyringReady || busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (apiKey) => {
            if (await handlers.onSave(vendor.id, apiKey)) setEditing(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {supported ? (
            <Button
              size="sm"
              variant="primary"
              disabled={!keyringReady || busy}
              onClick={() => setEditing(true)}
            >
              {credential ? '교체' : '등록'}
            </Button>
          ) : null}
          {credential && supported ? (
            <Button size="sm" disabled={busy} onClick={() => void handlers.onVerify(vendor.id)}>
              검증
            </Button>
          ) : null}
          {credential ? (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              삭제
            </Button>
          ) : null}
          <a
            href={vendor.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center px-2 text-[12px] font-semibold text-purple-500"
          >
            벤더 콘솔
          </a>
        </div>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`${vendor.label} 키 삭제`}
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[13px]">
            저장된 키를 즉시 파기합니다. 되돌릴 수 없습니다. 벤더 콘솔에서도 키를 폐기하는 것을
            권장합니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)}>취소</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                await handlers.onDelete(vendor.id);
                setConfirming(false);
              }}
            >
              삭제
            </Button>
          </div>
        </div>
      </Modal>
    </article>
  );
}

function CredentialFacts({ credential }: { credential: CredentialView }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-2 text-[12px]">
      <div>
        <dt className="text-text-tertiary">키</dt>
        <dd className="m-0 font-mono" data-testid={`hint-${credential.vendor}`}>
          {credential.keyHint}
        </dd>
      </div>
      <div>
        <dt className="text-text-tertiary">연결 방식</dt>
        <dd className="m-0">{credential.authType === 'api_key' ? 'API 키' : 'OAuth'}</dd>
      </div>
      <div>
        <dt className="text-text-tertiary">마지막 검증</dt>
        <dd className="m-0">{formatDateTime(credential.lastVerifiedAt)}</dd>
      </div>
      <div>
        <dt className="text-text-tertiary">마지막 사용</dt>
        <dd className="m-0">{formatDateTime(credential.lastUsedAt)}</dd>
      </div>
      {credential.lastErrorCode ? (
        <p className="text-amber-600 col-span-2 m-0">
          {ERROR_CODE_LABELS[credential.lastErrorCode] ?? '확인하지 못했습니다'}
        </p>
      ) : null}
    </dl>
  );
}
