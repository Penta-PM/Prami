import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 챗봇 화면 가드 (UX PR-C2): 가격 정책 챗봇 = chat.use, 조달 챗봇 = chat.use + procurement.read (메뉴·화면·API 세 곳 같은 권한).
 * requirePagePermission 은 권한이 없으면 감사 기록 후 redirect('/') — 여기서는 호출 순서·인자와 거부 시 본문을 그리지 않음만 본다.
 */
const requirePagePermission = vi.fn();
vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: (...args: unknown[]) => requirePagePermission(...args),
}));
vi.mock('@/features/chat/ChatWorkspace', () => ({
  ChatWorkspace: ({ domain }: { domain: string }) => <div data-testid="workspace">{domain}</div>,
}));

const { default: PricingChatPage, metadata: pricingMeta } =
  await import('@/app/(app)/pricing/chat/page');
const { default: ProcurementChatPage, metadata: procurementMeta } =
  await import('@/app/(app)/procurement/chat/page');

beforeEach(() => {
  requirePagePermission.mockReset();
  requirePagePermission.mockResolvedValue({ id: 'u1', role: 'USER' });
});

describe('챗봇 화면 가드', () => {
  it('/pricing/chat: chat.use 만 확인하고 가격 정책 챗봇(domain=pricing)을 그린다', async () => {
    render(await PricingChatPage());
    expect(requirePagePermission.mock.calls).toEqual([['chat.use', '/pricing/chat']]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('가격 정책 챗봇');
    expect(screen.getByTestId('workspace')).toHaveTextContent('pricing');
    expect(pricingMeta).toEqual({ title: '가격 정책 챗봇' });
  });

  it('/procurement/chat: chat.use 와 procurement.read 를 모두 확인하고 조달 챗봇(domain=procurement)을 그린다', async () => {
    render(await ProcurementChatPage());
    expect(requirePagePermission.mock.calls).toEqual([
      ['chat.use', '/procurement/chat'],
      ['procurement.read', '/procurement/chat'],
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('조달 챗봇');
    expect(screen.getByTestId('workspace')).toHaveTextContent('procurement');
    expect(procurementMeta).toEqual({ title: '조달 챗봇' });
  });

  it('procurement.read 가 없으면(redirect) 본문을 그리지 않는다', async () => {
    requirePagePermission.mockImplementation(async (permission: string) => {
      if (permission === 'procurement.read') throw new Error('NEXT_REDIRECT:/');
      return { id: 'u1', role: 'USER' };
    });
    await expect(ProcurementChatPage()).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
