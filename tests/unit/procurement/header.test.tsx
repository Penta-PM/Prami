import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  NO_COLLECTION_TEXT,
  ProcurementHeader,
  formatCollectedAt,
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
