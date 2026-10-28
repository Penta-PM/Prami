import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CredentialView } from '@/server/llm/credentials/view';
import type { LlmVendor } from '@/server/llm/vendors/types';

/**
 * PRAMI-003 §4.8 회사 API 키 주의 문구 (AC-359·AC-360 ③④): 확정 문구 그대로, 위치 2곳(섹션 상단 role=note · 폼 힌트),
 * 색은 디자인 토큰(--text-danger·--surface-danger·--border-danger)만, 챗봇 미등록 안내·설정 미등록 문구의 벤더 나열 정합.
 */
vi.mock('@/features/settings/actions', () => ({
  saveLlmCredentialAction: vi.fn(),
  verifyLlmCredentialAction: vi.fn(),
  deleteLlmCredentialAction: vi.fn(),
  updateChatDefaultsAction: vi.fn(),
  reloginWithGoogleAction: vi.fn(),
}));

const { vendorViews } = await import('@/server/llm/credentials/settings');
const { LlmSection } = await import('@/features/settings/LlmSection');
const labels = await import('@/features/settings/labels');
const { MISSING_MESSAGE } = await import('@/server/chat/graph/messages');
const { LLM_API_KEY_VENDOR_NAMES } = await import('@/lib/constants/llm-vendor-names');
const { LLM_VENDORS, acceptsApiKey } = await import('@/server/llm/vendors/registry');

/** §4.8.1 확정 문구 — 스펙 원문 그대로 (상수가 바뀌면 이 테스트가 깨져 Plan 재검토로 간다) */
const SPEC_TITLE = '회사 API 키를 사용하세요';
const SPEC_BODY =
  '개인 API 키를 사용하면 입력한 질문과 조회된 판매단가 등 민감한 업무 데이터가 벤더의 모델 학습에 활용될 수 있습니다. 업무에는 반드시 회사에서 발급한 API 키를 사용하세요.';
const SPEC_HINT =
  '회사에서 발급한 API 키만 입력하세요. 개인 키는 입력한 데이터가 모델 학습에 활용될 수 있습니다.';
const SPEC_MISSING =
  'LLM API 키가 등록되지 않았습니다. 사용자 설정에서 회사에서 발급한 Anthropic·OpenAI·Google·xAI 중 하나의 API 키를 등록하면 자연어로 질문할 수 있어요. 개인 API 키는 입력한 데이터가 모델 학습에 활용될 수 있으니 사용하지 마세요. 지금은 기본 응답으로 답해 드립니다.';

const credential: CredentialView = {
  vendor: 'xai',
  vendorLabel: 'xAI (Grok)',
  authType: 'api_key',
  status: 'valid',
  keyHint: 'xai-…WXYZ',
  lastVerifiedAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null,
  lastErrorCode: null,
  availableModels: ['grok-4.7', 'grok-4.3'],
  createdAt: '2026-10-01T00:00:00.000Z',
};

function renderSection(credentials: CredentialView[]) {
  return render(
    <LlmSection
      vendors={vendorViews(
        { oauthOpenRouter: false },
        credentials.map((entry) => entry.vendor),
      )}
      initialCredentials={credentials}
      initialDefaults={{ vendor: null, model: null, modelReplaced: false }}
      keyringReady
    />,
  );
}

/** 레지스트리 API 키 벤더의 라벨 약칭(첫 단어: 'Google Gemini' → 'Google', 'xAI (Grok)' → 'xAI') */
function apiKeyVendorShortNames(vendors: readonly LlmVendor[]): string[] {
  return vendors.filter(acceptsApiKey).map((vendor) => vendor.label.split(' ')[0]!);
}

describe('확정 문구 상수 (§4.8.1)', () => {
  it('제목·본문·폼 힌트가 스펙 원문과 같다', () => {
    expect(labels.COMPANY_KEY_WARNING_TITLE).toBe(SPEC_TITLE);
    expect(labels.COMPANY_KEY_WARNING_BODY).toBe(SPEC_BODY);
    expect(labels.COMPANY_KEY_FORM_HINT).toBe(SPEC_HINT);
  });
});

describe.each([
  ['자격 증명 0개', [] as CredentialView[]],
  ['자격 증명 1개', [credential]],
])('LLM 연결 섹션 상단 안내 — %s (AC-359)', (_label, credentials) => {
  it('h2 바로 다음 형제가 role=note 안내, 제목·본문이 상수와 같고 alert·aria-live 없음', () => {
    renderSection(credentials);
    const section = screen.getByRole('region', { name: 'LLM 연결' });
    const heading = within(section).getByRole('heading', { level: 2, name: 'LLM 연결' });
    const note = heading.nextElementSibling as HTMLElement;
    expect(note.tagName).toBe('ASIDE');
    expect(note).toHaveAttribute('role', 'note');
    expect(note).toHaveAccessibleName(SPEC_TITLE);
    expect(within(note).getByText(SPEC_TITLE).tagName).toBe('STRONG');
    expect(note).toHaveTextContent(`${SPEC_TITLE}${SPEC_BODY}`);
    expect(note).not.toHaveAttribute('aria-live');
    expect(note.querySelector('[role="alert"],[aria-live]')).toBeNull();
    const icon = note.querySelector('svg')!;
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(note.className).toMatch(/\btext-text-danger\b/);
    expect(note.className).toMatch(/\bbg-surface-danger\b/);
    expect(note.className).toMatch(/\bborder-border-danger\b/);
    // 닫기 버튼 없음 — 항상 표시
    expect(within(note).queryByRole('button')).toBeNull();
  });
});

