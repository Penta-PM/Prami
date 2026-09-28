import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuoteShareView } from '@/features/calculator/types';

/**
 * ShareModal (§4.5.8 UI): 링크 목록 로드 → 새 링크(만료일 기본 30) → 복사 → 폐기(비활성 표시). Action 은 모킹.
 */
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/features/calculator/actions', () => ({
  listQuoteSharesAction: mocks.list,
  createQuoteShareAction: mocks.create,
  revokeQuoteShareAction: mocks.revoke,
}));

const { ShareModal } = await import('@/features/calculator/ShareModal');

const QUOTE = {
  id: '11111111-1111-4111-8111-111111111111',
  quoteNo: 'Q-2026-0003',
  productFamily: 'WAPPLES',
  title: 'WAPPLES 견적 Q-2026-0003',
  summary: 'Wapples-2700 × 2',
  totalAmount: '30024000',
  currency: 'KRW',
  createdAt: '2026-09-28T00:00:00.000Z',
  ownerUserId: 'u',
  lines: [],
};

const share = (over: Partial<QuoteShareView> = {}): QuoteShareView => ({
  id: '22222222-2222-4222-8222-222222222222',
  quoteId: QUOTE.id,
  quoteNo: QUOTE.quoteNo,
  token: 'ab'.repeat(32),
  path: `/share/quotes/${'ab'.repeat(32)}`,
  expiresAt: '2026-10-28T00:00:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
  isActive: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('ShareModal', () => {
  it('목록을 불러오고, 새 링크는 만료 30일 기본으로 만들며, 복사·폐기가 Action 을 호출한다', async () => {
    mocks.list.mockResolvedValue({ ok: true, data: [] });
    const created = share();
    mocks.create.mockResolvedValue({ ok: true, data: created });
    mocks.revoke.mockResolvedValue({ ok: true, data: { ...created, isActive: false } });
    render(<ShareModal quote={QUOTE} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: '견적 공유 · Q-2026-0003' });
    expect(await within(dialog).findByText('아직 만든 공유 링크가 없습니다.')).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith({ quoteId: QUOTE.id });

    await userEvent.click(within(dialog).getByRole('button', { name: '새 공유 링크 만들기' }));
    expect(mocks.create).toHaveBeenCalledWith({ quoteId: QUOTE.id, expiresInDays: '30' });
    const list = within(dialog).getByRole('list', { name: '공유 링크 목록' });
    expect(await within(list).findByText(new RegExp(created.path))).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('공유 링크를 만들었습니다');

    await userEvent.click(within(list).getByRole('button', { name: '링크 복사' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(created.path),
    );
    expect(within(list).getByRole('link', { name: '열기' })).toHaveAttribute('href', created.path);

    await userEvent.click(within(list).getByRole('button', { name: /폐기$/ }));
    expect(mocks.revoke).toHaveBeenCalledWith({ shareId: created.id });
    // 폐기된 링크는 기본 숨김, 토글로 펼친다 (PR-8 QA INFO-5)
    expect(await within(dialog).findByText('살아 있는 공유 링크가 없습니다.')).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: '만료·폐기된 링크 1개 보기' }),
    );
    expect(await within(list).findByText(/폐기·만료됨/)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: '링크 복사' })).not.toBeInTheDocument();
  });

  it('만료일을 바꿔 만들 수 있고 Action 오류는 alert 로 보인다', async () => {
    mocks.list.mockResolvedValue({ ok: true, data: [share({ isActive: false })] });
    mocks.create.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: '다른 사용자의 견적입니다' },
    });
    render(<ShareModal quote={QUOTE} onClose={vi.fn()} />);
    expect(await screen.findByText('살아 있는 공유 링크가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '만료·폐기된 링크 1개 보기' })).toBeInTheDocument();
    const days = screen.getByLabelText('만료 (일)');
    await userEvent.clear(days);
    await userEvent.type(days, '7');
    await userEvent.click(screen.getByRole('button', { name: '새 공유 링크 만들기' }));
    expect(mocks.create).toHaveBeenCalledWith({ quoteId: QUOTE.id, expiresInDays: '7' });
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 사용자의 견적입니다');
  });
});
