import { getDb } from '@/db';
import { toAuditCsv } from '@/lib/audit-format';
import { getAuditLogsForExport, parseAuditFilter } from '@/server/audit/queries';
import { runRoute } from '@/server/auth/rbac';

/** 감사 로그 CSV 내보내기 (§4.7, audit.read). 화면과 같은 필터를 쿼리스트링으로 받는다 */
export async function GET(request: Request): Promise<Response> {
  const guard = {
    permission: 'audit.read',
    auditAction: 'audit.export',
    target: '/api/audit/export.csv',
  } as const;
  return runRoute(guard, async () => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const rows = await getAuditLogsForExport(await getDb(), parseAuditFilter(params));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toAuditCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-logs-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