describe('키 등록·교체 폼 힌트 (AC-359)', () => {
  it.each([
    ['등록', [] as CredentialView[], 'xAI (Grok)'],
    ['교체', [credential], 'xAI (Grok)'],
    ['등록', [] as CredentialView[], 'Anthropic'],
  ])(
    '%s 폼: 라벨과 입력란 사이 힌트, 입력란 aria-describedby = 힌트 id',
    async (action, credentials, vendor) => {
      renderSection(credentials);
      const card = screen.getByRole('article', {
        name: new RegExp(`^${vendor.replace(/[()]/g, '\\$&')}`),
      });
      await userEvent.click(within(card).getByRole('button', { name: action }));
      const input = within(card).getByLabelText(new RegExp(`API 키 ${action}`));
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveAccessibleDescription(SPEC_HINT);
      const hint = document.getElementById(input.getAttribute('aria-describedby')!)!;
      expect(hint.id).toMatch(/^llm-key-hint-[a-z]+$/);
      expect(hint.previousElementSibling?.tagName).toBe('LABEL');
      expect(hint.nextElementSibling).toBe(input);
      expect(hint.className).toMatch(/\btext-text-danger\b/);
    },
  );
});

describe('벤더 나열 정합 (AC-360 ③④)', () => {
  it('공통 나열 = 레지스트리 API 키 벤더 약칭 (Anthropic·OpenAI·Google·xAI)', () => {
    expect([...LLM_API_KEY_VENDOR_NAMES]).toEqual(apiKeyVendorShortNames(LLM_VENDORS));
  });

  it('벤더 하나를 뺀 테스트 레지스트리와는 같지 않다 (누락 감지)', () => {
    const withoutXai = LLM_VENDORS.filter((vendor) => vendor.id !== 'xai');
    expect([...LLM_API_KEY_VENDOR_NAMES]).not.toEqual(apiKeyVendorShortNames(withoutXai));
  });

  it('챗봇 missing 안내가 §4.8.2 ③ 확정 문구와 같다', () => {
    expect(MISSING_MESSAGE).toBe(SPEC_MISSING);
  });

  it('설정 미등록 문구에 xAI 포함 (자격 증명 0개일 때만)', () => {
    const { unmount } = renderSection([]);
    expect(
      screen.getByText(
        '아직 등록한 LLM API 키가 없습니다. Anthropic·OpenAI·Google·xAI 중 하나의 키를 등록하면 챗봇에서 자연어로 질문할 수 있게 됩니다.',
      ),
    ).toBeInTheDocument();
    unmount();
    renderSection([credential]);
    expect(screen.queryByText(/아직 등록한 LLM API 키가 없습니다/)).toBeNull();
  });

  it('설정 카드 = Anthropic·OpenAI·Google·xAI 4장', () => {
    renderSection([]);
    const section = screen.getByRole('region', { name: 'LLM 연결' });
    expect(within(section).getAllByRole('article')).toHaveLength(4);
    expect(within(section).getByRole('article', { name: /^xAI \(Grok\)/ })).toBeInTheDocument();
  });
});

describe('색 토큰만 사용 (AC-359 grep)', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
  const warningBlock = (source: string) =>
    source.slice(source.indexOf('function CompanyKeyWarning'));

  it('주의 안내·폼 힌트에 hex 색·text-red-500·임의 색 없음, 토큰 클래스만', () => {
    const section = warningBlock(read('src/features/settings/LlmSection.tsx'));
    const form = read('src/features/settings/LlmCredentialForm.tsx');
    // 경고 아이콘 = Penta warning (디자인 PR-3) — 렌더러·생성 파일 모두 currentColor 만
    const icon = read('src/components/icons/Icon.tsx') + read('src/components/icons/penta.tsx');
    for (const source of [section, form, icon]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/red-500/);
      expect(source).not.toMatch(/\[(?:color:)?(?:#|rgb|hsl)/);
    }
    expect(section).toMatch(/text-text-danger/);
    expect(section).toMatch(/bg-surface-danger/);
    expect(section).toMatch(/border-border-danger/);
    expect(form).toMatch(/text-text-danger/);
  });
});
