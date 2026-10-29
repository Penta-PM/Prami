/**
 * TEST MODE 배너 (§4.8 r5 ④, AC-94 ③): AUTH_TEST_MODE 가 켜진 서버임을 눈에 띄게 알린다 — 공용 비밀번호로 누구나
 * 픽스처 계정(ADMIN 포함)에 로그인할 수 있는 상태이므로 LAN/공개 URL 에 열려 있으면 안 된다. 끄면 렌더되지 않는다.
 */
export const TEST_MODE_BANNER_TEXT = 'TEST MODE';

export function TestModeBanner({ variant = 'block' }: { variant?: 'block' | 'inline' }) {
  if (variant === 'inline') {
    return (
      // 페이지의 상태 메시지(role=status)와 겹치지 않도록 역할 없이 배지로만 둔다
      <span
        data-testid="test-mode-badge"
        title="AUTH_TEST_MODE=true — 공용 테스트 비밀번호로 로그인되는 로컬 전용 모드"
        className="rounded-pill bg-warning-500 px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] text-text-primary"
      >
        {TEST_MODE_BANNER_TEXT}
      </span>
    );
  }
  return (
    <div
      role="status"
      aria-label="테스트 모드"
      className="rounded-lg border-2 border-warning-500 bg-warning-50 px-3.5 py-2.5 text-center text-[12px] text-text-primary"
    >
      <strong className="block text-[14px] tracking-[0.08em]">{TEST_MODE_BANNER_TEXT}</strong>
      공용 테스트 비밀번호로 로그인되는 로컬 전용 모드입니다. 네트워크(LAN·공개 URL)에 노출하지
      마세요.
    </div>
  );
}
