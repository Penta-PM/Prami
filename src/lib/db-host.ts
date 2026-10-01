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
