/**
 * 조달 접근 토큰 (조달이 통합 DB-2, 원가 access-token 패턴). 순수 모듈 — Next·세션에 의존하지 않아 스크립트·테스트에서도 쓴다.
 * 앱 코드는 토큰을 access.ts 의 requireProcurementAccess / requireProcurementPageAccess 로만 얻는다.
 * server/procurement 의 모든 조회 함수는 이 토큰을 첫 인자로 요구하므로 권한 검사를 건너뛴 호출은 타입에서 막힌다.
 * 범위: read = `procurement.read`(USER·ADMIN), write = `procurement.write`(ADMIN) — D-1. write 토큰은 조회도 할 수 있다.
 */
declare const PROCUREMENT_ACCESS: unique symbol;

export type ProcurementScope = 'read' | 'write';

export type ProcurementAccess = {
  readonly [PROCUREMENT_ACCESS]: true;
  /** 감사 actor. 스크립트(세션 없음)는 null */
  readonly userId: string | null;
  /** 조달 이력 표 changed_by (D-8) */
  readonly email: string;
  readonly scope: ProcurementScope;
};

/** 거부 감사 행위 키 (권한 키와 같은 이름 — 원가 cost.read/cost.write 와 같은 규칙) */
export const AUDIT_PROCUREMENT_READ = 'procurement.read';
export const AUDIT_PROCUREMENT_WRITE = 'procurement.write';

export function grantProcurementAccess(
  user: { id: string | null; email: string },
  scope: ProcurementScope,
): ProcurementAccess {
  return { userId: user.id, email: user.email, scope } as ProcurementAccess;
}

/** 테스트·스크립트 전용 별칭 (앱 코드에서 쓰지 않는다) */
export const procurementAccessForTests = (
  user: { id: string | null; email: string } = { id: null, email: 'vitest' },
  scope: ProcurementScope = 'read',
) => grantProcurementAccess(user, scope);

export function assertProcurementAccess(
  access: ProcurementAccess | null | undefined,
  scope: ProcurementScope,
): void {
  if (!access) {
    throw new Error('조달 접근 토큰이 없습니다 (requireProcurementAccess 를 거쳐야 합니다)');
  }
  if (scope === 'write' && access.scope !== 'write') {
    throw new Error('조달 변경에는 write 범위 토큰이 필요합니다');
  }
}
