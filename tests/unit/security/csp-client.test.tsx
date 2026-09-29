import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import RootError from '@/app/error';
import { parsePriceFilter } from '@/features/pricing/filter';

/**
 * CSP 회귀 (PR-11a QA M-1·L-1): 클라이언트 zod 파싱은 JIT(eval) 탐지를 하지 않고, 루트 오류 경계는 동적 레이아웃 안에서
 * 렌더되는 클라이언트 컴포넌트다 (정적 /_global-error 대신).
 */
describe('zod jitless (L-1)', () => {
  it('filter.ts 를 불러오면 zod 전역 설정이 jitless 이고, 파싱 중 Function 생성자를 부르지 않는다', () => {
    expect(z.config().jitless).toBe(true);
    const spy = vi.spyOn(globalThis, 'Function');
    parsePriceFilter({ q: 'Wapples', page: '2' });
    z.object({ a: z.string(), b: z.number() }).parse({ a: 'x', b: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('RootError (M-1)', () => {
  it('오류 코드(digest)와 다시 시도 버튼, 원문 메시지는 보이지 않는다', async () => {
    const reset = vi.fn();
    render(
      <RootError
        error={Object.assign(new Error('db password leaked?'), { digest: 'E123' })}
        reset={reset}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('화면을 불러오지 못했습니다');
    expect(screen.getByText('E123')).toBeInTheDocument();
    expect(screen.queryByText(/db password/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(reset).toHaveBeenCalled();
  });
});
