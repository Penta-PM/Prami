import type { SVGProps } from 'react';

/** 디자인 소스(ICONS)의 라인 아이콘. 24x24 뷰박스, currentColor 사용 */
export type IconName =
  | 'home'
  | 'tag'
  | 'calc'
  | 'shield'
  | 'box'
  | 'group'
  | 'users'
  | 'log'
  | 'chat'
  | 'search'
  | 'bell'
  | 'info'
  | 'chart'
  | 'list'
  | 'doc'
  | 'cart';

type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

const STROKE = { stroke: 'currentColor', strokeWidth: 1.6 } as const;

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <path
      d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z"
      {...STROKE}
      strokeLinejoin="round"
    />
  ),
  tag: (
    <>
      <path d="M12.6 3H8.4L3 8.4v4.2L11.4 21l9-9L12.6 3Z" {...STROKE} strokeLinejoin="round" />
      <circle cx="8.3" cy="8.7" r="1.4" fill="currentColor" />
    </>
  ),
  calc: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" {...STROKE} />
      <path
        d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0"
        {...STROKE}
        strokeLinecap="round"
      />
    </>
  ),
  shield: (
    <path
      d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
      {...STROKE}
      strokeLinejoin="round"
    />
  ),
  box: (
    <>
      <path d="M3.5 7 12 3l8.5 4L12 11 3.5 7Z" {...STROKE} strokeLinejoin="round" />
      <path d="M3.5 7v10L12 21l8.5-4V7M12 11v10" {...STROKE} strokeLinejoin="round" />
    </>
  ),
  group: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...STROKE} />
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
  log: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" {...STROKE} />
      <path d="M8 8h8M8 12h8M8 16h5" {...STROKE} strokeLinecap="round" />
    </>
  ),
  chat: <path d="M4 5h16v10H9l-4 4V5Z" {...STROKE} strokeLinejoin="round" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth={1.7} />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
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
  /** 조달 실적 현황 — 막대 차트 */
  chart: (
    <>
      <path d="M4 20h16" {...STROKE} strokeLinecap="round" />
      <path d="M7 16v-5M12 16V6M17 16v-8" {...STROKE} strokeLinecap="round" />
    </>
  ),
  /** 등록 품목 — 목록 */
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" {...STROKE} strokeLinecap="round" />
      <circle cx="5" cy="6" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  /** 입찰 공고 — 접힌 모서리 문서 */
  doc: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" {...STROKE} strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 16h6" {...STROKE} strokeLinecap="round" strokeLinejoin="round" />
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

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      {PATHS[name]}
    </svg>
  );
}

/** 경고 삼각형(느낌표) — 주의 안내용 (PRAMI-003 §4.8.3). 색은 currentColor, 의미는 함께 둔 제목 텍스트가 전달한다 */
export function WarningIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 3.5 21 19.5H3L12 3.5Z" {...STROKE} strokeLinejoin="round" />
      <path d="M12 10v4.5" {...STROKE} strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}
