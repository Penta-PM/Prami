'use client';

import { ProcurementError } from '@/features/procurement/ProcurementError';

/** 조달 화면 오류 경계 — 앱 셸은 유지하고 본문만 대체한다 */
export default function ProcurementRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ProcurementError error={error} reset={reset} />;
}
