import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialView } from '@/server/llm/credentials/view';

/**
 * PRAMI-003 PR-3 (화면): OpenRouter OAuth 카드 — 한도 안내(대시보드 링크·키 라벨), 만료 "재연결 필요"(AC-346),
 * 연결 해제 후 대시보드 폐기 안내 + 키 라벨(AC-347, 플래그 on·off 동일).
 */
const actions = vi.hoisted(() => ({
  deleteLlmCredentialAction: vi.fn(async () => ({ ok: true as const, data: { deleted: true } })),
  verifyLlmCredentialAction: vi.fn(),
}));
vi.mock('@/features/settings/actions', () => ({
  saveLlmCredentialAction: vi.fn(),
  verifyLlmCredentialAction: actions.verifyLlmCredentialAction,
  deleteLlmCredentialAction: actions.deleteLlmCredentialAction,
  updateChatDefaultsAction: vi.fn(),
  reloginWithGoogleAction: vi.fn(),
}));

const { vendorViews } = await import('@/server/llm/credentials/settings');
const { LlmSection } = await import('@/features/settings/LlmSection');
const { DELETE_DONE_MESSAGE } = await import('@/features/settings/labels');

const DASHBOARD = 'https://openrouter.ai/settings/keys';

const openrouter = (patch: Partial<CredentialView> = {}): CredentialView => ({
  vendor: 'openrouter',
  vendorLabel: 'OpenRouter',
  authType: 'oauth_pkce',
  status: 'unverified',
  keyHint: 'sk-or-…CDEF',
  lastVerifiedAt: null,
  lastUsedAt: null,
  lastErrorCode: null,
  availableModels: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  ...patch,
});

function renderSection(credentials: CredentialView[], flag = true) {
  return render(
    <LlmSection
      vendors={vendorViews(
        { oauthOpenRouter: flag },
        credentials.map((entry) => entry.vendor),
      )}
      initialCredentials={credentials}
      initialDefaults={{ vendor: null, model: null, modelReplaced: false }}
      keyringReady
    />,
  );
}

const card = () => screen.getByRole('article', { name: 'OpenRouter 연결' });

beforeEach(() => {
  actions.deleteLlmCredentialAction.mockClear();
});

describe('OpenRouter 카드 — 한도 안내 (§4.4.3)', () => {
  it('연결 전에도 대시보드에서 키 "Prami (local)" 한도를 설정하라는 안내와 링크가 있다 (앱 한도 입력란 없음)', () => {
    renderSection([]);
    const note = within(card()).getByRole('note');
    expect(note).toHaveTextContent(
      '사용 한도(크레딧)는 OpenRouter 대시보드에서 키 "Prami (local)"',
    );
    expect(within(note).getByRole('link', { name: 'OpenRouter 키 관리 열기' })).toHaveAttribute(
      'href',
      DASHBOARD,
    );
    expect(within(card()).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(card()).queryByLabelText(/한도/)).not.toBeInTheDocument();
  });
});

describe('AC-346 만료 카드', () => {
  it('status=expired → "재연결 필요" 배지 + 만료 안내(alert) + 다시 연결 링크', () => {
    renderSection([openrouter({ status: 'expired', lastErrorCode: 'expired' })]);
    expect(within(card()).getByTestId('status-openrouter')).toHaveTextContent('재연결 필요');
    expect(within(card()).getByRole('alert')).toHaveTextContent(
      'OpenRouter 연결이 만료되었습니다 — 다시 연결하세요',
    );
    expect(within(card()).getByRole('link', { name: 'OpenRouter 다시 연결' })).toHaveAttribute(
      'href',
      '/api/settings/oauth/openrouter/start',
    );
  });

  it('[검증] 결과가 만료(code=expired)면 카드가 "재연결 필요"로 바뀌고 오류 안내가 뜬다', async () => {
    actions.verifyLlmCredentialAction.mockResolvedValueOnce({
      ok: true,
      data: openrouter({ status: 'expired', lastErrorCode: 'expired' }),
    });
    renderSection([openrouter({ status: 'valid' })]);
    await userEvent.click(within(card()).getByRole('button', { name: '검증' }));

    expect(actions.verifyLlmCredentialAction).toHaveBeenCalledWith({ vendor: 'openrouter' });
    expect(await within(card()).findByText('재연결 필요')).toBeInTheDocument();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((node) => node.textContent).join(' ')).toContain(
      '연결이 만료되었습니다 — 다시 연결하세요',
    );
  });

  it('[검증] 실패 응답은 서버 문구를 그대로 보인다', async () => {
    actions.verifyLlmCredentialAction.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: '검증 요청이 너무 잦습니다. 30초 후 다시 시도하세요',
      },
    });
    renderSection([openrouter({ status: 'valid' })]);
    await userEvent.click(within(card()).getByRole('button', { name: '검증' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('검증 요청이 너무 잦습니다');
  });

  it('미래·NULL 만료(정상 상태)에는 만료 안내가 없다', () => {
    renderSection([openrouter({ status: 'valid' })]);
    expect(within(card()).getByTestId('status-openrouter')).toHaveTextContent('정상');
    expect(within(card()).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AC-347 연결 해제 안내', () => {
  it.each([
    ['플래그 on', true],
    ['플래그 off', false],
  ])('%s: 삭제 성공 → 대시보드 폐기 안내 + 키 라벨 + 링크', async (_label, flag) => {
    renderSection([openrouter()], flag);
    await userEvent.click(within(card()).getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    expect(actions.deleteLlmCredentialAction).toHaveBeenCalledWith({ vendor: 'openrouter' });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('OpenRouter 연결을 해제하고 앱에 저장된 키를 파기했습니다');
    expect(status).toHaveTextContent('OpenRouter 대시보드에서 키 "Prami (local)"를 삭제하세요');
    expect(within(status).getByRole('link', { name: 'OpenRouter 키 관리 열기' })).toHaveAttribute(
      'href',
      DASHBOARD,
    );
  });

  it('레지스트리에 없는 벤더 키도 카드로 보이고 삭제는 기존 문구 (라벨·링크 없음)', async () => {
    renderSection([
      { ...openrouter(), vendor: 'retired_vendor', vendorLabel: 'Retired', status: 'unsupported' },
    ]);
    const retired = screen.getByRole('article', { name: 'Retired 연결' });
    await userEvent.click(within(retired).getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('status')).toHaveTextContent(DELETE_DONE_MESSAGE);
  });

  it('삭제 실패 응답은 오류로 보인다', async () => {
    actions.deleteLlmCredentialAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NOT_FOUND', message: '등록된 키가 없습니다' },
    } as never);
    renderSection([openrouter()]);
    await userEvent.click(within(card()).getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('등록된 키가 없습니다');
  });

  it('API 키 벤더 삭제는 기존 문구 그대로 (링크 없음)', async () => {
    renderSection([
      {
        ...openrouter(),
        vendor: 'openai',
        vendorLabel: 'OpenAI',
        authType: 'api_key',
        keyHint: 'sk-…WXYZ',
      },
    ]);
    const openai = screen.getByRole('article', { name: 'OpenAI 연결' });
    await userEvent.click(within(openai).getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(DELETE_DONE_MESSAGE);
    expect(within(status).queryByRole('link')).not.toBeInTheDocument();
  });
});
