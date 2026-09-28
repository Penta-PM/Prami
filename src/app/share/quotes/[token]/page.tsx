import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { getDb } from '@/db';
import { QuoteSheet } from '@/features/calculator/QuoteSheet';
import { formatAuditTime } from '@/lib/audit-format';
import { findSharedQuote } from '@/server/quotes/shares';

/**
 * 견적 공유 페이지 (§4.5.8, AC-71): 로그인 불필요(proxy matcher 제외), 읽기 전용, 원가 없음.
 * 토큰이 없거나 만료·폐기됐거나 견적이 삭제됐으면 404. 검색 엔진 색인은 막는다.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '공유 견적서',
  robots: { index: false, follow: false },
};

type SharePageProps = { params: Promise<{ token: string }> };

export default async function SharedQuotePage({ params }: SharePageProps) {
  const { token } = await params;
  const shared = await findSharedQuote(await getDb(), token);
  if (!shared) notFound();
  return (
    <main className="min-h-screen bg-surface-page px-4 py-10">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-prami-mark.png" alt="Prami" width={28} height={28} />
            <span className="text-ink-900 [font:var(--text-wordmark)]">Prami</span>
          </div>
          <p role="note" className="m-0 text-[12px] text-text-tertiary">
            공유 링크 만료: {formatAuditTime(new Date(shared.expiresAt))}
          </p>
        </header>
        <QuoteSheet document={shared.document} />
        <p className="m-0 text-center text-[12px] text-text-tertiary">
          본 견적서는 Prami 계산기로 산출한 가견적이며 계약 금액이 아닙니다.
        </p>
      </div>
    </main>
  );
}
