import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementAppState, procurementBidKeywords } from '@/db/schema/procurement';
import type { SessionUser } from '@/server/auth/session-user';

import { createTestDb } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-8 — 키워드 관리 RSC 섹션(KeywordsAdminSection): write 토큰으로 PGlite 에서 키워드 + 마지막 확인 시각을 읽어
 * 칩 편집기에 넘긴다(Plan msg_9f2035d66cd8 — 탭 내용은 서버에서, 마운트 시 Server Action 조회 없음). 합성 키워드만.
 */
const state = vi.hoisted(() => ({ handle: undefined as DbHandle | undefined }));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  addBidKeywordAction: vi.fn(),
  deleteBidKeywordAction: vi.fn(),
}));
vi.mock('@/features/procurement/admin/keywords/actions', () => actions);

const { KeywordsAdminSection } =
  await import('@/features/procurement/admin/keywords/KeywordsAdminSection');
const { procurementAccessForTests } = await import('@/server/procurement/access-token');

const USER = { id: null, email: 'admin@example.invalid', role: 'ADMIN' } as unknown as SessionUser;

beforeAll(async () => {
  state.handle = await createTestDb();
  await state.handle.db.insert(procurementBidKeywords).values([
    { product: 'iSIGN', keyword: '가상 통합인증', createdBy: '기본' },
    { product: '제외', keyword: '가상 제외어', createdBy: 'someone@example.invalid' },
  ]);
  await state.handle.db
    .insert(procurementAppState)
    .values({ key: 'bids.last_checked', value: '2026-10-20T01:30:00.000Z' });
});

afterAll(async () => {
  await state.handle?.close();
});

describe('KeywordsAdminSection (RSC)', () => {
  it('서버에서 읽은 키워드·마지막 확인 시각을 렌더한다', async () => {
    const access = procurementAccessForTests({ id: null, email: USER.email }, 'write');
    render(await KeywordsAdminSection({ params: { tab: 'keywords' }, access, user: USER }));
    expect(screen.getByTestId('procurement-keywords-last-checked')).toHaveTextContent(
      '2026-10-20 10:30 (KST)',
    );
    expect(
      within(screen.getByRole('group', { name: 'iSIGN' })).getByRole('button', {
        name: '가상 통합인증 삭제',
      }),
    ).toBeInTheDocument();
    const excluded = within(screen.getByRole('group', { name: '제외 단어' })).getByRole('listitem');
    expect(excluded).toHaveAttribute('title', '추가: someone');
    expect(
      within(screen.getByRole('group', { name: 'WAPPLES' })).getByText('키워드 없음'),
    ).toBeVisible();
  });

  it('read 토큰으로는 섹션을 읽을 수 없다', async () => {
    await expect(
      KeywordsAdminSection({ params: {}, access: procurementAccessForTests(), user: USER }),
    ).rejects.toThrow('write 범위');
  });
});
