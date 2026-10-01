import type { CredentialRow } from './repository';

/**
 * 자격 증명 만료 판정 (PRAMI-003 §4.4.3, AC-346). `expires_at` 이 NULL 이면 비만료, 지금 이후면 정상, 지났으면 만료.
 * 만료는 DB 상태를 바꾸지 않고 조회 시점에 판정한다(재연결하면 새 행이 생겨 자연히 해소).
 */
export function isCredentialExpired(
  row: Pick<CredentialRow, 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  return row.expiresAt !== null && row.expiresAt.getTime() <= now;
}

/** 만료 시 검증·감사에 남기는 정규화 코드 */
export const EXPIRED_ERROR_CODE = 'expired' as const;
