/**
 * DB 연결 문자열의 호스트 판정 (PRAMI-003 §4.3.3 ⓔ·§4.3.4). 값(비밀번호 등)은 다루지 않고 호스트 이름만 본다.
 * - 로컬 호스트: seed·fixtures·import:source 가 "원격이 아님" 으로 보는 목록 (docker compose 서비스 이름 포함)
 * - 사설 호스트: 로컬 + RFC1918·링크 로컬·IPv6 ULA — 운영 기동 검사가 거부한다
 */
export const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'] as const;

/** 연결 문자열 → 호스트(소문자, IPv6 괄호 제거). 형식이 아니면 null */
export function dbHostOf(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return host.replace(/^\[(.*)\]$/, '$1') || null;
  } catch {
    return null;
  }
}

export function isLocalDbHost(host: string | null): boolean {
  return host !== null && (LOCAL_DB_HOSTS as readonly string[]).includes(host);
}

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
];

/** 로컬 목록 또는 사설·루프백·링크 로컬 주소 */
export function isPrivateDbHost(host: string | null): boolean {
  if (host === null) return false;
  if (isLocalDbHost(host)) return true;
  if (PRIVATE_IPV4.some((pattern) => pattern.test(host))) return true;
  return /^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
}

/** 스크립트 대상이 원격 DB 인지 (neon 이거나 로컬 목록 밖 호스트). pglite 는 인프로세스라 로컬 */
export function isRemoteDbTarget(source: Record<string, string | undefined>): boolean {
  const driver = (source.DB_DRIVER ?? '').trim() || 'pglite';
  if (driver === 'neon') return true;
  if (driver === 'pglite') return false;
  return !isLocalDbHost(dbHostOf(source.DATABASE_URL));
}

export type TargetHostViolation = 'missing' | 'mismatch';

/**
 * 원격 대상 스크립트 확인 (PRAMI-003 §4.3.4 ②): `--target-host <호스트>` 가 실제 연결 호스트와 같아야 한다
 * (오타·다른 셸 env 로 엉뚱한 DB 에 쓰는 사고 방지). 로컬 대상이면 검사하지 않는다.
 */
export function targetHostViolation(
  source: Record<string, string | undefined>,
  targetHost: string | undefined,
): TargetHostViolation | null {
  if (!isRemoteDbTarget(source)) return null;
  if (!targetHost?.trim()) return 'missing';
  return targetHost.trim().toLowerCase() === dbHostOf(source.DATABASE_URL) ? null : 'mismatch';
}

export const TARGET_HOST_MESSAGES: Record<TargetHostViolation, string> = {
  missing: '원격 DB 대상입니다 — --target-host <연결 호스트> 를 지정해야 실행합니다',
  mismatch: '--target-host 가 실제 연결 호스트와 다릅니다 — 대상 DB 를 다시 확인하세요',
};
