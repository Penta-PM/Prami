'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button, Modal } from '@/components/ui';
import { formatAuditTime } from '@/lib/audit-format';

import { createQuoteShareAction, listQuoteSharesAction, revokeQuoteShareAction } from './actions';
import type { QuoteShareView, SavedQuoteView } from './types';

type ShareModalProps = { quote: SavedQuoteView; onClose: () => void };

type Flash = { tone: 'ok' | 'error'; text: string };

export const SHARE_DAYS_DEFAULT = 30;

/**
 * 견적 공유 모달 (§4.5.8): 링크 목록(만료·상태) · 새 링크 만들기(만료일 기본 30일) · 복사 · 폐기.
 * 링크 URL 은 현재 origin + path — 서버는 path 만 돌려준다.
 */
export function ShareModal({ quote, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<QuoteShareView[] | null>(null);
  const [days, setDays] = useState(String(SHARE_DAYS_DEFAULT));
  const [flash, setFlash] = useState<Flash | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void listQuoteSharesAction({ quoteId: quote.id }).then((result) => {
      if (!active) return;
      if (result.ok) setShares(result.data);
      else setFlash({ tone: 'error', text: result.error.message });
    });
    return () => {
      active = false;
    };
  }, [quote.id]);

  const create = () =>
    startTransition(async () => {
      const result = await createQuoteShareAction({ quoteId: quote.id, expiresInDays: days });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setShares((list) => [result.data, ...(list ?? [])]);
      setFlash({ tone: 'ok', text: `공유 링크를 만들었습니다 (만료 ${expiryLabel(result.data)})` });
    });

  const revoke = (share: QuoteShareView) =>
    startTransition(async () => {
      const result = await revokeQuoteShareAction({ shareId: share.id });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setShares((list) =>
        (list ?? []).map((entry) => (entry.id === share.id ? result.data : entry)),
      );
      setFlash({ tone: 'ok', text: '공유 링크를 폐기했습니다. 이제 해당 링크는 열리지 않습니다' });
    });

  const copy = async (share: QuoteShareView) => {
    const url = absoluteUrl(share.path);
    try {
      await navigator.clipboard.writeText(url);
      setFlash({ tone: 'ok', text: '링크를 복사했습니다' });
    } catch {
      setFlash({ tone: 'error', text: `복사할 수 없습니다. 링크: ${url}` });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`견적 공유 · ${quote.quoteNo}`}
      className="w-[min(720px,calc(100vw-32px))]"
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[13px] text-text-secondary">
          링크를 아는 사람은 로그인 없이 견적서를 읽을 수 있습니다(원가 없음). 만료되거나 폐기하면
          링크는 404 로 닫힙니다.
        </p>
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
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-text-tertiary">
            만료 (일)
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="w-[96px] rounded-lg border border-border-subtle px-3 py-2 text-[13px] text-text-primary"
            />
          </label>
          <Button type="submit" variant="primary" disabled={isPending}>
            새 공유 링크 만들기
          </Button>
        </form>
        <ul aria-label="공유 링크 목록" className="m-0 flex list-none flex-col gap-2 p-0">
          {shares === null ? (
            <li className="text-[13px] text-text-tertiary">불러오는 중…</li>
          ) : shares.length === 0 ? (
            <li className="text-[13px] text-text-tertiary">아직 만든 공유 링크가 없습니다.</li>
          ) : (
            shares.map((share) => (
              <li
                key={share.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px]" title={absoluteUrl(share.path)}>
                    {absoluteUrl(share.path)}
                  </div>
                  <div className="text-[11px] text-text-tertiary">
                    {share.isActive
                      ? `만료 ${expiryLabel(share)}`
                      : `폐기·만료됨 (${expiryLabel(share)})`}
                  </div>
                </div>
                {share.isActive ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => void copy(share)}>
                      링크 복사
                    </Button>
                    <a
                      className="inline-flex items-center rounded-lg border border-border-subtle px-3 text-[12px] font-semibold text-purple-500"
                      href={share.path}
                      target="_blank"
                      rel="noreferrer"
                    >
                      열기
                    </a>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      aria-label={`${share.token.slice(0, 8)} 폐기`}
                      onClick={() => revoke(share)}
                    >
                      폐기
                    </Button>
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </Modal>
  );
}

function absoluteUrl(path: string): string {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

function expiryLabel(share: QuoteShareView): string {
  return formatAuditTime(new Date(share.expiresAt));
}
