import type { DefaultSession } from 'next-auth';

import type { Role } from '@/lib/constants/permissions';

/** 세션·JWT 확장 (§4.6.1: 토큰에 userId, role 포함) */
declare module 'next-auth' {
  interface Session {
    user: { id: string; role: Role } & DefaultSession['user'];
  }
}
