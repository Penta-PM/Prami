import Link from 'next/link';

import { PRODUCT_CARDS, productCardHref } from '@/lib/constants/product-cards';

/**
 * 홈 제품 바로가기 카드 4개 (디자인 HOME, AC-50). 디자인의 제품 로고 이미지는 저장소에 없어 제품명을 강조색으로
 * 표시한다. 카드 → `/pricing?major=…` (iSIGN PKI 는 iSIGN 카드에 포함, Q-10).
 */
export function ProductCards() {
  return (
    <section aria-labelledby="home-products" className="flex flex-col gap-3.5">
      <h2 id="home-products" className="m-0 [font:var(--text-h2)]">
        제품 바로가기
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
        {PRODUCT_CARDS.map((card) => (
          <li key={card.id}>
            <Link
              href={productCardHref(card)}
              aria-label={`${card.name} 가격 정책 보기`}
              className="flex flex-col gap-3.5 rounded-2xl bg-surface-card p-6 text-text-primary no-underline shadow-(--hairline-default) transition-[translate,box-shadow] hover:-translate-y-0.5 hover:text-text-primary hover:no-underline hover:shadow-(--shadow-elevated) motion-reduce:hover:translate-y-0"
            >
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-lg"
                style={{ background: card.accentSoft }}
              >
                <span className="size-5 rounded-[5px]" style={{ background: card.accent }} />
              </span>
              <span className="text-[18px] font-bold tracking-[-0.01em]">{card.name}</span>
              <span className="mt-1 text-[14px] font-semibold" style={{ color: card.accent }}>
                가격 정책 보기 →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
