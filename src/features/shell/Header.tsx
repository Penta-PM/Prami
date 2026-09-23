import { Input } from '@/components/ui/input';

import { Icon, type IconName } from './icons';

export type HeaderUser = {
  name: string;
  /** 예: "관리자 · 가격정책팀" */
  roleLabel: string;
};

export type HeaderProps = {
  /** 로그인 사용자. PR-2(인증)에서 세션으로 채운다. 없으면 게스트 표시 */
  user?: HeaderUser;
};

/** 앱 셸 헤더: 통합 검색, 챗봇/공지 버튼, 사용자 표시 */
export function Header({ user }: HeaderProps) {
  const initial = user?.name.trim().charAt(0) || '?';

  return (
    <header className="sticky top-0 z-[5] flex h-[72px] shrink-0 items-center gap-5 border-b border-border-subtle bg-surface-page px-8">
      <form role="search" action="/search" method="get" className="max-w-[480px] flex-1">
        <Input
          type="search"
          name="q"
          aria-label="통합 검색"
          placeholder="제품, 모델, 가격정책, 공지사항 검색"
          leading={<Icon name="search" className="size-4" />}
        />
      </form>
      <div className="flex-1" />
      <IconButton label="챗봇" icon="chat" />
      <IconButton label="공지사항" icon="bell" />
      <div className="flex items-center gap-2.5 border-l border-border-subtle pl-3.5">
        <div
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-circle bg-ink-900 text-[13px] font-semibold text-white"
        >
          {initial}
        </div>
        <div className="leading-[1.3]">
          <div className="text-[13px] font-semibold">{user?.name ?? '로그인 필요'}</div>
          <div className="text-[11px] font-medium text-text-tertiary">
            {user?.roleLabel ?? '인증은 PR-2에서 연결됩니다'}
          </div>
        </div>
      </div>
    </header>
  );
}

function IconButton({ label, icon }: { label: string; icon: IconName }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-pill border-0 bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900"
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}
