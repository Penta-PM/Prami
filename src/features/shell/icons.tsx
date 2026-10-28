import type { SVGProps } from 'react';

import { Icon, type PentaIconName } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';

/**
 * 기존(디자인 소스 ICONS) 라인 아이콘 — Penta 라이브러리에 대응 아이콘이 없거나(보류) 20px 가 들어가지 않는 자리에만 남긴다
 * (디자인 PR-3, docs/design/penta-tokens.md "아이콘" — 보류 목록·작은 크기 유지 자리). 새 화면은 `@/components/icons/Icon` 을 쓴다.
 * - tag·cart·info: Penta 에 없음(라이브러리 추가 요청 후보)
 * - bell·users: 알림 목록 유형 배지(28px 원 안 14px)가 20px 를 받지 못해 tag 와 함께 기존 표시 유지
 */
export type LegacyIconName = 'tag' | 'cart' | 'info' | 'bell' | 'users';

type LegacyIconProps = SVGProps<SVGSVGElement> & { name: LegacyIconName };

const STROKE = { stroke: 'currentColor', strokeWidth: 1.6 } as const;

const PATHS: Record<LegacyIconName, React.ReactNode> = {
  tag: (
    <>
      <path d="M12.6 3H8.4L3 8.4v4.2L11.4 21l9-9L12.6 3Z" {...STROKE} strokeLinejoin="round" />
      <circle cx="8.3" cy="8.7" r="1.4" fill="currentColor" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" {...STROKE} />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" {...STROKE} strokeLinecap="round" />
      <path
        d="M15.5 6a3 3 0 0 1 0 5.8M18 20c0-2.6-1.7-4.4-4-4.9"
        {...STROKE}
        strokeLinecap="round"
      />
    </>
  ),
  bell: (
    <>
      <path
        d="M6 10a6 6 0 1 1 12 0c0 3 1 4.5 2 6H4c1-1.5 2-3 2-6Z"
        {...STROKE}
        strokeLinejoin="round"
      />
      <path d="M10 20a2 2 0 0 0 4 0" {...STROKE} />
    </>
  ),
  /** 안내(원 안 i) — InfoHint 트리거·ERP 안내 제목. 유니코드 ⓘ 대신 쓴다 (erp-upload-guide §2-1) */
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M12 11v5.5" {...STROKE} strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.05" fill="currentColor" />
    </>
  ),
  /** 조달 관리 — 장바구니 */
  cart: (
    <>
      <path
        d="M3 4h2.5l2.2 10.5a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 8H6.6"
        {...STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="19" r="1.3" fill="currentColor" />
      <circle cx="16.5" cy="19" r="1.3" fill="currentColor" />
    </>
  ),
};

export function LegacyIcon({ name, ...props }: LegacyIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      {PATHS[name]}
    </svg>
  );
}

/** 사이드바 메뉴 아이콘 — Penta 이름, 또는 Penta 에 없는 보류 아이콘(tag·cart) */
export type NavIconName = PentaIconName | 'tag' | 'cart';

const LEGACY_NAV_ICONS: ReadonlySet<string> = new Set(['tag', 'cart']);

/** Penta 는 20px, 보류(기존) 아이콘은 기존 18px 그대로 */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  if (LEGACY_NAV_ICONS.has(name)) {
    return (
      <LegacyIcon name={name as 'tag' | 'cart'} className={cn('size-[18px] shrink-0', className)} />
    );
  }
  return <Icon name={name as PentaIconName} size={20} className={className} />;
}
