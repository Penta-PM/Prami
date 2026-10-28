import 'server-only';

import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';

import type { Db, DbHandle } from '@/db';
import {
  procurementJobRuns,
  procurementMailRecipients,
  type ProcurementMailRecipient,
} from '@/db/schema/procurement';
import { withTransaction } from '@/db/tx';
import {
  duplicateMailRecipientMessage,
  MAIL_RECIPIENT_LIMIT_MESSAGE,
  MAIL_RECIPIENT_MAX,
  mailRecipientKey,
  normalizeMailRecipient,
  readMailReport,
  type MailReportResult,
} from '@/lib/procurement/mail-recipients';
import { AppError } from '@/lib/result';
import { writeAudit, type RequestMeta } from '@/server/audit/log';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { getCollectionStatus } from './collection';
import { ALREADY_PROCESSED } from './keywords';

/**
 * 메일 보고 (수집기 Prami 이전 §3.1, `/admin/procurement?tab=mail`, procurement.write). mail_recipients 의 추가·삭제와
 * 감사 audit_logs(`procurement.mail_recipient.add|remove`, actorUserId)를 **같은 트랜잭션**에서 기록한다(키워드 관리와 같은 규칙).
 * 수신처에는 이력 표가 없다 — 감사 로그가 유일한 이력이다(대상 이름 = 주소, 사용자 관리 감사와 같은 관례).
 * 형식·중복(대소문자 무시)·20개 상한은 VALIDATION(입력칸 아래), 이미 삭제된 수신처 삭제는 CONFLICT("이미 처리됨").
 */

export const AUDIT_PROCUREMENT_MAIL_RECIPIENT_ADD = 'procurement.mail_recipient.add';
export const AUDIT_PROCUREMENT_MAIL_RECIPIENT_REMOVE = 'procurement.mail_recipient.remove';

const AUDIT_TARGET_TYPE = 'procurement.mail_recipient';

export type MailRecipientView = {
  id: number;
  email: string;
  /** 추가한 사람(메일의 @ 앞). 기록이 없으면 null */
  addedBy: string | null;
  createdAt: string;
};

export type MailReportStatus = MailReportResult & {
  /** 실행 시각 = 종료 시각(없으면 시작 시각) */
  ranAt: string;
  /** job_runs.status (ok / failed) */
  runStatus: string;
};

export type MailReportBoard = {
  recipients: MailRecipientView[];
  /** 마지막으로 끝난 일일 보고(job='daily') 실행 — 기록이 없으면 null */
  lastReport: MailReportStatus | null;
  /** 마지막 보고 기준일 (app_state `daily` 값의 last_end_date) — 없으면 null */
  lastEndDate: string | null;
};

export type MailRecipientWriteContext = {
  access: ProcurementAccess;
  handle: DbHandle;
  meta: RequestMeta;
};

function addedBy(createdBy: string | null): string | null {
  if (!createdBy) return null;
  const at = createdBy.indexOf('@');
  return at > 0 ? createdBy.slice(0, at) : createdBy;
}

