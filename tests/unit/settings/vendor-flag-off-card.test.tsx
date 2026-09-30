import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CredentialView } from '@/server/llm/credentials/view';

/**
 * PR-C QA L-3 (화면): 플래그 off 인데 본인 OpenRouter 키가 남아 있으면 카드가 보이고 안내 + [삭제]만 있다
 * (연결·교체·검증 없음). 삭제는 기존 확인 모달 → deleteLlmCredentialAction. 챗봇 기본값 선택지에도 없다.
 */
const actions = vi.hoisted(() => ({
  deleteLlmCredentialAction: vi.fn(async () => ({ ok: true as const, data: { deleted: true } })),
}));
vi.mock('@/features/settings/actions', () => ({
  saveLlmCredentialAction: vi.fn(),
  verifyLlmCredentialAction: vi.fn(),
  deleteLlmCredentialAction: actions.deleteLlmCredentialAction,
  updateChatDefaultsAction: vi.fn(),
  reloginWithGoogleAction: vi.fn(),
}));

const { vendorViews } = await import('@/server/llm/credentials/settings');
const { LlmSection } = await import('@/features/settings/LlmSection');
const { VENDOR_DISABLED_NOTICE } = await import('@/features/settings/LlmCredentialCard');

const openrouterCredential: CredentialView = {
  vendor: 'openrouter',
  vendorLabel: 'OpenRouter',
  authType: 'oauth_pkce',
  status: 'unverified',
  keyHint: 'sk-or-…CDEF',
  lastVerifiedAt: null,
  lastUsedAt: null,
  lastErrorCode: null,
  availableModels: null,
  createdAt: '2026-09-30T00:00:00.000Z',
};

describe('플래그 off OpenRouter 카드 (QA L-3)', () => {
  it('안내 + 삭제만, 삭제 확인 → 삭제 액션 호출, 기본값 선택지에 OpenRouter 없음', async () => {
    render(
      <LlmSection
        vendors={vendorViews({ oauthOpenRouter: false }, ['openrouter'])}
        initialCredentials={[openrouterCredential]}
        initialDefaults={{ vendor: null, model: null, modelReplaced: false }}
        keyringReady
      />,
    );
    const card = screen.getByRole('article', { name: 'OpenRouter 연결' });
    expect(within(card).getByRole('note')).toHaveTextContent(VENDOR_DISABLED_NOTICE);
    expect(within(card).queryByRole('link', { name: /연결/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /교체|등록|검증/ })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(actions.deleteLlmCredentialAction).toHaveBeenCalledWith({ vendor: 'openrouter' });
    expect(screen.queryByRole('option', { name: /OpenRouter/ })).not.toBeInTheDocument();
  });
});
