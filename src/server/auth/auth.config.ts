import type { NextAuthConfig } from 'next-auth';

import { isRole } from '@/lib/constants/permissions';

/** 세션 만료 8시간 (§4.6.1 가정) */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * DB 에 의존하지 않는 Auth.js 공통 설정. proxy(1차 방어)는 이 설정으로 JWT 만 해석하고,
 * 전체 설정(auth.ts)이 provider·DB 콜백을 덧붙인다.
 * 쿠키는 Auth.js 기본값: HttpOnly, SameSite=Lax, HTTPS 에서 Secure(__Secure- 접두사).
 */
export const authConfig = {
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  // Vercel·로컬 모두 요청 Host 를 신뢰한다 (AUTH_URL 로 고정 가능)
  trustHost: true,
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (typeof token.userId === 'string' && isRole(token.role)) {
        session.user.id = token.userId;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
