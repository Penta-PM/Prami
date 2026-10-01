/**
 * 시연(fixture) 계정 표식 (PRAMI-003 §4.9.3). `pnpm seed` 가 만드는 계정은 이메일 로컬 부분이 이 접두로 시작한다.
 * 운영·preview 에서는 로그인 거부(L3)·기동 검사(L4)·`data:verify --fresh` 가 이 접두로 찾는다.
 */
export const FIXTURE_EMAIL_PREFIX = 'fixture-';

/** SQL LIKE 패턴 (`users.email` 은 citext) */
export const FIXTURE_EMAIL_LIKE = `${FIXTURE_EMAIL_PREFIX}%`;

export function isFixtureEmail(email: string): boolean {
  return email.trim().toLowerCase().startsWith(FIXTURE_EMAIL_PREFIX);
}
