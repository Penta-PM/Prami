import 'server-only';

import { eq } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { users, type User } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AUDIT_ACTIONS, writeAudit, type RequestMeta } from '@/server/audit/log';

/**
 * 로그인 판정 (§4.6.1). Google·테스트 Credentials 두 provider 가 같은 규칙을 쓴다.
 * 판정·사용자 생성/갱신·감사 로그를 한 트랜잭션에서 처리한다. Auth.js 에 의존하지 않아 단위 테스트가 가능하다.
 */
export type SignInPolicy = {
  allowedDomains: readonly string[];
  adminEmails: readonly string[];
  autoProvision: boolean;
};

export type SignInInput = {
  email: string;
  /** Google profile.email_verified. 테스트 Credentials 는 true 로 간주 */
  emailVerified: boolean;
  name?: string | null;
  googleSub?: string | null;
  avatarUrl?: string | null;
  meta: RequestMeta;
};

export type SignInDenyReason = 'domain' | 'inactive' | 'unregistered';

export type SignInOutcome =
  { ok: true; user: User; created: boolean } | { ok: false; reason: SignInDenyReason };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : normalizeEmail(email.slice(at + 1));
}

export function isAllowedDomain(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  return domain !== '' && allowedDomains.some((allowed) => normalizeEmail(allowed) === domain);
}

export function isBootstrapAdmin(email: string, adminEmails: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  return adminEmails.some((candidate) => normalizeEmail(candidate) === normalized);
}

/** 이메일 로컬파트를 이름 대용으로 쓴다 (Google 프로필 이름이 없을 때) */
function fallbackName(email: string): string {
  return email.slice(0, email.indexOf('@')) || email;
}

type Ctx = { tx: Tx; input: SignInInput; email: string; policy: SignInPolicy };

async function deny(ctx: Ctx, reason: SignInDenyReason, user?: User): Promise<SignInOutcome> {
  const action = {
    domain: AUDIT_ACTIONS.deniedDomain,
    inactive: AUDIT_ACTIONS.deniedInactive,
    unregistered: AUDIT_ACTIONS.deniedUnregistered,
  }[reason];
  await writeAudit(ctx.tx, {
    actor: { id: user?.id ?? null, label: ctx.email },
    action,
    target: { type: 'user', id: user?.id ?? null, label: ctx.email },
    after: reason === 'domain' ? { emailVerified: ctx.input.emailVerified } : null,
    result: 'denied',
    meta: ctx.input.meta,
  });
  return { ok: false, reason };
}

async function createUser(ctx: Ctx, role: User['role']): Promise<User> {
  const isAdmin = role === 'ADMIN';
  const created = firstRow(
    await ctx.tx
      .insert(users)
      .values({
        email: ctx.email,
        name: ctx.input.name?.trim() || fallbackName(ctx.email),
        role,
        status: 'active',
        googleSub: ctx.input.googleSub ?? null,
        avatarUrl: ctx.input.avatarUrl ?? null,
        lastLoginAt: new Date(),
        createdVia: isAdmin ? 'bootstrap' : 'auto',
      })
      .returning(),
    'users insert',
  );
  await writeAudit(ctx.tx, {
    actor: { id: created.id, label: ctx.email },
    action: isAdmin ? AUDIT_ACTIONS.bootstrapAdmin : AUDIT_ACTIONS.autoProvisioned,
    target: { type: 'user', id: created.id, label: ctx.email },
    after: { role: created.role, createdVia: created.createdVia },
    meta: ctx.input.meta,
  });
  return created;
}

/**
 * 기존 사용자 로그인: 프로필(이름·google_sub·아바타)과 마지막 로그인을 갱신한다.
 * ADMIN_EMAILS 승격은 최초 로그인(last_login_at 이 비어 있음)에만 적용 — 이후 역할 변경은 관리 화면에서만.
 */
async function updateOnLogin(ctx: Ctx, user: User): Promise<User> {
  const promote =
    user.lastLoginAt === null &&
    user.role !== 'ADMIN' &&
    isBootstrapAdmin(ctx.email, ctx.policy.adminEmails);
  const updated = firstRow(
    await ctx.tx
      .update(users)
      .set({
        name: ctx.input.name?.trim() || user.name,
        googleSub: ctx.input.googleSub ?? user.googleSub,
        avatarUrl: ctx.input.avatarUrl ?? user.avatarUrl,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        ...(promote ? { role: 'ADMIN' as const } : {}),
      })
      .where(eq(users.id, user.id))
      .returning(),
    'users update',
  );
  if (promote) {
    await writeAudit(ctx.tx, {
      actor: { id: user.id, label: ctx.email },
      action: AUDIT_ACTIONS.bootstrapAdmin,
      target: { type: 'user', id: user.id, label: ctx.email },
      before: { role: user.role },
      after: { role: 'ADMIN' },
      meta: ctx.input.meta,
    });
  }
  return updated;
}

async function decide(ctx: Ctx): Promise<SignInOutcome> {
  if (!ctx.input.emailVerified || !isAllowedDomain(ctx.email, ctx.policy.allowedDomains)) {
    return deny(ctx, 'domain');
  }
  const [existing] = await ctx.tx.select().from(users).where(eq(users.email, ctx.email)).limit(1);
  let user: User;
  let created = false;
  if (existing) {
    if (existing.status === 'inactive') return deny(ctx, 'inactive', existing);
    user = await updateOnLogin(ctx, existing);
  } else if (isBootstrapAdmin(ctx.email, ctx.policy.adminEmails)) {
    user = await createUser(ctx, 'ADMIN');
    created = true;
  } else if (ctx.policy.autoProvision) {
    user = await createUser(ctx, 'USER');
    created = true;
  } else {
    return deny(ctx, 'unregistered');
  }
  await writeAudit(ctx.tx, {
    actor: { id: user.id, label: ctx.email },
    action: AUDIT_ACTIONS.login,
    target: { type: 'user', id: user.id, label: ctx.email },
    meta: ctx.input.meta,
  });
  return { ok: true, user, created };
}

export async function resolveSignIn(
  handle: DbHandle,
  input: SignInInput,
  policy: SignInPolicy,
): Promise<SignInOutcome> {
  const email = normalizeEmail(input.email);
  return withTransaction((tx) => decide({ tx, input, email, policy }), handle);
}
