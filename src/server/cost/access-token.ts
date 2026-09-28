/**
 * 원가 접근 토큰 (§4.5.5 "server/cost 는 ADMIN 검사를 첫 줄에서"). 순수 모듈 — Next·세션에 의존하지 않아
 * 스크립트·테스트에서도 쓸 수 있다. 앱 코드는 토큰을 access.ts 의 requireCostAccess/requireCostPageAccess 로만 얻는다.
 * server/cost 의 모든 조회·변경 함수는 이 토큰을 첫 인자로 요구하므로 권한 검사를 건너뛴 호출은 타입에서 막힌다.
 */
declare const COST_ACCESS: unique symbol;

export type CostScope = 'read' | 'write';

export type CostAccess = {
  readonly [COST_ACCESS]: true;
  /** 감사 actor. 스크립트(세션 없음)는 null */
  readonly userId: string | null;
  readonly email: string;
  readonly scope: CostScope;
};

export const AUDIT_COST_READ = 'cost.read';
export const AUDIT_COST_WRITE = 'cost.write';

export function grantCostAccess(
  user: { id: string | null; email: string },
  scope: CostScope,
): CostAccess {
  return { userId: user.id, email: user.email, scope } as CostAccess;
}

/** 테스트·스크립트 전용 별칭 (앱 코드에서 쓰지 않는다) */
export const costAccessForTests = (
  user: { id: string | null; email: string },
  scope: CostScope = 'write',
) => grantCostAccess(user, scope);

export function assertCostAccess(access: CostAccess | null | undefined, scope: CostScope): void {
  if (!access) throw new Error('원가 접근 토큰이 없습니다 (requireCostAccess 를 거쳐야 합니다)');
  if (scope === 'write' && access.scope !== 'write') {
    throw new Error('원가 변경에는 write 범위 토큰이 필요합니다');
  }
}
