import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  NO_COLLECTION_TEXT,
  ProcurementHeader,
  collectionRunNotice,
  collectionRunNoticeText,
  formatCollectedAt,
  type HeaderJobRun,
} from '@/features/procurement/ProcurementHeader';

/** 조달이 통합 UI-1 공용 머리: 제목 + 마지막 수집 시각(KST) + 데이터 기준 안내 */
describe('formatCollectedAt', () => {
  it('한국 시간 YYYY-MM-DD HH:mm (KST) — 자정 넘김·자정은 00 시', () => {
    expect(formatCollectedAt(new Date('2026-10-27T00:30:00Z'))).toBe('2026-10-27 09:30 (KST)');
    expect(formatCollectedAt(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01 00:00 (KST)');
  });

  it('null 이면 안내 문구', () => {
    expect(formatCollectedAt(null)).toBe('아직 수집 기록이 없습니다');
    expect(NO_COLLECTION_TEXT).toBe('아직 수집 기록이 없습니다');
  });
});

describe('ProcurementHeader', () => {
  it('제목(h1#page-title)·수집 시각(<time dateTime>)·데이터 기준을 렌더한다', () => {
    render(
      <ProcurementHeader
        title="조달 실적 현황"
        collectedAt={new Date('2026-10-27T00:30:00Z')}
        basis="합성 기준 안내"
        actions={<button type="button">내려받기</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: '조달 실적 현황' });
    expect(heading).toHaveAttribute('id', 'page-title');
    const time = screen.getByText('2026-10-27 09:30 (KST)');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-27T00:30:00.000Z');
    expect(screen.getByText('마지막 수집')).toBeInTheDocument();
    expect(screen.getByText('합성 기준 안내')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '내려받기' })).toBeInTheDocument();
  });

  it('수집 기록이 없으면 안내 문구, <time> 없음', () => {
    const { container } = render(
      <ProcurementHeader title="입찰 공고" collectedAt={null} basis="기준" />,
    );
    expect(screen.getByTestId('procurement-collected-at')).toHaveTextContent(
      '아직 수집 기록이 없습니다',
    );
    expect(container.querySelector('time')).toBeNull();
  });
});

/** 수집 상태 문구 (수집기 Prami 이전 §3.2) — daily·bids 를 함께 본다. 진행 중이 실패보다 우선 */
const run = (
  status: string | null,
  startedAt = '2026-10-28T00:05:00Z',
  lastSuccessAt: string | null = null,
): HeaderJobRun => ({
  lastRun: status ? { status, startedAt: new Date(startedAt) } : null,
  lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt) : null,
});

describe('collectionRunNotice', () => {
  it('기록 없음·성공뿐이면 문구 없음', () => {
    expect(collectionRunNotice([])).toBeNull();
    expect(collectionRunNotice([run(null), run('ok')])).toBeNull();
  });

  it('어느 작업이든 running 이면 "수집 중 (HH:mm 시작)" — 실패보다 우선, 가장 이른 시작 시각(KST)', () => {
    const notice = collectionRunNotice([
      run('failed', '2026-10-27T23:00:00Z', '2026-10-27T00:30:00Z'),
      run('running', '2026-10-28T01:30:00Z'),
    ]);
    expect(notice).toEqual({ kind: 'running', startedAt: new Date('2026-10-28T01:30:00Z') });
    expect(collectionRunNoticeText(notice!)).toBe('수집 중 (10:30 시작)');
    const both = collectionRunNotice([
      run('running', '2026-10-28T01:30:00Z'),
      run('running', '2026-10-27T15:05:00Z'),
    ]);
    // 자정 넘김: 15:05Z = 다음 날 00:05 KST
    expect(collectionRunNoticeText(both!)).toBe('수집 중 (00:05 시작)');
  });

  it('최근 실행 failed → "최근 수집 실패 · 마지막 성공 …"(실패한 작업들의 마지막 성공 중 이른 것)', () => {
    const notice = collectionRunNotice([
      run('failed', '2026-10-28T00:00:00Z', '2026-10-27T00:30:00Z'),
      run('ok', '2026-10-28T01:30:00Z', '2026-10-28T01:31:00Z'),
    ]);
    expect(collectionRunNoticeText(notice!)).toBe(
      '최근 수집 실패 · 마지막 성공 2026-10-27 09:30 (KST)',
    );
    const twoFailed = collectionRunNotice([
      run('failed', '2026-10-28T00:00:00Z', '2026-10-27T00:30:00Z'),
      run('failed', '2026-10-28T01:30:00Z', '2026-10-26T01:30:00Z'),
    ]);
    expect(collectionRunNoticeText(twoFailed!)).toBe(
      '최근 수집 실패 · 마지막 성공 2026-10-26 10:30 (KST)',
    );
  });

  it('실패한 작업에 성공 기록이 없으면 "마지막 성공 기록 없음"', () => {
    const notice = collectionRunNotice([
      run('failed'),
      run('ok', undefined, '2026-10-27T00:30:00Z'),
    ]);
    expect(collectionRunNoticeText(notice!)).toBe('최근 수집 실패 · 마지막 성공 기록 없음');
  });
});

