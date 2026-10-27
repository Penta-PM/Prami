import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loginErrorMessage, safeCallbackUrl } from '@/features/auth/callback-url';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { TestLoginForm } from '@/features/auth/TestLoginForm';
import {
  canAccessAdminArea,
  groupAllowed,
  hasPermission,
  isRole,
  PERMISSION_GROUPS,
} from '@/lib/constants/permissions';
import { fail, ok } from '@/lib/result';

/** 로그인 화면 (AC-03: Google 버튼) + 콜백 URL·권한 상수 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  env: {} as Record<string, string>,
}));

vi.mock('@/server/auth/auth', () => ({ auth: async () => state.session }));
vi.mock('@/features/auth/actions', () => ({
  signInWithGoogle: vi.fn(),
  signInWithTestAccount: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    get env() {
      return actual.parseEnv(state.env);
    },
  };
});

const { default: LoginPage } = await import('@/app/login/page');

const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  state.session = null;
  state.env = {};
});

describe('LoginPage', () => {
  it('Google 로그인 버튼이 있고, 클라이언트 미설정이면 비활성 안내를 보인다', async () => {
    render(await LoginPage(params({})));
    expect(screen.getByRole('heading', { level: 1, name: '가격정책 통합 관리' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Google 계정으로 로그인' })).toBeDisabled();
    expect(screen.getByText(/OAuth 클라이언트가 아직 설정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '테스트 계정 로그인' })).not.toBeInTheDocument();
    // AC-94 ③: 테스트 모드가 꺼져 있으면 TEST MODE 배너 없음
    expect(screen.queryByText('TEST MODE')).not.toBeInTheDocument();
  });

  it('Google 설정·테스트 모드면 버튼 활성 + 테스트 로그인 폼, 오류 코드를 문구로 보인다', async () => {
    state.env = {
      AUTH_GOOGLE_ID: 'id',
      AUTH_GOOGLE_SECRET: 'secret',
      AUTH_TEST_MODE: 'true',
      AUTH_TEST_PASSWORD: 'pw',
    };
    render(await LoginPage(params({ error: 'CredentialsSignin', code: 'inactive' })));
    expect(screen.getByRole('button', { name: 'Google 계정으로 로그인' })).toBeEnabled();
    expect(screen.getByRole('form', { name: '테스트 계정 로그인' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('비활성화된 계정입니다');
    // AC-94 ③: 테스트 모드면 TEST MODE 배너
    expect(screen.getByRole('status', { name: '테스트 모드' })).toHaveTextContent('TEST MODE');
  });

  it('이미 로그인했으면 callbackUrl(안전한 경로)로 보낸다', async () => {
    state.session = { user: { id: 'u' } };
    await expect(LoginPage(params({ callbackUrl: '/admin/users' }))).rejects.toThrow(
      'NEXT_REDIRECT:/admin/users',
    );
    await expect(LoginPage(params({ callbackUrl: 'https://evil.example' }))).rejects.toThrow(
      'NEXT_REDIRECT:/',
    );
  });
});

describe('TestLoginForm / GoogleButton', () => {
  it('픽스처 칩으로 이메일을 채운다', async () => {
    render(
      <TestLoginForm
        action={vi.fn()}
        callbackUrl="/pricing"
        presets={[
          { email: 'a@pentasecurity.com', label: '관리자' },
          { email: 'u@pentasecurity.com', label: '사용자' },
        ]}
      />,
    );
    const email = screen.getByLabelText('이메일');
    expect(email).toHaveValue('a@pentasecurity.com');
    await userEvent.click(screen.getByRole('button', { name: '사용자' }));
    expect(email).toHaveValue('u@pentasecurity.com');
    expect(screen.getByRole('button', { name: '사용자' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.clear(email);
    await userEvent.type(email, 'x@pentasecurity.com');
    expect(email).toHaveValue('x@pentasecurity.com');
  });

  it('GoogleButton 은 submit 버튼이다', () => {
    render(<GoogleButton />);
    expect(screen.getByRole('button', { name: 'Google 계정으로 로그인' })).toHaveAttribute(
      'type',
      'submit',
    );
  });
});

describe('safeCallbackUrl / loginErrorMessage', () => {
  it.each([
    [null, '/'],
    ['/pricing?x=1', '/pricing?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login?error=x', '/'],
    ['/api/auth/signin', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeCallbackUrl(input)).toBe(expected);
  });

  it('오류 코드별 문구', () => {
    const domains = ['pentasecurity.com'];
    expect(loginErrorMessage(undefined, domains)).toBeNull();
    expect(loginErrorMessage('domain', domains)).toContain('@pentasecurity.com');
    expect(loginErrorMessage('unregistered', domains)).toContain('사전 등록');
    expect(loginErrorMessage('credentials', domains)).toContain('비밀번호');
    expect(loginErrorMessage('test_mode_host', domains)).toContain('AUTH_TEST_ALLOWED_HOSTS');
    expect(loginErrorMessage('rate_limited', domains)).toContain('너무 잦습니다');
    expect(loginErrorMessage('Configuration', domains)).toContain('로그인하지 못했습니다');
  });
});

describe('PERMISSIONS', () => {
  it('USER 는 조회·계산기만, ADMIN 은 전부 (§4.6)', () => {
    expect(hasPermission('USER', 'pricing.read')).toBe(true);
    expect(hasPermission('USER', 'users.manage')).toBe(false);
    expect(hasPermission('ADMIN', 'cost.write')).toBe(true);
    expect(hasPermission(null, 'pricing.read')).toBe(false);
    // 조달이 통합 D-1: 조회 = USER·ADMIN, 편집 = ADMIN, 비로그인 거부
    expect(hasPermission('USER', 'procurement.read')).toBe(true);
    expect(hasPermission('ADMIN', 'procurement.read')).toBe(true);
    expect(hasPermission('USER', 'procurement.write')).toBe(false);
    expect(hasPermission('ADMIN', 'procurement.write')).toBe(true);
    expect(hasPermission(null, 'procurement.read')).toBe(false);
    expect(canAccessAdminArea('ADMIN')).toBe(true);
    expect(canAccessAdminArea('USER')).toBe(false);
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('ROOT')).toBe(false);
    expect(PERMISSION_GROUPS.every((group) => groupAllowed('ADMIN', group))).toBe(true);
  });

  it('result 봉투 헬퍼', () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail('FORBIDDEN', 'x')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'x' },
    });
  });
});
