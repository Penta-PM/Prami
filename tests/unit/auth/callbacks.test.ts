// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { users } from '@/db/schema';
import {
  emailDomain,
  isAllowedDomain,
  isBootstrapAdmin,
  resolveSignIn,
  type SignInInput,
  type SignInPolicy,
} from '@/server/auth/callbacks';

import { auditByAction, createTestDb, findUserByEmail, insertUser } from '../../helpers/pglite';

/** AC-06 인증 콜백 ①~⑤ + 사전 등록·부트스트랩 규칙 (§4.6.1) */
const POLICY: SignInPolicy = {
  allowedDomains: ['pentasecurity.com'],
  adminEmails: ['boss@pentasecurity.com'],
  autoProvision: true,
};
const META = { ip: '10.0.0.7', userAgent: 'vitest' };

const input = (email: string, extra: Partial<SignInInput> = {}): SignInInput => ({
  email,
  emailVerified: true,
  name: 'Google 이름',
  googleSub: `sub-${email}`,
  avatarUrl: 'https://example.com/a.png',
  meta: META,
  ...extra,
});

let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

let counter = 0;
const uniqueEmail = (local = 'user') => `${local}${++counter}@pentasecurity.com`;

describe('도메인 판정 순수 함수', () => {
  it('도메인·ADMIN_EMAILS 비교는 대소문자와 공백을 무시한다', () => {
    expect(emailDomain(' A@PentaSecurity.com ')).toBe('pentasecurity.com');
    expect(emailDomain('no-at-sign')).toBe('');
    expect(isAllowedDomain('a@PENTASECURITY.COM', ['pentasecurity.com'])).toBe(true);
    expect(isAllowedDomain('a@evil-pentasecurity.com', ['pentasecurity.com'])).toBe(false);
    expect(isAllowedDomain('a@', ['pentasecurity.com'])).toBe(false);
    expect(isBootstrapAdmin('Boss@PentaSecurity.com', ['boss@pentasecurity.com'])).toBe(true);
  });
});

describe('resolveSignIn', () => {
  beforeEach(() => {
    counter += 1;
  });

  it('① ADMIN_EMAILS 의 최초 로그인 → ADMIN, bootstrap, 감사 user.bootstrap_admin', async () => {
    const outcome = await resolveSignIn(handle, input('boss@pentasecurity.com'), POLICY);

    expect(outcome.ok).toBe(true);
    const user = await findUserByEmail(handle, 'boss@pentasecurity.com');
    expect(user).toMatchObject({ role: 'ADMIN', createdVia: 'bootstrap', status: 'active' });
    expect(user?.googleSub).toBe('sub-boss@pentasecurity.com');
    const logs = await auditByAction(handle, 'user.bootstrap_admin');
    expect(logs.some((log) => log.targetId === user?.id && log.ip === '10.0.0.7')).toBe(true);
    const logins = await auditByAction(handle, 'auth.login');
    expect(logins.some((log) => log.actorUserId === user?.id)).toBe(true);
  });

  it('② 허용 도메인의 미등록 이메일 → USER, auto, 감사 user.auto_provisioned', async () => {
    const email = uniqueEmail();
    const outcome = await resolveSignIn(handle, input(email), POLICY);

    expect(outcome).toMatchObject({ ok: true, created: true });
    expect(await findUserByEmail(handle, email)).toMatchObject({
      role: 'USER',
      createdVia: 'auto',
    });
    const logs = await auditByAction(handle, 'user.auto_provisioned');
    expect(logs.some((log) => log.targetLabel === email)).toBe(true);
  });

  it.each([
    ['타 도메인(@gmail.com)', 'someone@gmail.com', true],
    ['email_verified=false', 'unverified@pentasecurity.com', false],
  ])('③ %s → 거부, users 무변경, 감사 auth.denied_domain', async (_label, email, verified) => {
    const before = await handle.db.select().from(users);
    const outcome = await resolveSignIn(handle, input(email, { emailVerified: verified }), POLICY);

    expect(outcome).toEqual({ ok: false, reason: 'domain' });
    expect(await handle.db.select().from(users)).toHaveLength(before.length);
    const logs = await auditByAction(handle, 'auth.denied_domain');
    expect(logs.some((log) => log.actorLabel === email && log.result === 'denied')).toBe(true);
  });

  it('④ status=inactive 사용자 → 거부, 감사 auth.denied_inactive, 로그인 시각 갱신 없음', async () => {
    const email = uniqueEmail('inactive');
    await insertUser(handle, { email, status: 'inactive' });

    const outcome = await resolveSignIn(handle, input(email), POLICY);

    expect(outcome).toEqual({ ok: false, reason: 'inactive' });
    expect((await findUserByEmail(handle, email))?.lastLoginAt).toBeNull();
    const logs = await auditByAction(handle, 'auth.denied_inactive');
    expect(logs.some((log) => log.targetLabel === email && log.result === 'denied')).toBe(true);
  });

  it('⑤ AUTH_AUTO_PROVISION=false 이면 미등록 이메일은 거부된다', async () => {
    const email = uniqueEmail('closed');
    const outcome = await resolveSignIn(handle, input(email), { ...POLICY, autoProvision: false });

    expect(outcome).toEqual({ ok: false, reason: 'unregistered' });
    expect(await findUserByEmail(handle, email)).toBeUndefined();
    expect(await auditByAction(handle, 'auth.denied_unregistered')).not.toHaveLength(0);
  });

  it('사전 등록 사용자는 자동 생성 없이 로그인되고 프로필이 채워진다', async () => {
    const email = uniqueEmail('pre');
    await insertUser(handle, { email, name: '사전 등록', department: '영업팀', role: 'USER' });

    const outcome = await resolveSignIn(handle, input(email), { ...POLICY, autoProvision: false });

    expect(outcome).toMatchObject({ ok: true, created: false });
    const user = await findUserByEmail(handle, email);
    expect(user).toMatchObject({
      name: 'Google 이름',
      department: '영업팀',
      googleSub: `sub-${email}`,
      avatarUrl: 'https://example.com/a.png',
      createdVia: 'admin',
    });
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('ADMIN_EMAILS 승격은 최초 로그인에만 적용된다 (이후 역할은 관리 화면에서만)', async () => {
    const email = uniqueEmail('lead');
    const policy = { ...POLICY, adminEmails: [email] };
    await insertUser(handle, { email, role: 'USER' });

    await resolveSignIn(handle, input(email), policy);
    expect((await findUserByEmail(handle, email))?.role).toBe('ADMIN');
    const promoted = await auditByAction(handle, 'user.bootstrap_admin');
    const log = promoted.find((entry) => entry.targetLabel === email);
    expect(log?.before).toEqual({ role: 'USER' });
    expect(log?.after).toEqual({ role: 'ADMIN' });

    // 관리 화면에서 USER 로 강등한 뒤 다시 로그인해도 재승격하지 않는다
    const { eq } = await import('drizzle-orm');
    await handle.db.update(users).set({ role: 'USER' }).where(eq(users.email, email));
    await resolveSignIn(handle, input(email), policy);
    expect((await findUserByEmail(handle, email))?.role).toBe('USER');
  });

  it('Google 이름이 없으면 이메일 로컬파트를 이름으로 쓴다', async () => {
    const email = uniqueEmail('noname');
    await resolveSignIn(handle, input(email, { name: null, googleSub: null }), POLICY);
    expect((await findUserByEmail(handle, email))?.name).toBe(email.split('@')[0]);
  });
});
