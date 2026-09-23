import { and, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '@/db';
import { auditLogs, type AuditLog } from '@/db/schema';

/** 감사 로그 화면 (§4.5.10): 필터(기간·행위·사용자), 페이지 50, CSV 내보내기 */
export const AUDIT_PAGE_SIZE = 50;
/** CSV 1회 내보내기 상한 (서버 메모리·응답 크기 보호) */
export const AUDIT_EXPORT_LIMIT = 10_000;
/** 날짜 필터는 사용자 기준 한국 시간으로 해석한다 */
export const AUDIT_TIMEZONE = 'Asia/Seoul';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

const trimmed = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value || undefined)
  .optional()
  .catch(undefined);

/** URL 검색 파라미터 → 필터. 잘못된 값은 버린다 (필터는 사용자가 URL 로 조작할 수 있음) */
export const auditFilterSchema = z.object({
  from: isoDate,
  to: isoDate,
  action: trimmed,
  actor: trimmed,
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;

export function parseAuditFilter(params: Record<string, string | string[] | undefined>) {
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return auditFilterSchema.parse({
    from: pick('from'),
    to: pick('to'),
    action: pick('action'),
    actor: pick('actor'),
    page: pick('page'),
  });
}

/** LIKE 와일드카드를 이스케이프한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildWhere(filter: AuditFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.from) {
    conditions.push(
      sql`${auditLogs.createdAt} >= (${filter.from}::date::timestamp at time zone ${AUDIT_TIMEZONE})`,
    );
  }
  if (filter.to) {
    conditions.push(
      sql`${auditLogs.createdAt} < ((${filter.to}::date + 1)::timestamp at time zone ${AUDIT_TIMEZONE})`,
    );
  }
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.actor) conditions.push(ilike(auditLogs.actorLabel, `%${escapeLike(filter.actor)}%`));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export type AuditPage = {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function getAuditLogs(db: Db, filter: AuditFilter): Promise<AuditPage> {
  const where = buildWhere(filter);
  const [counted] = await db.select({ total: count() }).from(auditLogs).where(where);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  return { rows, total, page, pageSize: AUDIT_PAGE_SIZE, pageCount };
}

/** 행위 필터 드롭다운 옵션 */
export async function listAuditActions(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action);
  return rows.map((row) => row.action);
}

export async function getAuditLogsForExport(db: Db, filter: AuditFilter): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(buildWhere(filter))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_EXPORT_LIMIT);
}
