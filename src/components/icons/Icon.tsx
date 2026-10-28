import { cn } from '@/lib/cn';

import { PENTA_ICONS, type PentaIconName } from './penta';

export type { PentaIconName } from './penta';

/** 렌더링 크기 — 20·24 만. 원본 1px 선이 16px 이하에서 0.67px 로 흐려지므로 더 작게 그리지 않는다 (#88) */
export type IconSize = 20 | 24;

export type IconProps = {
  name: PentaIconName;
  /** 기본 20 */
  size?: IconSize;
  /** 의미를 전달하는 아이콘일 때만 — role="img" + <title>. 없으면 장식(aria-hidden) */
  title?: string;
  /** 색(text-*)·배치·회전(rotate-*)만. 선 두께·크기 덮어쓰기는 하지 않는다 */
  className?: string;
};

/**
 * Penta 아이콘 (디자인 PR-3, docs/design/penta-tokens.md "아이콘").
 * 색은 currentColor — 부모 글자색을 따른다. stroke 덮어쓰기 prop 은 두지 않는다(원본 1px 유지).
 */
export function Icon({ name, size = 20, title, className }: IconProps) {
  const icon = PENTA_ICONS[name];
  const a11y = title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      focusable="false"
      data-icon={name}
      // flex 안에서 줄어들지 않게 — 20px 미만 렌더링 금지
      className={cn('shrink-0', className)}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {icon.body}
    </svg>
  );
}

/**
 * 펼치기 표시(기존 ▾·▴ 글리프) — Penta chevron-right 를 90°(아래, 펼치기)·-90°(위, 접기) 회전해 쓴다.
 * 회전은 새로 그리는 것이 아니므로 허용(디자인 PR-3). 장식 — 상태는 버튼 문구·aria-expanded 가 전달한다.
 */
export function DisclosureIcon({ open, className }: { open: boolean; className?: string }) {
  return <Icon name="chevron-right" className={cn(open ? '-rotate-90' : 'rotate-90', className)} />;
}
