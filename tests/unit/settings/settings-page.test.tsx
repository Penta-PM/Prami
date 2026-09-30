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
    expect(screen.getByText('챗봇이 자연어 질문에 이 벤더·모델을 씁니다')).toBeInTheDocument();
    expect(screen.queryByText('챗봇 LLM 연결은 곧 제공됩니다')).not.toBeInTheDocument();
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

const emptyDefaults = { vendor: null, model: null, modelReplaced: false };

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
    availableModels: null,
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

describe('ChatDefaultsForm 모델 선택 (AC-208, r2)', () => {
  const view = (vendor: string, availableModels: string[] | null): CredentialView => ({
    ...savedView(vendor, 'fake-…WXYZ'),
    availableModels,
  });

  it('Anthropic 기본 선택은 claude-opus-5-5, 레거시는 표시·선택 시 배지, 목록 밖 모델은 "이 키로 사용 불가" 비활성', async () => {
    render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[
          view('anthropic', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5']),
        ]}
        initialDefaults={emptyDefaults}
        keyringReady
      />,
    );
    const region = screen.getByRole('region', { name: '챗봇 기본값' });
    const modelSelect = within(region).getByLabelText(/모델/) as HTMLSelectElement;
    expect(modelSelect.value).toBe('claude-opus-5-5');
    expect(screen.queryByTestId('legacy-badge')).not.toBeInTheDocument();
    const option = (id: string) =>
      within(modelSelect)
        .getAllByRole('option')
        .find((node) => (node as HTMLOptionElement).value === id) as HTMLOptionElement;
    expect(option('claude-haiku-4-5')).toBeDisabled();
    expect(option('claude-haiku-4-5')).toHaveTextContent('이 키로 사용 불가');
    expect(option('claude-sonnet-5')).toBeDisabled();
    expect(option('claude-sonnet-5')).toHaveTextContent('레거시');
    expect(option('claude-opus-5')).not.toBeDisabled();
    expect(option('claude-opus-5')).toHaveTextContent('Claude Opus 5 · 최상위 · 레거시');
    await userEvent.selectOptions(modelSelect, 'claude-opus-5');
    expect(screen.getByTestId('legacy-badge')).toHaveTextContent('레거시');
  });

  it('available_models 가 NULL(미확인)이면 상수 전체 선택 가능, 저장값이 사라졌으면 대체 안내', () => {
    render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[view('anthropic', null)]}
        initialDefaults={{ vendor: 'anthropic', model: 'claude-opus-5-5', modelReplaced: true }}
        keyringReady
      />,
    );
    const region = screen.getByRole('region', { name: '챗봇 기본값' });
    const options = within(region).getAllByRole('option') as HTMLOptionElement[];
    expect(options.filter((node) => node.disabled)).toEqual([]);
    expect(within(region).getByRole('status')).toHaveTextContent(
      '선택한 모델이 더 이상 제공되지 않아 기본 모델로 바뀌었습니다',
    );
  });
});

describe('결과별 알림 (QA L-1·L-2)', () => {
  const result = (data: Partial<CredentialView>) => ({
    ok: true,
    data: { ...savedView('openai', 'fake-…WXYZ'), vendorLabel: 'OpenAI', ...data },
  });

  it.each([
    [{ status: 'valid' as const }, 'status', 'OpenAI 키를 저장하고 검증했습니다'],
    [
      { status: 'unverified' as const, lastErrorCode: 'unavailable' },
      'alert',
      'OpenAI 키를 저장했지만 벤더 응답이 없어 확인하지 못했습니다',
    ],
    [
      { status: 'invalid' as const, lastErrorCode: 'invalid_key' },
      'alert',
      'OpenAI 키를 저장했지만 사용할 수 없습니다: 키가 유효하지 않거나 만료되었습니다',
    ],
    [{ status: 'unreadable' as const }, 'alert', '키를 읽을 수 없습니다 — 다시 등록하세요'],
  ])('저장 결과 %o → %s "%s"', async (data, role, text) => {
    state.save.mockResolvedValue(result(data));
    render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[]}
        initialDefaults={emptyDefaults}
        keyringReady
      />,
    );
    const card = screen.getByRole('article', { name: 'OpenAI 연결' });
    await userEvent.click(within(card).getByRole('button', { name: '등록' }));
    await userEvent.type(within(card).getByLabelText('OpenAI API 키 등록'), makeFakeKey());
    await userEvent.click(within(card).getByRole('button', { name: '저장하고 검증' }));
    const flash = await screen.findAllByRole(role as 'status' | 'alert');
    expect(flash.map((node) => node.textContent).join(' ')).toContain(text);
    if (role === 'alert')
      expect(screen.queryByText(/저장하고 검증했습니다/)).not.toBeInTheDocument();
  });

  it('읽을 수 없는 키 카드는 "키를 읽을 수 없습니다 — 다시 등록하세요" 를 보인다', () => {
    render(
      <LlmSection
        vendors={VENDOR_VIEWS}
        initialCredentials={[{ ...savedView('openai', 'fake-…WXYZ'), status: 'unreadable' }]}
        initialDefaults={emptyDefaults}
        keyringReady
      />,
    );
    const card = screen.getByRole('article', { name: 'OpenAI 연결' });
    expect(within(card).getByRole('alert')).toHaveTextContent(
      '키를 읽을 수 없습니다 — 다시 등록하세요',
    );
  });
});
