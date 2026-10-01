// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { users } from '@/db/schema';
import {
  domainDenyCode,
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
  idp: 'google',
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

describe('fixture 계정 거부 (PRAMI-003 §4.9.3 L3, AC-333 ③)', () => {
  const PREVIEW_POLICY: SignInPolicy = { ...POLICY, rejectFixtureAccounts: true };

  it('운영·preview 정책: fixture-admin@<허용 도메인>(hd·email_verified 정상) → 거부, 감사 auth.denied_domain 사유 fixture_account, users 무변경', async () => {
    const email = 'fixture-admin@pentasecurity.com';
    const before = await handle.db.select({ id: users.id }).from(users);

    const outcome = await resolveSignIn(handle, input(email), PREVIEW_POLICY);

    expect(outcome).toEqual({ ok: false, reason: 'fixture_account' });
    expect(await findUserByEmail(handle, email)).toBeUndefined();
    expect(await handle.db.select({ id: users.id }).from(users)).toHaveLength(before.length);
    const logs = await auditByAction(handle, 'auth.denied_domain');
    const log = logs.find((entry) => entry.targetLabel === email);
    expect(log).toMatchObject({ result: 'denied', after: { reason: 'fixture_account' } });
  });

  it('대소문자·공백이 섞여도 접두를 잡고, ADMIN_EMAILS 에 있어도 거부한다', async () => {
    const outcome = await resolveSignIn(handle, input(' Fixture-User@PentaSecurity.com '), {
      ...PREVIEW_POLICY,
      adminEmails: ['fixture-user@pentasecurity.com'],
    });
    expect(outcome).toEqual({ ok: false, reason: 'fixture_account' });
  });

  it('로컬 정책(기본)에서는 기존 동작 — fixture 계정도 허용 도메인이면 로그인된다', async () => {
    const outcome = await resolveSignIn(handle, input('fixture-local@pentasecurity.com'), POLICY);
    expect(outcome.ok).toBe(true);
  });

  it('접두가 아닌 곳에 fixture 가 있으면 거부하지 않는다', async () => {
    const outcome = await resolveSignIn(handle, input(uniqueEmail('my-fixture-')), PREVIEW_POLICY);
    expect(outcome.ok).toBe(true);
  });
});

describe('Google hd 클레임 서버 검증 (PRAMI-003 §4.4.1, AC-341)', () => {
  const HD_POLICY: SignInPolicy = { ...POLICY, requireHostedDomain: true };

  /** users 행 수·해당 이메일 감사를 함께 돌려준다 */
  async function deniedWith(email: string, extra: Partial<SignInInput>) {
    const before = await handle.db.select({ id: users.id }).from(users);
    const outcome = await resolveSignIn(handle, input(email, extra), HD_POLICY);
    const after = await handle.db.select({ id: users.id }).from(users);
    const logs = await auditByAction(handle, 'auth.denied_domain');
    return {
      outcome,
      usersChanged: after.length !== before.length,
      user: await findUserByEmail(handle, email),
      log: logs.find((entry) => entry.actorLabel === normalize(email)),
    };
  }
  const normalize = (email: string) => email.trim().toLowerCase();

  it('① hd=허용 도메인 + 허용 이메일 + email_verified → 허용 (대소문자 무시)', async () => {
    const email = uniqueEmail('hd-ok');
    const outcome = await resolveSignIn(
      handle,
      input(email, { hostedDomain: 'PentaSecurity.com' }),
      HD_POLICY,
    );
    expect(outcome).toMatchObject({ ok: true, created: true });
  });

  it.each([
    ['② hd 없음(개인 Gmail)', 'someone.hd@gmail.com', { hostedDomain: null }, 'hd_missing'],
    ['② hd 빈 문자열', `blank${Date.now()}@pentasecurity.com`, { hostedDomain: '' }, 'hd_missing'],
    [
      '③ hd=다른 도메인 + 허용 도메인 이메일(위조 모의)',
      `spoof${Date.now()}@pentasecurity.com`,
      { hostedDomain: 'evil.example' },
      'hd_mismatch',
    ],
    [
      '③ hd=허용 도메인을 포함하는 다른 도메인',
      `suffix${Date.now()}@pentasecurity.com`,
      { hostedDomain: 'evil-pentasecurity.com' },
      'hd_mismatch',
    ],
    [
      '④ email_verified=false',
      `unverified-hd${Date.now()}@pentasecurity.com`,
      { hostedDomain: 'pentasecurity.com', emailVerified: false },
      'email_unverified',
    ],
    [
      'hd 는 맞지만 이메일 도메인이 다름',
      `other${Date.now()}@other.example`,
      { hostedDomain: 'pentasecurity.com' },
      'email_domain',
    ],
  ] as const)('%s → 거부(사유 %s), ⑤ users 무변경', async (_label, email, extra, code) => {
    const result = await deniedWith(email, extra);

    expect(result.outcome).toEqual({ ok: false, reason: 'domain' });
    expect(result.usersChanged).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.log).toMatchObject({ result: 'denied', after: { reason: code } });
  });

  it('⑤ 기존 사용자도 hd 가 틀리면 거부되고 행이 바뀌지 않는다', async () => {
    const email = uniqueEmail('hd-existing');
    await insertUser(handle, { email });
    const before = await findUserByEmail(handle, email);

    const outcome = await resolveSignIn(handle, input(email, { hostedDomain: null }), HD_POLICY);

    expect(outcome).toEqual({ ok: false, reason: 'domain' });
    expect(await findUserByEmail(handle, email)).toEqual(before);
  });

  it('AUTH_REQUIRE_HD=false(로컬)면 기존 동작 — hd 가 없어도 허용 도메인이면 로그인된다', async () => {
    const outcome = await resolveSignIn(
      handle,
      input(uniqueEmail('hd-off'), { hostedDomain: null }),
      POLICY,
    );
    expect(outcome.ok).toBe(true);
  });

  it('테스트 Credentials(idp=test)는 hd 검사 대상이 아니다 — 운영에서는 등록되지 않음', () => {
    expect(
      domainDenyCode(
        { idp: 'test', email: 'qa@pentasecurity.com', emailVerified: true, meta: META },
        HD_POLICY,
      ),
    ).toBeNull();
  });

  it('도메인 거부 감사는 기존 사유도 코드로 남긴다 (hd 미요구)', async () => {
    const email = 'plain.denied@gmail.com';
    await resolveSignIn(handle, input(email), POLICY);
    const logs = await auditByAction(handle, 'auth.denied_domain');
    expect(logs.find((entry) => entry.actorLabel === email)).toMatchObject({
      after: { reason: 'email_domain', emailVerified: true },
    });
  });
});