function toView(row: ProcurementMailRecipient): MailRecipientView {
  return {
    id: row.id,
    email: row.email,
    addedBy: addedBy(row.createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}

function snapshot(row: ProcurementMailRecipient) {
  return { email: row.email, createdBy: row.createdBy };
}

function target(row: ProcurementMailRecipient) {
  return { type: AUDIT_TARGET_TYPE, id: String(row.id), label: row.email };
}

/**
 * 마지막으로 끝난 일일 보고 실행 (진행 중 실행은 메일 결과가 아직 없으므로 건너뛴다 — 진행 중 표시는 머리 ProcurementHeader).
 * `--skip-if-done` 으로 건너뛴 실행은 job_runs 에 행을 남기지 않는다(원본 수집기).
 */
async function lastDailyReport(db: Db): Promise<MailReportStatus | null> {
  const r = procurementJobRuns;
  const [run] = await db
    .select({
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      summary: r.summary,
    })
    .from(r)
    .where(and(eq(r.job, 'daily'), ne(r.status, 'running')))
    .orderBy(desc(r.startedAt), desc(r.id))
    .limit(1);
  if (!run) return null;
  return {
    ...readMailReport(run.summary),
    ranAt: (run.finishedAt ?? run.startedAt).toISOString(),
    runStatus: run.status,
  };
}

/** 수신처 전체(추가 순) + 상태 카드(마지막 일일 보고·보고 기준일) */
export async function getMailReportBoard(
  access: ProcurementAccess,
  db: Db,
): Promise<MailReportBoard> {
  assertProcurementAccess(access, 'write');
  const [rows, lastReport, status] = await Promise.all([
    db.select().from(procurementMailRecipients).orderBy(asc(procurementMailRecipients.id)),
    lastDailyReport(db),
    getCollectionStatus(access, db),
  ]);
  return { recipients: rows.map(toView), lastReport, lastEndDate: status.dailyLastEndDate };
}

export type AddMailRecipientInput = { email: string };
export type RemoveMailRecipientInput = { id: number };

function invalidEmail(message: string) {
  return new AppError('VALIDATION', message, { email: [message] });
}

/** 추가: 검증 → 표 잠금(추가 직렬화) → 대소문자 무시 중복·20개 상한 → insert → 감사 */
export async function addMailRecipient(
  ctx: MailRecipientWriteContext,
  input: AddMailRecipientInput,
): Promise<MailRecipientView> {
  assertProcurementAccess(ctx.access, 'write');
  const checked = normalizeMailRecipient(input?.email);
  if (!checked.ok) throw invalidEmail(checked.message);
  const { email } = checked;
  const key = mailRecipientKey(email);
  return withTransaction(async (tx) => {
    // 수신처 추가 전체를 직렬화 — 동시 추가로 20개를 넘거나 대소문자만 다른 주소가 겹치지 않게(트랜잭션 끝에 풀림)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('procurement.mail_recipients'))`);
    const [existing] = await tx
      .select({ email: procurementMailRecipients.email })
      .from(procurementMailRecipients)
      .where(sql`lower(${procurementMailRecipients.email}) = ${key}`)
      .limit(1);
    if (existing) throw invalidEmail(duplicateMailRecipientMessage(existing.email));
    const [total] = await tx.select({ n: count() }).from(procurementMailRecipients);
    if ((total?.n ?? 0) >= MAIL_RECIPIENT_MAX) throw invalidEmail(MAIL_RECIPIENT_LIMIT_MESSAGE);
    // ON CONFLICT DO NOTHING — 잠금 밖의 경로(직접 SQL 등)와 겹쳐도 고유 인덱스 위반 대신 같은 중복 안내
    const [row] = await tx
      .insert(procurementMailRecipients)
      .values({ email, createdBy: ctx.access.email })
      .onConflictDoNothing()
      .returning();
    if (!row) throw invalidEmail(duplicateMailRecipientMessage(email));
    await writeAudit(tx, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_PROCUREMENT_MAIL_RECIPIENT_ADD,
      target: target(row),
      after: snapshot(row),
      meta: ctx.meta,
    });
    return toView(row);
  }, ctx.handle);
}

/** 삭제: delete … returning → 감사(삭제 전 값). 이미 없으면 CONFLICT */
export async function removeMailRecipient(
  ctx: MailRecipientWriteContext,
  input: RemoveMailRecipientInput,
): Promise<MailRecipientView> {
  assertProcurementAccess(ctx.access, 'write');
  const id = input?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw new AppError('VALIDATION', '삭제할 수신처를 확인하세요', { id: ['잘못된 수신처 번호'] });
  }
  return withTransaction(async (tx) => {
    const [row] = await tx
      .delete(procurementMailRecipients)
      .where(eq(procurementMailRecipients.id, id))
      .returning();
    if (!row) {
      throw new AppError('CONFLICT', `${ALREADY_PROCESSED} — 이미 삭제된 수신처입니다`, undefined, {
        alreadyProcessed: true,
      });
    }
    await writeAudit(tx, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_PROCUREMENT_MAIL_RECIPIENT_REMOVE,
      target: target(row),
      before: snapshot(row),
      meta: ctx.meta,
    });
    return toView(row);
  }, ctx.handle);
}
