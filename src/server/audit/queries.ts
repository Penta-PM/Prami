import { and, count, desc, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { auditLogs, type AuditLog } from '@/db/schema';
import {
  auditConditions,
  auditFilterDefs,
  parseAuditFilterParams,
  type AuditFilter,
  type AuditFilterId,
} from '@/features/audit/filter';
import type { AuditSortId } from '@/features/audit/sort';
import type { SortDir } from '@/lib/table/compare';
import { buildOrderBy, byStatus, byText, byValue } from '@/server/pricing/sort-sql';
import { buildFilterSpec, filterSqlConditions } from '@/server/table/filter-sql';

export type { AuditFilter } from '@/features/audit/filter';

/** 감사 로그 화면 (§4.5.10): 열 필터(일시·사용자·행위·대상·IP·결과 — 기간·행위·사용자는 기존 파라미터 별칭), 페이지 50, CSV 내보내기 */
export const AUDIT_PAGE_SIZE = 50;
/** CSV 1회 내보내기 상한 (서버 메모리·응답 크기 보호) */
export const AUDIT_EXPORT_LIMIT = 10_000;
/** 날짜 필터는 사용자 기준 한국 시간으로 해석한다 */
export const AUDIT_TIMEZONE = 'Asia/Seoul';

/** URL 검색 파라미터 → 필터 (기존 별칭 from·to·action·actor + 열 필터 f.*). 잘못된 값은 버린다 — features/audit/filter */
export function parseAuditFilter(
  params: Record<string, string | string[] | undefined>,
): AuditFilter {
  return parseAuditFilterParams(params);
}

/** 일시 열 필터의 KST 날짜 경계 (기존 폼의 from·to 해석 그대로): ≥ 그날 00:00 KST, ≤ = 다음날 00:00 KST 미만 */
function createdAtRange(op: 'gte' | 'lte', value: string): SQL {
  return op === 'gte'
    ? sql`${auditLogs.createdAt} >= (${value}::date::timestamp at time zone ${AUDIT_TIMEZONE})`
    : sql`${auditLogs.createdAt} < ((${value}::date + 1)::timestamp at time zone ${AUDIT_TIMEZONE})`;
}

/** 기본 정렬 (최신순) — 정렬을 고르면 tie-breaker 로 그대로 뒤에 붙는다(stable, 끝은 id) */
const DEFAULT_ORDER: SQL[] = [desc(auditLogs.createdAt), desc(auditLogs.id)];

/** '대상' 열 표시값 = formatAuditTarget (src/lib/audit-format.ts) 의 SQL 판 — 화면에 보이는 문자열 순으로 정렬한다 */
const TARGET_DISPLAY = sql<string>`case
  when nullif(${auditLogs.targetType}, '') is null then coalesce(${auditLogs.targetLabel}, ${auditLogs.targetId}, '')
  else ${auditLogs.targetType} || coalesce(' · ' || nullif(coalesce(${auditLogs.targetLabel}, ${auditLogs.targetId}), ''), '')
end`;

/** 'IP' 열 표시값: inet 출력 형식(호스트 주소는 /32·/128 생략) = host() */
const IP_DISPLAY = sql<string>`host(${auditLogs.ip})`;

/** 감사 결과 정렬 서수: 성공 → 거부 → 오류 (STATUS_ORDERS.auditResult 라벨의 저장값) */
const AUDIT_RESULT_ORDER = [
  'success',
  'denied',
  'error',
] as const satisfies readonly AuditLog['result'][];

/** 감사 표 정렬 id → ORDER BY 키 (#32 스펙 §2·§3). 화이트리스트 AUDIT_SORT_IDS 와 1:1 */
export const AUDIT_SORT_SQL: Record<AuditSortId, (dir: SortDir) => SQL[]> = {
  createdAt: (dir) => [byValue(auditLogs.createdAt, dir)],
  actor: (dir) => byText(auditLogs.actorLabel, dir),
  action: (dir) => byText(auditLogs.action, dir),
  target: (dir) => byText(TARGET_DISPLAY, dir),
  ip: (dir) => byText(IP_DISPLAY, dir),
  result: (dir) => byStatus(auditLogs.result, AUDIT_RESULT_ORDER, dir),
};

/**
 * 감사 표 열 필터 id → 열 식 (표 열 필터 스펙 §2.3). 정렬 맵(AUDIT_SORT_SQL)과 같은 식.
 * 행위 선택지(데이터)는 SQL 에서 검증하지 않는다 — 바인딩된 값이 행위와 같은 행만 남는다(모르는 값 = 결과 없음, 옛 `?action=X` 와 같음).
 */
export const AUDIT_FILTER_SQL: Record<AuditFilterId, AnyColumn | SQL> = {
  createdAt: auditLogs.createdAt,
  actor: auditLogs.actorLabel,
  action: auditLogs.action,
  target: TARGET_DISPLAY,
  ip: IP_DISPLAY,
  result: auditLogs.result,
};

const AUDIT_FILTER_SPEC = buildFilterSpec(auditFilterDefs([]), AUDIT_FILTER_SQL, {
  ranges: { createdAt: createdAtRange },
});

/** 화면 count·rows 와 CSV 가 같은 WHERE 를 쓴다 (§2.3-3) */
function buildWhere(filter: AuditFilter): SQL | undefined {
  const conditions = filterSqlConditions(auditConditions(filter), AUDIT_FILTER_SPEC);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderBy(filter: AuditFilter): SQL[] {
  return buildOrderBy(filter.sort, AUDIT_SORT_SQL, DEFAULT_ORDER);
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
    .orderBy(...orderBy(filter))
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

/** CSV 내보내기: 열 구성·순서는 고정(toAuditCsv), 행 순서만 화면 정렬을 따른다 (#32 스펙 §3) */
export async function getAuditLogsForExport(db: Db, filter: AuditFilter): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(buildWhere(filter))
    .orderBy(...orderBy(filter))
    .limit(AUDIT_EXPORT_LIMIT);
}
