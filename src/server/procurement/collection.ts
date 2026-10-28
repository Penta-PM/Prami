import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { procurementAppState, procurementJobRuns } from '@/db/schema/procurement';
import {
  PROCUREMENT_JOBS,
  PROCUREMENT_STATE_FIELDS,
  PROCUREMENT_STATE_KEYS,
  type ProcurementJob,
} from '@/lib/procurement/constants';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';

/**
 * 마지막 수집 시각 (각 조달 화면 머리 — ProcurementHeader). 기준: job_runs(작업별 성공 종료 시각) + app_state(작업 상태 키 갱신 시각).
 * 둘 다 없으면 collectedAt = null → 화면은 "수집 기록 없음".
 */

export type JobCollection = {
  job: ProcurementJob;
  /** 마지막 성공(ok) 실행의 종료 시각 */
  lastSuccessAt: Date | null;
  /** 가장 최근 실행 (성공·실패·진행 중 무관) — 실패 표시용 */
  lastRun: { status: string; startedAt: Date; finishedAt: Date | null } | null;
  /** 작업 상태 키(app_state)의 갱신 시각 */
  stateUpdatedAt: Date | null;
  /** 화면 표시용 = lastSuccessAt 과 stateUpdatedAt 중 늦은 것 */
  collectedAt: Date | null;
};

export type ProcurementCollectionStatus = {
  daily: JobCollection;
  bids: JobCollection;
  /** 입찰 공고 "마지막 확인 시각" (app_state `bids` 값의 last_checked, 시각으로 읽히지 않으면 null) */
  bidsLastCheckedAt: Date | null;
  /** 마지막 메일 보고 기준일 (app_state `daily` 값의 last_end_date, 'YYYY-MM-DD' 가 아니면 null) */
  dailyLastEndDate: string | null;
};

const STATE_KEY_OF_JOB: Record<ProcurementJob, string> = {
  daily: PROCUREMENT_STATE_KEYS.daily,
  bids: PROCUREMENT_STATE_KEYS.bids,
};

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** jsonb 값(필드 객체)의 한 필드 — 객체가 아니거나 필드가 없으면 undefined (형식이 어긋나도 예외 없이 '기록 없음') */
function stateField(value: unknown, field: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function stateDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stateDay(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export async function getCollectionStatus(
  access: ProcurementAccess,
  db: Db,
): Promise<ProcurementCollectionStatus> {
  assertProcurementAccess(access, 'read');
  const r = procurementJobRuns;
  const [successes, latest, states] = await Promise.all([
    db
      .select({
        job: r.job,
        at: sql<Date | null>`max(${r.finishedAt})`.mapWith(r.finishedAt),
      })
      .from(r)
      .where(and(eq(r.status, 'ok'), inArray(r.job, [...PROCUREMENT_JOBS])))
      .groupBy(r.job),
    db
      .selectDistinctOn([r.job], {
        job: r.job,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })
      .from(r)
      .where(inArray(r.job, [...PROCUREMENT_JOBS]))
      .orderBy(r.job, desc(r.startedAt), desc(r.id)),
    db
      .select()
      .from(procurementAppState)
      .where(inArray(procurementAppState.key, Object.values(PROCUREMENT_STATE_KEYS))),
  ]);
  const stateOf = (key: string) => states.find((row) => row.key === key);
  const build = (job: ProcurementJob): JobCollection => {
    const lastSuccessAt = successes.find((row) => row.job === job)?.at ?? null;
    const run = latest.find((row) => row.job === job);
    const stateUpdatedAt = stateOf(STATE_KEY_OF_JOB[job])?.updatedAt ?? null;
    return {
      job,
      lastSuccessAt,
      lastRun: run
        ? { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt }
        : null,
      stateUpdatedAt,
      collectedAt: later(lastSuccessAt, stateUpdatedAt),
    };
  };
  return {
    daily: build('daily'),
    bids: build('bids'),
    bidsLastCheckedAt: stateDate(
      stateField(
        stateOf(PROCUREMENT_STATE_KEYS.bids)?.value,
        PROCUREMENT_STATE_FIELDS.bidsLastChecked,
      ),
    ),
    dailyLastEndDate: stateDay(
      stateField(
        stateOf(PROCUREMENT_STATE_KEYS.daily)?.value,
        PROCUREMENT_STATE_FIELDS.dailyLastEndDate,
      ),
    ),
  };
}
