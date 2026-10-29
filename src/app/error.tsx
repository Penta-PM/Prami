'use client';

import { Button } from '@/components/ui/button';

/**
 * 루트 오류 경계 (PR-11a QA M-1). 이 파일이 없으면 페이지 렌더 오류가 정적 프리렌더된 `/_global-error` 로 떨어지는데,
 * 정적 HTML 에는 요청별 CSP nonce 가 없어 스크립트가 전부 차단된다. 루트 레이아웃 안에서 렌더되는 이 경계는 동적이라 nonce 를 받는다.
 * 오류 내용은 서버 로그(요청 ID)에만 남기고 화면에는 digest 만 보인다.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-12">
      <section
        role="alert"
        aria-labelledby="error-title"
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-2xl bg-surface-card p-8 text-center shadow-(--shadow-elevated)"
      >
        <h1 id="error-title" className="m-0 [font:var(--text-h2)]">
          화면을 불러오지 못했습니다
        </h1>
        <p className="m-0 text-[14px] text-text-tertiary">
          잠시 후 다시 시도하세요. 문제가 계속되면 관리자에게 아래 오류 코드를 알려 주세요.
        </p>
        {error.digest ? (
          <code className="rounded-lg bg-surface-muted px-3 py-2 text-[12px]">{error.digest}</code>
        ) : null}
        <Button variant="primary" onClick={reset}>
          다시 시도
        </Button>
      </section>
    </main>
  );
}
