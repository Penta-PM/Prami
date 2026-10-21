import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDb } from '@/db';
import type { PageKey } from '@/lib/page-state/keys';
import type { SessionUser } from '@/server/auth/session-user';

import type { Params } from './normalize';
import { resolveViewRestore } from './restore';

/** 화면 트래커(ViewStateTracker) props */
export type ViewStateProps = {
  pageKey: PageKey;
  savedQuery: string | null;
  restoreTop: number | null;
};

/**
 * 화면 RSC 진입 시 조회 상태 복원 (page-state-memory §2.2-4). 권한 확인(requirePagePermission) **뒤**, 데이터 조회 **앞**에서 부른다 —
 * 복원 대상이면 여기서 redirect(path?query) 하므로 첫 응답이 복원 상태다(깜빡임·이중 데이터 조회 없음).
 * user 는 세션 사용자(requirePagePermission 결과)만 넘긴다 — 다른 사용자 행은 읽지 않는다(§2.7-2).
 */
export async function restoreViewState(
  pageKey: PageKey,
  params: Params,
  user: Pick<SessionUser, 'id' | 'role'>,
): Promise<ViewStateProps> {
  const result = await resolveViewRestore({
    db: await getDb(),
    userId: user.id,
    actor: { role: user.role },
    pageKey,
    params,
    referer: (await headers()).get('referer'),
  });
  if (result.redirectTo) redirect(result.redirectTo);
  return { pageKey, savedQuery: result.savedQuery, restoreTop: result.restoreTop };
}
