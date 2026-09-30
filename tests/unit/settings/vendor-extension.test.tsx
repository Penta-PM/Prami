import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * AC-242 벤더 확장 (PRAMI-002 §4.5.1): 테스트 레지스트리에 가짜 벤더(Acme AI) 1개를 추가하면 — 앱 코드 수정 없이 —
 * 설정 화면 카드가 렌더되고, 등록·검증(상수 호스트)·챗봇 경로가 동작한다. 벤더 추가 = 어댑터 1개 + 레지스트리 1줄 + 모델 상수.
 */
vi.mock('@/server/llm/vendors/registry', async (importOriginal) =>
  (await import('../../fixtures/chat/acme-vendor')).withAcme(
    await importOriginal<typeof import('@/server/llm/vendors/registry')>(),
  ),
);
vi.mock('@/features/settings/actions', () => ({
  saveLlmCredentialAction: vi.fn(),
  verifyLlmCredentialAction: vi.fn(),
  deleteLlmCredentialAction: vi.fn(),
  updateChatDefaultsAction: vi.fn(),
  reloginWithGoogleAction: vi.fn(),
}));

const { vendorViews } = await import('@/server/llm/credentials/settings');
const { LlmSection } = await import('@/features/settings/LlmSection');

describe('벤더 확장 (AC-242)', () => {
  it('설정 화면에 Acme AI 카드가 렌더된다 (레지스트리 1줄)', () => {
    render(
      <LlmSection
        vendors={vendorViews({ oauthOpenRouter: false })}
        initialCredentials={[]}
        initialDefaults={{ vendor: null, model: null, modelReplaced: false }}
        keyringReady
      />,
    );
    expect(screen.getByRole('article', { name: 'Acme AI 연결' })).toBeInTheDocument();
  });
});
