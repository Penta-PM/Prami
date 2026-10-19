import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoticeDetailView } from '@/features/notices/types';

/** #32 PR-2: 공지 관리 표가 공용 DataTable(클라이언트 정렬)로 동작한다 — Server Action·라우터는 모킹 */
vi.mock('@/features/notices/actions', () => ({
  upsertNoticeAction: vi.fn(),
  deleteNoticeAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/notices',
  useSearchParams: () => new URLSearchParams(),
}));

const { NoticesAdminTable } = await import('@/features/notices/NoticesAdminTable');

const notice = (
  patch: Partial<NoticeDetailView> & Pick<NoticeDetailView, 'id' | 'title'>,
): NoticeDetailView => ({
  authorName: '가격정책팀',
  isImportant: false,
  publishedAt: '2026-09-01',
  body: '본문',
  ...patch,
});

// 기본 순서(서버 정렬)를 일부러 어느 열 순서와도 다르게 둔다
const NOTICES: NoticeDetailView[] = [
  notice({ id: 'n1', title: '나 공지', publishedAt: '2026-09-10', authorName: '영업팀' }),
  notice({ id: 'n2', title: '가 공지', publishedAt: '', isImportant: true, authorName: 'Admin' }),
  notice({ id: 'n3', title: '다 공지', publishedAt: '2026-08-31', authorName: 'admin2' }),
  notice({ id: 'n4', title: '라 공지', publishedAt: '2026-09-02', isImportant: true }),
];

const table = () => screen.getByRole('table', { name: '공지 관리 표' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const titles = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const DEFAULT = ['나 공지', '가 공지', '다 공지', '라 공지'];

const renderTable = () =>
  render(<NoticesAdminTable notices={NOTICES} defaultAuthor="관리자" userId="u1" />);

beforeEach(() => {
  localStorage.clear();
});

describe('NoticesAdminTable (DataTable)', () => {
  it('기본 헤더 순서는 그대로다', () => {
    renderTable();
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['제목', '작성일', '작성자', '중요', '관리']);
    expect(titles()).toEqual(DEFAULT);
  });

  it('제목: aria-sort 오름 → 내림 → 없음, 순서가 기본으로 돌아온다', async () => {
    renderTable();
    const button = within(th('제목')).getByRole('button');
    await userEvent.click(button);
    expect(th('제목')).toHaveAttribute('aria-sort', 'ascending');
    expect(titles()).toEqual(['가 공지', '나 공지', '다 공지', '라 공지']);
    await userEvent.click(button);
    expect(th('제목')).toHaveAttribute('aria-sort', 'descending');
    expect(titles()).toEqual(['라 공지', '다 공지', '나 공지', '가 공지']);
    await userEvent.click(button);
    expect(th('제목')).not.toHaveAttribute('aria-sort');
    expect(titles()).toEqual(DEFAULT);
  });

  it('작성일은 날짜순이고 빈 값은 방향과 관계없이 맨 뒤', async () => {
    renderTable();
    const button = within(th('작성일')).getByRole('button');
    await userEvent.click(button);
    expect(titles()).toEqual(['다 공지', '라 공지', '나 공지', '가 공지']);
    await userEvent.click(button);
    expect(titles()).toEqual(['나 공지', '라 공지', '다 공지', '가 공지']);
  });

  it('작성자는 ASCII 대소문자 무시 코드포인트 순, 중요는 중요 → 일반 (stable)', async () => {
    renderTable();
    await userEvent.click(within(th('작성자')).getByRole('button'));
    expect(titles()).toEqual(['가 공지', '다 공지', '라 공지', '나 공지']);
    await userEvent.click(within(th('중요')).getByRole('button'));
    expect(titles()).toEqual(['가 공지', '라 공지', '나 공지', '다 공지']);
    await userEvent.click(within(th('중요')).getByRole('button'));
    expect(titles()).toEqual(['나 공지', '다 공지', '가 공지', '라 공지']);
  });

  it("관리 열은 정렬 버튼·aria-sort 가 없고, '열 초기화'는 기본 상태에서 비활성이다", () => {
    renderTable();
    expect(within(th('관리')).queryByRole('button')).toBeNull();
    expect(th('관리')).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it('열 이동은 사용자별 키에 저장되고 열 초기화로 기본 순서로 돌아온다', async () => {
    renderTable();
    within(th('제목')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(localStorage.getItem('prami:table:notices-admin:v1:u1')).not.toBeNull();
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['작성일', '제목', '작성자', '중요', '관리']);
    await userEvent.click(screen.getByRole('button', { name: '열 초기화' }));
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['제목', '작성일', '작성자', '중요', '관리']);
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });
});
