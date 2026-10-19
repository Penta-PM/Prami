import { describe, expect, it } from 'vitest';

import { appendSortParams, parseSortParams } from '@/lib/table/sort-param';

const IDS = ['name', 'price', 'effectiveFrom'] as const;

describe('parseSortParams (#32 §3 화이트리스트)', () => {
  it('허용된 id 와 방향을 그대로 받는다', () => {
    expect(parseSortParams({ sort: 'price', dir: 'desc' }, IDS)).toEqual({
      id: 'price',
      dir: 'desc',
    });
    expect(parseSortParams({ sort: 'name', dir: 'asc' }, IDS)).toEqual({ id: 'name', dir: 'asc' });
  });

  it('화이트리스트 밖·주입 시도·빈 값은 무시(undefined → 기본 정렬)', () => {
    expect(parseSortParams({ sort: 'id;drop', dir: 'asc' }, IDS)).toBeUndefined();
    expect(parseSortParams({ sort: 'id; drop table users;--' }, IDS)).toBeUndefined();
    expect(parseSortParams({ sort: 'Name' }, IDS)).toBeUndefined();
    expect(parseSortParams({ sort: '__proto__' }, IDS)).toBeUndefined();
    expect(parseSortParams({ sort: '' }, IDS)).toBeUndefined();
    expect(parseSortParams({ dir: 'desc' }, IDS)).toBeUndefined();
    expect(parseSortParams({}, IDS)).toBeUndefined();
    expect(parseSortParams({ sort: 'name' }, [])).toBeUndefined();
  });

  it('배열 값은 첫 값만 쓴다', () => {
    expect(parseSortParams({ sort: ['price', 'name'], dir: ['desc', 'asc'] }, IDS)).toEqual({
      id: 'price',
      dir: 'desc',
    });
    expect(parseSortParams({ sort: ['id;drop', 'price'] }, IDS)).toBeUndefined();
  });

  it('dir 이 없거나 asc|desc 가 아니면 asc', () => {
    expect(parseSortParams({ sort: 'price' }, IDS)).toEqual({ id: 'price', dir: 'asc' });
    expect(parseSortParams({ sort: 'price', dir: 'DESC' }, IDS)).toEqual({
      id: 'price',
      dir: 'asc',
    });
    expect(parseSortParams({ sort: 'price', dir: 'desc;drop' }, IDS)).toEqual({
      id: 'price',
      dir: 'asc',
    });
  });
});

describe('appendSortParams (sort·dir 는 맨 뒤)', () => {
  it('빈 쿼리 → ?sort=…&dir=…', () => {
    expect(appendSortParams('', { id: 'price', dir: 'desc' })).toBe('?sort=price&dir=desc');
  });

  it('기존 쿼리 맨 뒤에 붙인다', () => {
    expect(appendSortParams('?q=a&page=2', { id: 'name', dir: 'asc' })).toBe(
      '?q=a&page=2&sort=name&dir=asc',
    );
  });

  it('sort 가 없으면 그대로', () => {
    expect(appendSortParams('', undefined)).toBe('');
    expect(appendSortParams('?q=a', undefined)).toBe('?q=a');
  });

  it('parse 와 왕복한다', () => {
    const query = appendSortParams('?q=x', { id: 'effectiveFrom', dir: 'desc' });
    const params = Object.fromEntries(new URLSearchParams(query.slice(1)));
    expect(parseSortParams(params, IDS)).toEqual({ id: 'effectiveFrom', dir: 'desc' });
  });
});
