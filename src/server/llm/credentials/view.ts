import { findVendor } from '../vendors/registry';
import { isCredentialExpired } from './expiry';
import type { KeyProvider } from './keyring';
import type { CredentialRow } from './repository';

/**
 * 클라이언트로 나가는 자격 증명 DTO (PRAMI-002 §4.7.3 T-5, AC-204). 벤더·방식·힌트·상태·시각만.
 * 암호문·DEK·평문 필드는 타입에도 없다 — 스냅샷 테스트가 키 목록을 고정한다.
 */
export type CredentialDisplayStatus =
  | CredentialRow['status']
  /** 복호화 불가(KEK 버전 없음·무결성 실패) → 재등록 필요 (§4.10) */
  | 'unreadable'
  /** 레지스트리에서 빠진 벤더 → 삭제만 가능 (§4.5.1) */
  | 'unsupported'
  /** expires_at 이 지남 → 재연결 필요 (PRAMI-003 §4.4.3, AC-346) */
  | 'expired';

export type CredentialView = {
  vendor: string;
  vendorLabel: string;
  authType: 'api_key' | 'oauth_pkce';
  keyHint: string;
  status: CredentialDisplayStatus;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  lastUsedAt: string | null;
  /** 이 키로 쓸 수 있는 모델 ID (목록 ∩ 상수). null = 미확인 → 상수 전체 허용 (r2 §4.5.2) */
  availableModels: string[] | null;
  createdAt: string;
};

export function displayStatus(
  row: Pick<CredentialRow, 'vendor' | 'status' | 'kekVersion' | 'expiresAt'>,
  keys: KeyProvider | null,
  unreadable = false,
): CredentialDisplayStatus {
  if (!findVendor(row.vendor)) return 'unsupported';
  if (unreadable || !keys || !keys.kek(row.kekVersion)) return 'unreadable';
  if (isCredentialExpired(row)) return 'expired';
  return row.status;
}

export function toCredentialView(
  row: CredentialRow,
  keys: KeyProvider | null,
  unreadable = false,
): CredentialView {
  return {
    vendor: row.vendor,
    vendorLabel: findVendor(row.vendor)?.label ?? row.vendor,
    authType: row.authType,
    keyHint: row.keyHint,
    status: displayStatus(row, keys, unreadable),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    availableModels: row.availableModels ? [...row.availableModels] : null,
    createdAt: row.createdAt.toISOString(),
  };
}
