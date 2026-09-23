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

/**
 * 권한 거부를 감사 로그(result=denied)에 남긴다. action 은 시도한 행위의 감사 키(§4.7.1 ③ — 예 policy.apply),
 * 페이지 접근처럼 행위 키가 없으면 auth.access_denied.
 */
export async function recordAccessDenied(
  user: SessionUser,
  permission: PermissionKey,
  target: string,
  action: string = AUDIT_ACTIONS.accessDenied,
): Promise<void> {
  await writeAudit(await getDb(), {
    actor: { id: user.id, label: user.email },
    action,
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

/** 보호 대상 경계: 필요한 권한, 거부 시 감사 행위 키, 감사 대상 표시 */
export type Guard = { permission: PermissionKey; auditAction: string; target: string };

/** Action/Route 용: 권한이 없으면 AppError 를 던진다 (경계 래퍼가 봉투로 변환) */
export async function requirePermission(guard: Guard): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHENTICATED', '로그인이 필요합니다');
  if (!hasPermission(user.role, guard.permission)) {
    await recordAccessDenied(user, guard.permission, guard.target, guard.auditAction);
    throw new AppError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다');
  }
  return user;
}

/** 예외를 봉투 오류로 바꾼다. 알 수 없는 예외는 내부 정보 없이 INTERNAL 로 감싼다 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof AppError) {
    const base = fail(error.code, error.message, error.fieldErrors).error;
    return error.details ? { ...base, details: error.details } : base;
  }
  if (error instanceof ZodError) {
    const flat = z.flattenError(error);
    return fail('VALIDATION', '입력값을 확인하세요', flat.fieldErrors as Record<string, string[]>)
      .error;
  }
  console.error('[action] 처리 중 오류', error);
  return fail('INTERNAL', '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요').error;
}

/**
 * Server Action 경계: 권한 검사 → 실행 → 봉투 반환.
 * 거부(§4.7.1): {ok:false, error.code:'FORBIDDEN'} + 감사 denied 1행(action=auditAction) + fn 미실행(부수효과 없음)
 */
export async function runAction<T>(
  guard: { permission: PermissionKey; auditAction: string; name: string },
  fn: (user: SessionUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requirePermission({ ...guard, target: `action:${guard.name}` });
    return ok(await fn(user));
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Route Handler 경계: 오류를 봉투 JSON + HTTP 상태로 응답한다 (거부 = HTTP 403, §4.7.1) */
export async function runRoute(
  guard: Guard,
  fn: (user: SessionUser) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await requirePermission(guard);
    return await fn(user);
  } catch (error) {
    const body = { ok: false as const, error: toActionError(error) };
    return Response.json(body, { status: ERROR_STATUS[body.error.code] });
  }
}
