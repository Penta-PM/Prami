import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ColumnFilterDef } from '@/lib/table/filter';

import { navigation } from '../../helpers/next-navigation';

/** 클라이언트 표 URL 상태 (표 열 필터 스펙 §2.2): f.* 파싱·router.replace·page 제거·sort/dir 맨 뒤 */
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);

const { useUrlFilters, useStateFilters } = await import('@/components/ui/data-table');

const DEFS: Record<string, ColumnFilterDef> = {
  name: { kind: 'text' },
  role: {
    kind: 'enum',
    options: [
      { value: 'ADMIN', label: 'ADMIN' },
      { value: 'USER', label: 'USER' },
    ],
  },
};

type FilterApi = ReturnType<typeof useUrlFilters>;
/** 마지막 렌더의 훅 반환값 — Probe 가 렌더마다 콜백으로 넘긴다 */
const latest: { api?: FilterApi } = {};
const keep = (api: FilterApi) => {
  latest.api = api;
};
const api = () => latest.api as FilterApi;

function Probe({ onRender = keep }: { onRender?: (api: FilterApi) => void }) {
  const result = useUrlFilters(DEFS);
  onRender(result);
  return <output>{JSON.stringify(result.filters)}</output>;
}

const replaced = () => {
  const [href, options] = navigation.replace.mock.lastCall as unknown as [string, unknown];
  const [path, query = ''] = href.split('?');
  return {
    path,
    keys: [...new URLSearchParams(query).keys()],
    params: new URLSearchParams(query),
    options,
  };
};

beforeEach(() => {
  navigation.reset();
});

describe('useUrlFilters', () => {
  it('URL 의 f.* 를 화이트리스트로 파싱한다 — 모르는 열·연산자·잘못된 enum 은 버림', () => {
    navigation.reset(
      '/admin/parts',
      'family=WAPPLES&f.name.has=abc&f.bogus.has=x&f.name.like=y&f.role.in=ADMIN,ROOT&page=2',
    );
    render(<Probe />);
    expect(api().filters).toEqual([{ col: 'name', op: 'has', value: 'abc' }]);
  });

  it('적용: router.replace(경로 + 쿼리, scroll:false) — 다른 파라미터 유지, page 제거, sort·dir 맨 뒤', () => {
    navigation.reset('/admin/parts', 'family=WAPPLES&sort=name&dir=desc&page=3&f.name.has=old');
    render(<Probe />);
    act(() =>
      api().setFilters([
        { col: 'name', op: 'eq', value: 'a b' },
        { col: 'role', op: 'in', values: ['ADMIN', 'USER'] },
      ]),
    );
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.push).not.toHaveBeenCalled();
    const { path, keys, params, options } = replaced();
    expect(path).toBe('/admin/parts');
    expect(options).toEqual({ scroll: false });
    expect(keys).toEqual(['family', 'f.name.eq', 'f.role.in', 'sort', 'dir']);
    expect(params.get('f.name.eq')).toBe('a b');
    expect(params.get('f.role.in')).toBe('ADMIN,USER');
    // 바뀐 URL 이 다시 읽힌다
    expect(screen.getByRole('status')).toHaveTextContent('"op":"eq"');
  });

  it('모두 해제하면 f.* 만 지운다 (탭 유지), 쿼리가 비면 경로만', () => {
    navigation.reset('/admin/parts', 'family=WAPPLES&f.name.has=x');
    render(<Probe />);
    act(() => api().setFilters([]));
    expect(navigation.replace).toHaveBeenLastCalledWith('/admin/parts?family=WAPPLES', {
      scroll: false,
    });
    act(() => navigation.reset('/admin/users', 'f.name.has=x'));
    act(() => api().setFilters([]));
    expect(navigation.replace).toHaveBeenLastCalledWith('/admin/users', { scroll: false });
  });
});

describe('useStateFilters (모달 — URL 미사용)', () => {
  it('상태로만 바뀌고 router 를 부르지 않는다', () => {
    const holder: { state?: ReturnType<typeof useStateFilters> } = {};
    const hold = (value: ReturnType<typeof useStateFilters>) => {
      holder.state = value;
    };
    function StateProbe({ onRender }: { onRender: typeof hold }) {
      onRender(useStateFilters());
      return null;
    }
    render(<StateProbe onRender={hold} />);
    act(() => holder.state?.setFilters([{ col: 'name', op: 'has', value: 'a' }]));
    expect(holder.state?.filters).toEqual([{ col: 'name', op: 'has', value: 'a' }]);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
