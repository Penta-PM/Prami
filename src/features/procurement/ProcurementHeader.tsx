import type { ReactNode } from 'react';

import { formatDateTime } from '@/lib/date-format';

/** 수집 기록이 없을 때 (E2E·새 설치 — 조달 데이터 0행) */
export const NO_COLLECTION_TEXT = '아직 수집 기록이 없습니다';

/** 마지막 수집 시각 표시 문구 — 한국 시간 `YYYY-MM-DD HH:mm (KST)`, 없으면 안내 문구 */
export function formatCollectedAt(collectedAt: Date | null): string {
  return collectedAt ? `${formatDateTime(collectedAt)} (KST)` : NO_COLLECTION_TEXT;
}

export type ProcurementHeaderProps = {
  title: string;
  /** 마지막 수집 시각 (getCollectionStatus 의 collectedAt — job_runs 성공 종료·app_state 갱신 중 늦은 것) */
  collectedAt: Date | null;
  /** 데이터 기준 안내 (화면마다 무엇을 기준으로 집계·표시하는지) */
  basis: string;
  /** 제목 줄 오른쪽 (내려받기 등 — UI-2 이후) */
  actions?: ReactNode;
};

/**
 * 조달 화면 공용 머리 (조달이 통합 UI-1 §공통): 제목(h1#page-title — 화면 section 의 aria-labelledby 대상) +
 * 마지막 수집 시각 + 데이터 기준 안내. 서버·클라이언트 어디서 렌더해도 같은 문자열이다(date-format 은 CLDR 비의존).
 */
export function ProcurementHeader({ title, collectedAt, basis, actions }: ProcurementHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          {title}
        </h1>
        {actions}
      </div>
      <dl className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-tertiary">
        <div className="flex gap-1.5">
          <dt className="font-semibold">마지막 수집</dt>
          <dd className="m-0 tabular-nums" data-testid="procurement-collected-at">
            {collectedAt ? (
              <time dateTime={collectedAt.toISOString()}>{formatCollectedAt(collectedAt)}</time>
            ) : (
              NO_COLLECTION_TEXT
            )}
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 font-semibold">데이터 기준</dt>
          <dd className="m-0 min-w-0 break-keep">{basis}</dd>
        </div>
      </dl>
    </header>
  );
}
