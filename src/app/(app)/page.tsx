import type { Metadata } from 'next';
import Link from 'next/link';

import { getDb } from '@/db';
import { ProductCards } from '@/features/home/ProductCards';
import { NoticeRows } from '@/features/notices/NoticeRows';
import { listNotices } from '@/server/notices/queries';

export const metadata: Metadata = { title: 'HOME' };

const HOME_NOTICE_COUNT = 5;

/** HOME (§4.5.4, AC-50): 제품 바로가기 카드 4개 + 최근 공지 5건(중요 배지). 로그인은 셸이 보장한다 */
export default async function HomePage() {
  const recent = await listNotices(await getDb(), HOME_NOTICE_COUNT);
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-9">
      <h1 id="page-title" className="sr-only">
        HOME
      </h1>
      <ProductCards />
      <section
        aria-labelledby="home-notices"
        className="rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="home-notices" className="m-0 [font:var(--text-h2)]">
            공지사항
          </h2>
          <Link href="/notices" className="text-[13px] font-semibold">
            전체보기 →
          </Link>
        </div>
        <NoticeRows notices={recent} variant="home" />
      </section>
    </section>
  );
}
