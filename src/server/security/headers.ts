/**
 * 보안 헤더 (§4.8, AC-91). 순수 모듈 — proxy.ts(요청별 CSP nonce)와 next.config.ts(정적 헤더)가 함께 쓴다.
 * - CSP: script 는 요청별 nonce + 'strict-dynamic' (Next 가 자기 인라인 스크립트에 nonce 를 붙인다). 인라인 이벤트·eval 금지
 *   (개발 모드만 React 디버깅용 'unsafe-eval'). style 은 React style 속성 때문에 'unsafe-inline' 이 필요하다 — nonce 를 넣으면
 *   'unsafe-inline' 이 무시되므로 style-src 에는 nonce 를 쓰지 않는다. Pretendard 는 셀프 호스트(next/font/local)라 외부 폰트 출처가 없다.
 * - form-action: Google 로그인은 Server Action → accounts.google.com 리다이렉트라 허용 목록에 둔다(Chrome 은 리다이렉트에도 적용).
 * - frame-ancestors 'none' + X-Frame-Options DENY: 공유 페이지·PDF 포함 전체 iframe 삽입 금지 (PR-8 QA INFO-4).
 */
export const GOOGLE_ACCOUNTS_ORIGIN = 'https://accounts.google.com';

export type CspOptions = {
  nonce: string;
  isDev: boolean;
  /** 공개 URL 이 https 이면 upgrade-insecure-requests (로컬 http 에서는 넣지 않는다) */
  isHttps: boolean;
};

export function buildCsp({ nonce, isDev, isHttps }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // 개발 모드 HMR 은 웹소켓을 쓴다
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${GOOGLE_ACCOUNTS_ORIGIN}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (isHttps) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** 모든 응답(정적 자원 포함)에 붙는 헤더 — next.config.ts headers() */
export const STATIC_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** 요청별 nonce (base64, 128비트) */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** 들어온 x-request-id 가 안전한 형식이면 이어 쓰고, 아니면 새로 만든다 (로그 주입 방지) */
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
}
