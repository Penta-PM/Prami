import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoticeDetailView } from '@/features/notices/types';

/** 홈 카드·공지 목록·공지 관리·상세 액션·검색 결과 컴포넌트 — Server Action·라우터는 모킹 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/',
}));
vi.mock('@/features/notices/actions', () => ({
  upsertNoticeAction: mocks.upsert,
  deleteNoticeAction: mocks.remove,
}));

const { ProductCards } = await import('@/features/home/ProductCards');
const { NoticeRows } = await import('@/features/notices/NoticeRows');
const { NoticesAdminTable } = await import('@/features/notices/NoticesAdminTable');
const { NoticeDetailActions } = await import('@/features/notices/NoticeDetailActions');
const { SearchResults } = await import('@/features/search/SearchResults');
const { excelRowOf } = await import('@/features/admin-policies/DuplicateWarningLists');

const NOTICES: NoticeDetailView[] = [
  {
    id: '11111111-0000-4000-8000-000000000001',
    title: '플랫폼 오픈 안내',
    authorName: '가격정책팀',
    isImportant: true,
    publishedAt: '2026-09-01',
    body: '본문 1',
  },
  {
    id: '11111111-0000-4000-8000-000000000002',
    title: '하반기 일정',
    authorName: '가격정책팀',
    isImportant: false,
    publishedAt: '2026-09-10',
    body: '본문 2',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProductCards (AC-50)', () => {
  it('제품 카드 4개 → /pricing?major=…, iSIGN PKI 카드는 없다 (Q-10)', () => {
    render(<ProductCards />);
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/pricing?major=WAPPLES',
      '/pricing?major=D.AMO',
      '/pricing?major=iSIGN',
      '/pricing?major=Cloudbric',
    ]);
    expect(screen.getByRole('link', { name: 'WAPPLES 가격 정책 보기' })).toBeInTheDocument();
    expect(screen.queryByText(/PKI/)).not.toBeInTheDocument();
  });
});

describe('NoticeRows', () => {
  it('중요 배지·제목·작성자·작성일, 상세 링크, 빈 목록 문구', () => {
    const { rerender } = render(<NoticeRows notices={NOTICES} variant="home" />);
    const rows = within(screen.getByRole('list', { name: '공지 목록' })).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', `/notices/${NOTICES[0]!.id}`);
    expect(rows[0]).toHaveTextContent('중요');
    expect(rows[0]).toHaveTextContent('플랫폼 오픈 안내');
    expect(rows[0]).toHaveTextContent('2026-09-01');
    expect(rows[1]).not.toHaveTextContent('중요');
    rerender(<NoticeRows notices={[]} />);
    expect(screen.getByText('등록된 공지가 없습니다.')).toBeInTheDocument();
  });
});

describe('NoticesAdminTable (AC-51)', () => {
  it('표 헤더·중요 표시, + 공지 등록 → 폼 오류 → 성공 status + refresh', async () => {
    mocks.upsert
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: '입력값을 확인하세요',
          fieldErrors: { title: ['제목을 입력하세요'] },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { id: 'n3', title: '새 공지' } });
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="픽스처 관리자" />);
    const table = screen.getByRole('table', { name: '공지 관리 표' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['제목', '작성일', '작성자', '중요', '관리']);
    expect(within(table).getAllByText('중요')).toHaveLength(2); // 헤더 + 배지 1개

    await userEvent.click(screen.getByRole('button', { name: '+ 공지 등록' }));
    const dialog = screen.getByRole('dialog', { name: '공지 등록' });
    expect(within(dialog).getByLabelText('작성자')).toHaveValue('픽스처 관리자');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByText('제목을 입력하세요')).toBeInTheDocument();
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      title: '',
      authorName: '픽스처 관리자',
      body: '',
      isImportant: false,
      publishedAt: '',
    });

    await userEvent.type(within(dialog).getByLabelText(/^제목/), '새 공지');
    await userEvent.type(within(dialog).getByLabelText(/^내용/), '내용입니다');
    await userEvent.click(within(dialog).getByLabelText('중요 공지로 표시'));
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent('등록했습니다: 새 공지');
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '새 공지', body: '내용입니다', isImportant: true }),
    );
    expect(mocks.upsert.mock.calls[1]![0]).not.toHaveProperty('id');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('수정 모달은 기존 값으로 채워지고 id 를 보낸다, 삭제 확인 → deleteNoticeAction', async () => {
    mocks.upsert.mockResolvedValue({
      ok: true,
      data: { id: NOTICES[1]!.id, title: '하반기 일정' },
    });
    mocks.remove.mockResolvedValue({
      ok: true,
      data: { id: NOTICES[0]!.id, title: '플랫폼 오픈 안내' },
    });
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="x" />);
    await userEvent.click(screen.getByRole('button', { name: '하반기 일정 수정' }));
    const dialog = screen.getByRole('dialog', { name: '공지 수정' });
    expect(within(dialog).getByLabelText(/^제목/)).toHaveValue('하반기 일정');
    expect(within(dialog).getByLabelText(/^내용/)).toHaveValue('본문 2');
    expect(within(dialog).getByLabelText('작성일')).toHaveValue('2026-09-10');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: NOTICES[1]!.id,
        title: '하반기 일정',
        publishedAt: '2026-09-10',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('수정했습니다');

    await userEvent.click(screen.getByRole('button', { name: '플랫폼 오픈 안내 삭제' }));
    const confirm = screen.getByRole('dialog', { name: '공지 삭제' });
    await userEvent.click(within(confirm).getByRole('button', { name: '삭제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ id: NOTICES[0]!.id });
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했습니다');
  });
});

describe('NoticeDetailActions', () => {
  it('삭제 성공 시 목록으로 이동, 실패 시 alert', async () => {
    mocks.remove
      .mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: '권한 없음' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'n', title: 't' } });
    render(<NoticeDetailActions notice={NOTICES[0]!} defaultAuthor="x" />);
    await userEvent.click(screen.getByRole('button', { name: '삭제' }));
    const confirm = screen.getByRole('dialog', { name: '공지 삭제' });
    await userEvent.click(within(confirm).getByRole('button', { name: '삭제' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('권한 없음');
    await userEvent.click(within(confirm).getByRole('button', { name: '삭제' }));
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/notices'));
  });
});

describe('SearchResults (AC-52)', () => {
  it('품목·공지 결과 그룹과 건수, 품목 → /pricing?q=품번', () => {
    render(
      <SearchResults
        result={{
          query: 'Wapples-500',
          items: [
            {
              itemCode: 'P10100015',
              itemName: 'Wapples-500 (H500 T2)',
              productFamily: 'WAPPLES',
              itemStatus: 'discarded',
            },
          ],
          notices: [NOTICES[0]!],
        }}
      />,
    );
    expect(screen.getByText(/검색 결과 2건/)).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: '품목 결과' })).getAllByRole('link');
    expect(items[0]).toHaveAttribute('href', '/pricing?q=P10100015');
    expect(items[0]).toHaveTextContent('폐기');
    expect(screen.getByRole('list', { name: '공지 목록' })).toHaveTextContent('플랫폼 오픈 안내');
  });

  it('검색어가 없으면 안내 문구', () => {
    render(<SearchResults result={{ query: '', items: [], notices: [] }} />);
    expect(screen.getByText(/상단 검색창에/)).toBeInTheDocument();
  });
});

describe('excelRowOf (PR-5 QA LOW-1)', () => {
  it('source_row + headerRowIndex + 1 = 엑셀 행 번호 (제목행 있는 원본: 380 → 382)', () => {
    expect(excelRowOf(380, 1)).toBe(382);
    expect(excelRowOf(1, 0)).toBe(2);
  });
});
