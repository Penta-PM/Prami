'use client';

import Link from 'next/link';

import { Icon } from '@/components/icons/Icon';

import type { ChatSetupView } from './types';

/**
 * 챗봇 화면 안내 (PRAMI-002 §4.9·§4.8.2): LLM 미연결·키 오류 배너(+사용자 설정 링크), 첫 LLM 응답 전 과금 고지(닫으면 화면에 있는 동안 숨김, 저장 안 함).
 * 링크는 Next Link(같은 탭) — 대화는 DB 에 있어 돌아오면 `?c=` 로 복원된다 (UX PR-C2).
 */
export const SETUP_LINK_LABEL = '사용자 설정에서 등록하기';
export const BILLING_NOTICE = 'LLM 요금은 등록한 본인 벤더 계정으로 청구됩니다.';

export function SetupLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mt-2 block text-[12px] font-semibold text-link underline hover:text-link-hover"
    >
      {SETUP_LINK_LABEL} →
    </Link>
  );
}

export function SetupBanner({ setup }: { setup: ChatSetupView }) {
  return (
    <div
      role="status"
      aria-label="LLM 연결 안내"
      className="border-b border-border-subtle bg-amber-500/10 px-5 py-3 text-[12px] leading-[1.5] text-text-primary"
    >
      {setup.message}
      <SetupLink href={setup.href} />
    </div>
  );
}

export function BillingNotice({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="note"
      aria-label="과금 안내"
      className="flex items-start justify-between gap-3 border-b border-border-subtle bg-gray-75 px-5 py-2.5 text-[11px] text-text-secondary"
    >
      <span>{BILLING_NOTICE}</span>
      <button
        type="button"
        aria-label="과금 안내 닫기"
        onClick={onClose}
        className="flex shrink-0 border-0 bg-transparent p-0 text-text-tertiary hover:text-ink-900"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
