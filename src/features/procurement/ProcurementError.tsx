'use client';

import { Button, Card } from '@/components/ui';

/**
 * 조달 화면 오류 상태 (route error.tsx 공용). 앱 셸(사이드바·헤더)은 그대로 두고 본문만 대체한다.
 * 오류 내용은 서버 로그(요청 ID)에만 남기고 화면에는 digest 만 보인다(루트 error.tsx 와 같은 규칙).
 */
export function ProcurementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card role="alert" aria-labelledby="procurement-error-title" className="flex flex-col gap-3">
      <h1 id="procurement-error-title" className="m-0 [font:var(--text-h2)]">
        조달 화면을 불러오지 못했습니다
      </h1>
      <p className="m-0 text-[14px] text-text-tertiary">
        잠시 후 다시 시도하세요. 문제가 계속되면 관리자에게 아래 오류 코드를 알려 주세요.
      </p>
      {error.digest ? (
        <code className="w-fit rounded-lg bg-surface-muted px-3 py-2 text-[12px]">
          {error.digest}
        </code>
      ) : null}
      <Button type="button" onClick={reset} className="w-fit">
        다시 시도
      </Button>
    </Card>
  );
}
