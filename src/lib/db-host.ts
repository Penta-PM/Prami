/**
 * DB 연결 문자열의 호스트 판정 (PRAMI-003 §4.3.3 ⓔ·§4.3.4). 값(비밀번호 등)은 다루지 않고 호스트 이름만 본다.
 * - 로컬 호스트: seed·fixtures·import:source 가 "원격이 아님" 으로 보는 목록 (docker compose 서비스 이름 포함)
 * - 사설 호스트: 로컬 + RFC1918·링크 로컬·IPv6 ULA — 운영 기동 검사가 거부한다
 */
export const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'] as const;

/**
 * 연결 호스트를 바꾸는 쿼리 파라미터 (libpq: host·hostaddr·service(pg_service.conf)·servicefile).
 * node-postgres(pg-connection-string)·Neon Pool 은 `?host=` 를 URL 호스트보다 우선한다 (PRAMI-003 PR-2 QA M-1).
 */
const HOST_OVERRIDE_PARAMS = new Set(['host', 'hostaddr', 'service', 'servicefile']);

/** 정규 표기가 아닌 숫자형 IPv4(`127.1`·`0x7f.0.0.1`·`2130706433`) — 리졸버가 루프백·사설로 해석할 수 있다 */
const NUMERIC_HOST = /^(0x[0-9a-f]*|\d+)(\.(0x[0-9a-f]*|\d+)){0,3}$/i;
const CANONICAL_IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * 연결 문자열 → 실제 연결 호스트(소문자, IPv6 괄호 제거). **판정할 수 없으면 null** — 호출부는 null 을 원격으로 다룬다(fail-closed).
 * null 인 경우: URL 이 아님(key=value 형식·`/소켓` 경로 포함), postgres(ql) 스킴이 아님, URL 호스트 없음(드라이버가 PGHOST·소켓으로 대체),
 * 호스트 재정의 쿼리(`?host=`·`?hostaddr=`·`?service=` …, 대소문자 무시), 퍼센트 인코딩 호스트(`%2Fvar%2Frun` 소켓 경로 등),
 * 다중 호스트(`h1,h2`), 정규 표기가 아닌 숫자형 IPv4, Neon 드라이버 해석과 다른 호스트(역슬래시 등 — neonHostOf).
 */
export function dbHostOf(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  const trimmed = databaseUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  for (const key of url.searchParams.keys()) {
    if (HOST_OVERRIDE_PARAMS.has(key.trim().toLowerCase())) return null;
  }
  const host = normalizeHost(url.hostname);
  if (!host || /[%,/\\\s]/.test(host) || host.endsWith('.')) return null;
  if (NUMERIC_HOST.test(host) && !CANONICAL_IPV4.test(host)) return null;
  if (neonHostOf(trimmed, url.protocol) !== host) return null;
  return host;
}

/** 소문자·IPv6 괄호 제거. 끝의 점 하나는 DNS 루트(FQDN) 표기 — `localhost.`·`10.0.0.5.` 도 같은 주소로 연결되므로 떼고 판정한다 */
function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

/**
 * `@neondatabase/serverless` 가 보는 호스트 — neon() HTTP·Pool 모두 드라이버의 url 파서가 스킴을 `http:` 로 바꿔 다시 파싱한다.
 * 특수 스킴 파싱은 `\` 를 `/` 처럼 authority 끝으로 보고 퍼센트 인코딩·IDN 을 풀어, `postgres:` 비특수 파싱과 호스트가 갈릴 수 있다
 * (`localhost\@ep-….neon.tech` → Neon 은 localhost 로 연결, PR-2b QA L-N1). 파싱 실패는 null(호출부에서 불일치 → 판정 불가).
 */
function neonHostOf(databaseUrl: string, protocol: string): string | null {
  try {
    return normalizeHost(new URL('http:' + databaseUrl.slice(protocol.length)).hostname);
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

/** IPv4 매핑 IPv6(`::ffff:7f00:1` — URL 파서가 `::ffff:127.0.0.1` 을 이렇게 정규화한다) → IPv4 */
function ipv4FromMapped(host: string): string | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!match) return null;
  const [high, low] = [parseInt(match[1]!, 16), parseInt(match[2]!, 16)];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/** 로컬 목록 또는 사설·루프백·링크 로컬·미지정(`::`) 주소 */
export function isPrivateDbHost(host: string | null): boolean {
  if (host === null) return false;
  if (isLocalDbHost(host)) return true;
  if (host === '::') return true;
  const mappedIpv4 = ipv4FromMapped(host);
  if (mappedIpv4) return isPrivateDbHost(mappedIpv4);
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
