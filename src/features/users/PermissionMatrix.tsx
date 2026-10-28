import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { PERMISSION_GROUPS, ROLES, groupAllowed } from '@/lib/constants/permissions';

/** 권한 매트릭스 (§4.5.10). PERMISSIONS 상수를 그대로 렌더한다 — 서버 검사와 같은 원천 */
export function PermissionMatrix() {
  return (
    <div className="mt-8">
      <h2 className="m-0 mb-1.5 [font:var(--text-h2)]">권한 (RBAC)</h2>
      <p className="m-0 mb-4 text-[12px] text-text-tertiary">
        향후 역할을 추가할 수 있는 구조입니다. 서버/API 레벨에서도 동일한 권한을 검증합니다.
      </p>
      <div className="overflow-hidden rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="역할별 권한">
          <TableHead className="bg-surface-muted">
            <tr>
              <TableHeaderCell className="px-5 py-3.5">권한 항목</TableHeaderCell>
              {ROLES.map((role) => (
                <TableHeaderCell key={role} className="py-3.5 text-center">
                  {role}
                </TableHeaderCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {PERMISSION_GROUPS.map((group) => (
              <TableRow key={group.label}>
                <TableCell className="px-5 font-medium">{group.label}</TableCell>
                {ROLES.map((role) => {
                  const allowed = groupAllowed(role, group);
                  return (
                    <TableCell key={role} className="text-center">
                      <span aria-label={allowed ? '허용' : '불가'}>{allowed ? '✓' : '—'}</span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            <tr>
              <td
                colSpan={ROLES.length + 1}
                className="px-5 py-3.5 text-[12px] font-semibold text-text-tertiary"
              >
                + 역할 추가 (향후 확장 — 현재는 USER·ADMIN 두 역할만 지원합니다)
              </td>
            </tr>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
