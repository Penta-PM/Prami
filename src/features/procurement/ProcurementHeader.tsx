import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/date-format';

/** 수집 기록이 없을 때 (E2E·새 설치 — 조달 데이터 0행) */
export const NO_COLLECTION_TEXT = '아직 수집 기록이 없습니다';

/** 마지막 수집 시각 표시 문구 — 한국 시간 `YYYY-MM-DD HH:mm (KST)`, 없으면 안내 문구 */
export function formatCollectedAt(collectedAt: Date | null): string {
  return collectedAt ? `${formatDateTime(collectedAt)} (KST)` : NO_COLLECTION_TEXT;
}

/** 작업 하나의 실행 기록 (getCollectionStatus 의 JobCollection 중 머리가 쓰는 칸 — 새 조회 없음) */
export type HeaderJobRun = {
  lastRun: { status: string; startedAt: Date } | null;
  lastSuccessAt: Date | null;
};

export type CollectionRunNotice =
  { kind: 'running'; startedAt: Date } | { kind: 'failed'; lastSuccessAt: Date | null } | null;

/**
 * 수집 상태 문구 판정 (수집기 Prami 이전 §3.2). 작업(daily·bids)을 함께 본다:
 * - 진행 중: 어느 작업이든 가장 최근 실행이 running 이면 — 실패보다 우선. 시작 시각은 진행 중 실행 중 가장 이른 것.
 * - 실패: (진행 중이 없고) 어느 작업이든 가장 최근 실행이 failed 이면. 마지막 성공 = 실패한 작업들의 마지막 성공 중 가장 이른 것
 *   (실패한 작업 중 하나라도 성공 기록이 없으면 null — "기록 없음").
 * - 그 밖(성공·기록 없음)은 null — 문구를 더하지 않는다. "지연" 판정은 하지 않는다(비범위).
 */
export function collectionRunNotice(runs: readonly HeaderJobRun[]): CollectionRunNotice {
  const running = runs
    .map((run) => run.lastRun)
    .filter((run) => run?.status === 'running')
    .map((run) => run!.startedAt);
  if (running.length > 0) {
    return { kind: 'running', startedAt: new Date(Math.min(...running.map((at) => at.getTime()))) };
  }
  const failed = runs.filter((run) => run.lastRun?.status === 'failed');
  if (failed.length === 0) return null;
  const successes = failed.map((run) => run.lastSuccessAt);
  const lastSuccessAt = successes.some((at) => at === null)
    ? null
    : new Date(Math.min(...successes.map((at) => at!.getTime())));
  return { kind: 'failed', lastSuccessAt };
}

/** 수집 상태 문구 — `수집 중 (HH:mm 시작)` / `최근 수집 실패 · 마지막 성공 …` (한국 시간) */
export function collectionRunNoticeText(notice: NonNullable<CollectionRunNotice>): string {
  if (notice.kind === 'running')
    return `수집 중 (${formatDateTime(notice.startedAt).slice(11)} 시작)`;
  return `최근 수집 실패 · 마지막 성공 ${
    notice.lastSuccessAt ? formatCollectedAt(notice.lastSuccessAt) : '기록 없음'
  }`;
}

/** 진행 중(회전 화살표)·실패(경고 삼각형) 아이콘 — 문구와 함께 쓴다(색만으로 구분하지 않음) */
function RunNoticeIcon({ kind }: { kind: 'running' | 'failed' }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {kind === 'running' ? (
        <>
          <path d="M10 6a4 4 0 1 1-1.2-2.85" />
          <path d="M9 1.2v2.2H6.8" />
        </>
      ) : (
        <>
          <path d="M6 1.3 11 10.5H1L6 1.3Z" />
          <path d="M6 5v2.3M6 8.8v.1" />
        </>
      )}
    </svg>
  );
}

export type ProcurementHeaderProps = {
  title: string;
  /** 마지막 수집 시각 (getCollectionStatus 의 collectedAt — job_runs 성공 종료·app_state 갱신 중 늦은 것) */
  collectedAt: Date | null;
  /** 수집 작업 실행 기록 (getCollectionStatus 의 daily·bids) — 진행 중·최근 실패 문구. 없으면 문구 없음 */
  runs?: readonly HeaderJobRun[];
  /** 데이터 기준 안내 (화면마다 무엇을 기준으로 집계·표시하는지) */
  basis: string;
  /** 제목 줄 오른쪽 (내려받기 등 — UI-2 이후) */
  actions?: ReactNode;
};

/**
 * 조달 화면 공용 머리 (조달이 통합 UI-1 §공통): 제목(h1#page-title — 화면 section 의 aria-labelledby 대상) +
 * 마지막 수집 시각 + 수집 상태(진행 중·최근 실패 — 정적 렌더, 새로고침 시 반영) + 데이터 기준 안내. 서버·클라이언트 어디서 렌더해도 같은 문자열이다(date-format 은 CLDR 비의존).
 */
export function ProcurementHeader({
  title,
  collectedAt,
  runs = [],
  basis,
  actions,
}: ProcurementHeaderProps) {
  const notice = collectionRunNotice(runs);
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
        {notice ? (
          <div className="flex min-w-0 gap-1.5">
            <dt className="sr-only">수집 상태</dt>
            <dd
              className={cn(
                'm-0 inline-flex min-w-0 items-center gap-1 font-semibold break-keep tabular-nums',
                notice.kind === 'failed' ? 'text-text-danger' : 'text-text-secondary',
              )}
              data-testid="procurement-collection-run"
              data-run={notice.kind}
            >
              <RunNoticeIcon kind={notice.kind} />
              {collectionRunNoticeText(notice)}
            </dd>
          </div>
        ) : null}
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 font-semibold">데이터 기준</dt>
          <dd className="m-0 min-w-0 break-keep">{basis}</dd>
        </div>
      </dl>
    </header>
  );
}
