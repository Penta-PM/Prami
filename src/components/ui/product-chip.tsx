import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { PRODUCT_FG_CLASS, productColor } from '@/lib/constants/product-colors';

/**
 * 표 안 제품 분류 칩 (Penta 디자인 §13 수정): 읽기 전용 배지(버튼 아님) — 제품 색 배경 + N900 글자.
 * 4개 제품(+iSIGN PKI) 밖 값은 평문 그대로. 밀집 행(36) 높이를 늘리지 않게 py-0.5·12px.
 * 렌더만 칩이고 정렬·필터·내보내기 값은 원래 텍스트 그대로다.
 */
export function ProductChip({
  product,
  children,
  className,
}: {
  product: string | null | undefined;
  /** 칩 안 글자 — 없으면 product */
  children?: ReactNode;
  className?: string;
}) {
  const content = children ?? product;
  const color = productColor(product);
  if (!color) return <>{content}</>;
  return (
    <span
      data-product-chip=""
      style={{ background: color }}
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 text-[12px] leading-4 font-semibold whitespace-nowrap',
        PRODUCT_FG_CLASS,
        className,
      )}
    >
      {content}
    </span>
  );
}
