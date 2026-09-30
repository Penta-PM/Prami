import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import type { CredentialView } from '@/server/llm/credentials/view';

import { createTestDb, insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * /settings 화면 (PRAMI-002 §4.6.1): 권한 가드 settings.self (AC-212), 계정 연결 — google_sub 값 미노출·TEST MODE 표기 (AC-209),
 * 키 입력 password·autocomplete off·제출 즉시 비움, 저장 후 힌트만 (AC-213), 안내 문구 (§6.1).
 */
const state = vi.hoisted(() => ({
  guards: [] as string[],
  userId: '',
  testMode: false,
  db: null as unknown,
  save: vi.fn(),
}));

vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    state.guards.push(`${permission}:${path}`);
    return { id: state.userId, email: 'page@pentasecurity.com', role: 'USER' };
  },
}));
vi.mock('@/server/auth/providers', () => ({
  isGoogleConfigured: () => false,
  isTestModeEnabled: () => state.testMode,
}));
vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.db,
}));
vi.mock('@/features/settings/actions', () => ({
  saveLlmCredentialAction: (input: unknown) => state.save(input),
  verifyLlmCredentialAction: vi.fn(),
  deleteLlmCredentialAction: vi.fn(),
  updateChatDefaultsAction: vi.fn(),
  reloginWithGoogleAction: vi.fn(),
}));

const { default: SettingsPage } = await import('@/app/(app)/settings/page');
const { LlmSection } = await import('@/features/settings/LlmSection');
const { VENDOR_VIEWS } = await import('@/server/llm/credentials/settings');

const GOOGLE_SUB = 'google-sub-1122334455667788';
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
  state.db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(() => {
  state.guards.length = 0;
  state.save.mockReset();
});

describe('SettingsPage', () => {
  it('settings.self 로 가드하고 계정·LLM·기본값·안내를 렌더, google_sub 값은 HTML 에 없다', async () => {
    state.userId = (
      await insertUser(handle, { email: 'page@pentasecurity.com', googleSub: GOOGLE_SUB })
    ).id;
    const { container } = render(await SettingsPage());
    expect(state.guards).toEqual(['settings.self:/settings']);
    expect(screen.getByRole('heading', { level: 1, name: '사용자 설정' })).toBeInTheDocument();
    expect(screen.getByText('Google 연결됨')).toBeInTheDocument();
    expect(screen.getByText('page@pentasecurity.com')).toBeInTheDocument();
    for (const label of ['Anthropic (Claude) 연결', 'OpenAI 연결', 'Google Gemini 연결']) {
      expect(screen.getByRole('article', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/아직 등록한 LLM API 키가 없습니다/)).toBeInTheDocument();
    expect(screen.getByText('챗봇 LLM 연결은 곧 제공됩니다')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(GOOGLE_SUB);
    expect(container.innerHTML).not.toMatch(/google_sub|googleSub/);
  });

  it('Google 미연결 + 테스트 모드 로그인은 "테스트 로그인(TEST MODE)" 로 표시', async () => {
    state.userId = (await insertUser(handle, { email: 'tm@pentasecurity.com' })).id;
    state.testMode = true;
    const { unmount } = render(await SettingsPage());
    expect(screen.getByText('테스트 로그인(TEST MODE)')).toBeInTheDocument();
    // Google 미설정 환경에서는 재로그인 버튼이 비활성
    expect(screen.getByRole('button', { name: /Google 계정으로 다시 로그인/ })).toBeDisabled();
    unmount();
    state.testMode = false;
    render(await SettingsPage());
    expect(screen.queryByText('테스트 로그인(TEST MODE)')).not.toBeInTheDocument();
    expect(screen.getAllByText('Google 미연결')).toHaveLength(2);
  });
});

const emptyDefaults = { vendor: null, model: null };

function savedView(vendor: string, keyHint: string): CredentialView {
  return {
    vendor,
    vendorLabel: 'Anthropic (Claude)',
    authType: 'api_key',
    keyHint,
    status: 'valid',
    lastVerifiedAt: '2026-09-30T01:00:00.000Z',
    lastErrorCode: null,
    lastUsedAt: null,
    createdAt: '2026-09-30T01:00:00.000Z',
  };
}

describe('LlmSection 키 입력 (AC-213)', () => {
  it('password·autocomplete off·spellcheck off, 제출 즉시 입력을 비우고 저장 후에는 힌트만 보인다', async () => {
    const key = makeFakeKey();
    state.save.mockResolvedValue({ ok: true, data: savedView('anthropic', 'fake-…WXYZ') });
    const { container } = render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[]}
        initialDefaults={emptyDefaults}
        keyringReady
      />,
    );
    const card = screen.getByRole('article', { name: 'Anthropic (Claude) 연결' });
    await userEvent.click(within(card).getByRole('button', { name: '등록' }));
    const input = within(card).getByLabelText('Anthropic (Claude) API 키 등록');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    await userEvent.type(input, key);
    await userEvent.click(within(card).getByRole('button', { name: '저장하고 검증' }));
    expect(state.save).toHaveBeenCalledWith({ vendor: 'anthropic', apiKey: key });
    expect(await screen.findByTestId('hint-anthropic')).toHaveTextContent('fake-…WXYZ');
    expect(screen.getByTestId('status-anthropic')).toHaveTextContent('정상');
    expect(screen.queryByLabelText('Anthropic (Claude) API 키 등록')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(key.slice(-12));
  });

  it('저장 실패 시에도 입력은 비워지고 서버의 고정 문구만 보인다', async () => {
    const key = makeFakeKey();
    state.save.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION', message: 'API 키 형식이 올바르지 않습니다' },
    });
    const { container } = render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[]}
        initialDefaults={emptyDefaults}
        keyringReady
      />,
    );
    const card = screen.getByRole('article', { name: 'OpenAI 연결' });
    await userEvent.click(within(card).getByRole('button', { name: '등록' }));
    const input = within(card).getByLabelText<HTMLInputElement>('OpenAI API 키 등록');
    await userEvent.type(input, key);
    await userEvent.click(within(card).getByRole('button', { name: '저장하고 검증' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API 키 형식이 올바르지 않습니다');
    expect(input.value).toBe('');
    expect(container.innerHTML).not.toContain(key.slice(-12));
  });

  it('KEK 가 없으면 안내를 보이고 등록 버튼을 막는다 (§4.13)', () => {
    render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[]}
        initialDefaults={emptyDefaults}
        keyringReady={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/LLM_CREDENTIALS_KEKS|관리자/);
    for (const button of screen.getAllByRole('button', { name: '등록' })) {
      expect(button).toBeDisabled();
    }
  });
});
