'use client';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';

export type DraftBannerState = { restoredAt: string; notices: readonly string[] };

/**
 * 입력 초안 복원 안내 (page-state-memory §2.6-1): `role="status"` "이전 작업을 복원했습니다 (MM-DD HH:mm) · [새로 시작]".
 * 최신가 갱신·판매 중지 제외·단계 멈춤 안내(§2.4-3·§2.5)를 아래 줄에 덧붙인다.
 * Collapse(height + fade) 로 접힌다 — 감속 모드는 MotionProvider(reducedMotion="user")가 따른다. 시각은 서버가 만든 문자열.
 */
export function DraftRestoreBanner({
  banner,
  label,
  onReset,
}: {
  banner: DraftBannerState | null;
  /** 같은 화면에 배너가 둘 이상일 때 구분 (접근 이름) */
  label: string;
  onReset: () => void;
}) {
  return (
    <Presence>
      {banner ? (
        <Collapse key="draft-restore" role="status" aria-label={label}>
          <div className="flex flex-col gap-1 rounded-lg bg-purple-600/10 px-3.5 py-2.5 text-[13px] text-text-primary">
            <p className="m-0">
              이전 작업을 복원했습니다 ({banner.restoredAt}) ·{' '}
              <button
                type="button"
                onClick={onReset}
                className="border-0 bg-transparent p-0 font-semibold text-purple-600 underline-offset-2 hover:underline"
              >
                새로 시작
              </button>
            </p>
            {banner.notices.map((notice) => (
              <p key={notice} className="m-0 text-[12px] text-text-secondary">
                {notice}
              </p>
            ))}
          </div>
        </Collapse>
      ) : null}
    </Presence>
  );
}
