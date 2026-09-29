/** 로그인 후 이동 경로. 외부 URL·프로토콜 상대 경로(//)·로그인 페이지 자체는 허용하지 않는다 (오픈 리다이렉트 방지) */
export function safeCallbackUrl(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/api/auth'))
    return '/';
  return value;
}

/** /login?error=<code> 를 사용자 문구로 바꾼다 */
export function loginErrorMessage(code: string | undefined, allowedDomains: readonly string[]) {
  if (!code) return null;
  const domains = allowedDomains.map((domain) => `@${domain}`).join(', ');
  switch (code) {
    case 'domain':
      return `허용된 회사 도메인(${domains})의 인증된 Google 계정만 로그인할 수 있습니다.`;
    case 'inactive':
      return '비활성화된 계정입니다. 관리자에게 문의하세요.';
    case 'unregistered':
      return '등록되지 않은 사용자입니다. 관리자에게 사전 등록을 요청하세요.';
    case 'credentials':
      return '이메일 또는 테스트 비밀번호가 올바르지 않습니다.';
    case 'test_mode_host':
      return '테스트 로그인은 허용된 호스트(AUTH_TEST_ALLOWED_HOSTS)에서만 쓸 수 있습니다.';
    case 'rate_limited':
      return '로그인 시도가 너무 잦습니다. 1분 뒤 다시 시도하세요.';
    default:
      return '로그인하지 못했습니다. 잠시 후 다시 시도하세요.';
  }
}
