import 'server-only';

import { createHash } from 'node:crypto';

import { lt } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { oauthFlowStates } from '@/db/schema';

import { OAuthFlowError } from './openrouter';

/**
 * OAuth 콜백 state 1회 소비 (PRAMI-002 §4.6.2, PR-C QA L-2 — Main 결정 A). 콜백 검증(쿠키·state·세션 사용자) 직후,
 * **코드 교환 전에** 호출한다. 교환이 실패해도 소비는 유지된다(같은 state 로 다시 교환 불가).
 * - 저장은 SHA-256(state) 만 — 원문·코드·verifier 는 저장하지 않는다. 기본 키 (user_id, state_hash)
 * - `ON CONFLICT DO NOTHING RETURNING` 으로 원자적 — 동시에 두 콜백이 와도 하나만 통과(서버리스 다중 인스턴스)
 * - 만료(쿠키 exp)가 지난 행은 호출 때마다 기회적으로 지운다(테이블 무한 증가 방지)
 */
export function stateHash(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

export async function consumeOAuthState(
  handle: Pick<DbHandle, 'db'>,
  input: { userId: string; vendor: string; state: string; expiresAt: number; now?: number },
): Promise<void> {
  const now = new Date(input.now ?? Date.now());
  await handle.db.delete(oauthFlowStates).where(lt(oauthFlowStates.expiresAt, now));
  const inserted = await handle.db
    .insert(oauthFlowStates)
    .values({
      userId: input.userId,
      stateHash: stateHash(input.state),
      vendor: input.vendor,
      consumedAt: now,
      expiresAt: new Date(input.expiresAt),
    })
    .onConflictDoNothing()
    .returning({ stateHash: oauthFlowStates.stateHash });
  if (inserted.length === 0) throw new OAuthFlowError('reused');
}