describe('ProcurementHeader 수집 상태', () => {
  it('진행 중: 아이콘(aria-hidden) + 문구, 수집 시각 옆에 렌더', () => {
    render(
      <ProcurementHeader
        title="조달 관리"
        collectedAt={new Date('2026-10-27T00:30:00Z')}
        runs={[run('running', '2026-10-28T01:30:00Z'), run('failed')]}
        basis="기준"
      />,
    );
    const status = screen.getByTestId('procurement-collection-run');
    expect(status).toHaveTextContent('수집 중 (10:30 시작)');
    expect(status).toHaveAttribute('data-run', 'running');
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('수집 상태')).toHaveClass('sr-only');
  });

  it('실패: "최근 수집 실패 · 마지막 성공 …" 문구(색만으로 구분하지 않음)', () => {
    render(
      <ProcurementHeader
        title="입찰 공고"
        collectedAt={null}
        runs={[run('ok'), run('failed', undefined, '2026-10-27T00:30:00Z')]}
        basis="기준"
      />,
    );
    const status = screen.getByTestId('procurement-collection-run');
    expect(status).toHaveTextContent('최근 수집 실패 · 마지막 성공 2026-10-27 09:30 (KST)');
    expect(status).toHaveAttribute('data-run', 'failed');
    expect(status.querySelector('svg')).not.toBeNull();
  });

  it('runs 를 넘기지 않거나 모두 성공이면 상태 문구 없음', () => {
    const { rerender } = render(<ProcurementHeader title="t" collectedAt={null} basis="기준" />);
    expect(screen.queryByTestId('procurement-collection-run')).toBeNull();
    rerender(<ProcurementHeader title="t" collectedAt={null} runs={[run('ok')]} basis="기준" />);
    expect(screen.queryByTestId('procurement-collection-run')).toBeNull();
  });
});

describe('조달 라우트 로딩·오류 상태', () => {
  it('loading.tsx: aria-busy 자리 표시 + 상태 문구', async () => {
    const { default: Loading } = await import('@/app/(app)/procurement/loading');
    const { default: AdminLoading } = await import('@/app/(app)/admin/procurement/loading');
    for (const Component of [Loading, AdminLoading]) {
      const { unmount } = render(<Component />);
      expect(screen.getByLabelText('조달 화면 불러오는 중')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('status')).toHaveTextContent('불러오는 중');
      unmount();
    }
  });

  it('error.tsx: 경고·digest·다시 시도(reset)', async () => {
    const { default: RouteError } = await import('@/app/(app)/procurement/error');
    const { default: AdminRouteError } = await import('@/app/(app)/admin/procurement/error');
    for (const Component of [RouteError, AdminRouteError]) {
      const reset = vi.fn();
      const { unmount } = render(
        <Component error={Object.assign(new Error('내부'), { digest: 'abc123' })} reset={reset} />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('조달 화면을 불러오지 못했습니다');
      expect(screen.getByText('abc123')).toBeInTheDocument();
      expect(screen.queryByText('내부')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
      expect(reset).toHaveBeenCalledOnce();
      unmount();
    }
  });
});
