import 'server-only';

import { redirect } from 'next/navigation';
import { ZodError, z } from 'zod';

import { getDb } from '@/db';
import { canAccessAdminArea, hasPermission, type PermissionKey } from '@/lib/constants/permissions';
import {
  AppError,
  ERROR_STATUS,
  fail,
  ok,
  type ActionError,
  type ActionResult,
} from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit } from '@/server/audit/log';
import { currentRequestMeta } from '@/server/audit/request-meta';

import { auth } from './auth';
import { loadSessionUser, type SessionUser } from './session-user';

/**
 * 2차 방어 (§4.6): 모든 Server Action·Route Handler·관리 페이지가 여기서 권한을 다시 검사한다.
 * proxy 는 1차 방어일 뿐이고, 클라이언트의 관리자 메뉴 표시는 보안 경계가 아니다.
 */

/** 현재 요청의 활성 사용자 (JWT → DB 60초 캐시). 비로그인·비활성이면 null */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return loadSessionUser(await getDb(), userId);
}

/** 권한 거부를 감사 로그(result=denied)에 남긴다 */
export async function recordAccessDenied(
  user: SessionUser,
  permission: PermissionKey,
  target: string,
): Promise<void> {
  await writeAudit(await getDb(), {
    actor: { id: user.id, label: user.email },
    action: AUDIT_ACTIONS.accessDenied,
    target: { type: 'route', id: target, label: target },
    after: { permission, role: user.role },
    result: 'denied',
    meta: await currentRequestMeta(),
  });
}

/** 페이지용: 비로그인 → /login, 권한 없음 → 감사 기록 후 / 로 이동 */
export async function requirePagePermission(
  permission: PermissionKey,
  path: string,
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  if (!hasPermission(user.role, permission)) {
    await recordAccessDenied(user, permission, path);
    redirect('/');
  }
  return user;
}

/** 관리자 영역 레이아웃용: ADMIN 이 아니면 감사 기록 후 / 로 이동 */
export async function requireAdminArea(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canAccessAdminArea(user.role)) {
    await recordAccessDenied(user, 'users.manage', '/admin');
    redirect('/');
  }
  return user;
}

/** Action/Route 용: 권한이 없으면 AppError 를 던진다 (경계 래퍼가 봉투로 변환) */
export async function requirePermission(
  permission: PermissionKey,
  target: string,
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHENTICATED', '로그인이 필요합니다');
  if (!hasPermission(user.role, permission)) {
    await recordAccessDenied(user, permission, target);
    throw new AppError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다');
  }
  return user;
}

/** 예외를 봉투 오류로 바꾼다. 알 수 없는 예외는 내부 정보 없이 INTERNAL 로 감싼다 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof AppError) {
    return fail(error.code, error.message, error.fieldErrors).error;
  }
  if (error instanceof ZodError) {
    const flat = z.flattenError(error);
    return fail('VALIDATION', '입력값을 확인하세요', flat.fieldErrors as Record<string, string[]>)
      .error;
  }
  console.error('[action] 처리 중 오류', error);
  return fail('INTERNAL', '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요').error;
}

/** Server Action 경계: 권한 검사 → 실행 → 봉투 반환 */
export async function runAction<T>(
  permission: PermissionKey,
  name: string,
  fn: (user: SessionUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requirePermission(permission, `action:${name}`);
    return ok(await fn(user));
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Route Handler 경계: 오류를 봉투 JSON + HTTP 상태로 응답한다 */
export async function runRoute(
  permission: PermissionKey,
  target: string,
  fn: (user: SessionUser) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await requirePermission(permission, target);
    return await fn(user);
  } catch (error) {
    const body = { ok: false as const, error: toActionError(error) };
    return Response.json(body, { status: ERROR_STATUS[body.error.code] });
  }
}
