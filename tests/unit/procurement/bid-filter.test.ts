// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  BID_URGENT_DAYS,
  DEADLINE_TONE_CLASS,
  deadlineBadge,
  fitBadge,
  parseFitReason,
  reasonCounts,
  safeExternalUrl,
} from '@/features/procurement/bids/display';
import {
  DEFAULT_BID_FILTER,
  bidFilterToQuery,
  bidsHref,
  parseBidFilter,
} from '@/lib/procurement/bid-filter';
import { formatEokMan } from '@/lib/procurement/format';
import { normalizeViewQuery, toParams } from '@/server/page-state/normalize';

/**
 * 조달이 통합 UI-3 — 입찰 공고 순수 규칙: URL ↔ 조건(page_key procurement-bids 정규화와 같은 함수), D-day·적합도 배지,
 * 근거 부호, 외부 링크 허용 스킴, 예산·추정가 억·만, 배지 대비(4.5:1).
 */

describe('입찰 공고 URL 상태 (bid-filter)', () => {
  it('파라미터 없음 = 기본(전체·진행 중·적합도순·1페이지) ↔ 빈 쿼리', () => {
    expect(parseBidFilter({})).toEqual(DEFAULT_BID_FILTER);
    expect(bidFilterToQuery(DEFAULT_BID_FILTER)).toBe('');
    expect(bidsHref(DEFAULT_BID_FILTER)).toBe('/procurement/bids');
  });

  it('제품·마감 포함·상만·게시순·페이지를 읽고, 키 순서를 고정해 쓴다', () => {
    const filter = parseBidFilter(
      toParams('page=3&sort=posted&top=1&closed=1&product=D.AMO&unknown=x'),
    );
    expect(filter).toEqual({
      product: 'D.AMO',
      includeClosed: true,
      topGradeOnly: true,
      sort: 'posted',
      page: 3,
    });
    expect(bidFilterToQuery(filter)).toBe('?product=D.AMO&closed=1&top=1&sort=posted&page=3');
  });

  it('모르는 값·형식 밖 값은 기본값으로 버린다', () => {
    expect(
      parseBidFilter({
        product: '기타',
        closed: 'true',
        top: 'yes',
        sort: 'fit',
        page: ['0', '2'],
      }),
    ).toEqual(DEFAULT_BID_FILTER);
    expect(parseBidFilter({ page: '2.5' }).page).toBe(1);
    expect(parseBidFilter({ page: '10001' }).page).toBe(1);
    expect(parseBidFilter({ product: ['iSIGN', 'WAPPLES'] }).product).toBe('iSIGN');
  });

  it('왕복: 쓰고 다시 읽으면 같은 조건', () => {
    const filter = { ...DEFAULT_BID_FILTER, product: 'WAPPLES' as const, page: 2 };
    expect(parseBidFilter(toParams(bidFilterToQuery(filter)))).toEqual(filter);
  });

  it('page_key procurement-bids 정규화 = 같은 파서·직렬화 (USER·ADMIN 모두 procurement.read)', async () => {
    const db = {} as Db;
    expect(
      await normalizeViewQuery(db, { role: 'USER' }, 'procurement-bids', '?top=1&x=1&page=1'),
    ).toBe('top=1');
    expect(
      await normalizeViewQuery(db, { role: 'ADMIN' }, 'procurement-bids', 'closed=1&sort=posted'),
    ).toBe('closed=1&sort=posted');
    expect(await normalizeViewQuery(db, { role: 'USER' }, 'procurement-bids', 'page=2')).toBe(
      'page=2',
    );
  });
});

describe('마감 D-day 배지', () => {
  const deadlineAt = new Date('2026-11-01T08:00:00Z');

  it('마감 시각 없음 → 마감일 미표기', () => {
    expect(deadlineBadge({ deadlineAt: null, closed: false, daysLeft: null })).toEqual({
      text: '마감일 미표기',
      tone: 'none',
    });
  });

  it('마감 시각 없이 공고 후 14일이 지나 서버가 마감으로 본 공고 → "마감일 미표기" + 마감 색(D-day 빈칸 유지)', () => {
    expect(deadlineBadge({ deadlineAt: null, closed: true, daysLeft: null })).toEqual({
      text: '마감일 미표기',
      tone: 'closed',
    });
  });

  it('마감됨 → 마감 (오늘 이미 지난 마감도)', () => {
    expect(deadlineBadge({ deadlineAt, closed: true, daysLeft: -2 })).toEqual({
      text: '마감',
      tone: 'closed',
    });
    expect(deadlineBadge({ deadlineAt, closed: true, daysLeft: 0 }).text).toBe('마감');
  });

  it('오늘 마감·3일 이내 = 임박, 그 뒤는 D-n', () => {
    expect(deadlineBadge({ deadlineAt, closed: false, daysLeft: 0 })).toEqual({
      text: '오늘 마감',
      tone: 'urgent',
    });
    expect(deadlineBadge({ deadlineAt, closed: false, daysLeft: 1 })).toEqual({
      text: 'D-1 임박',
      tone: 'urgent',
    });
    expect(deadlineBadge({ deadlineAt, closed: false, daysLeft: BID_URGENT_DAYS })).toEqual({
      text: 'D-3 임박',
      tone: 'urgent',
    });
    expect(deadlineBadge({ deadlineAt, closed: false, daysLeft: 4 })).toEqual({
      text: 'D-4',
      tone: 'open',
    });
  });

  it('임박 배지는 --accent-orange 배경 토큰을 쓴다', () => {
    expect(DEADLINE_TONE_CLASS.urgent).toContain('bg-accent-orange');
    expect(DEADLINE_TONE_CLASS.urgent).toContain('text-ink-900');
  });
});

describe('적합도 배지 — 글자 + 색 + 점수', () => {
  it('등급 글자·점수·문장, 등급별 색', () => {
    expect(fitBadge('상', 87)).toEqual({
      grade: '상',
      score: '87점',
      tone: 'positive',
      label: '적합도 상, 87점',
    });
    expect(fitBadge('중', 55).tone).toBe('amber');
    expect(fitBadge('하', 0)).toMatchObject({ grade: '하', score: '0점', tone: 'neutral' });
  });

  it('등급 없음 = — (점수만 있으면 점수는 보인다)', () => {
    expect(fitBadge(null, null)).toEqual({
      grade: '—',
      score: null,
      tone: 'neutral',
      label: '적합도 없음',
    });
    expect(fitBadge(null, 40)).toMatchObject({ score: '40점', label: '적합도 등급 없음, 40점' });
  });
});

describe('근거 ＋/－', () => {
  it('전각·반각 부호를 읽고 문장만 남긴다', () => {
    expect(parseFitReason('＋ 공고명에 제품 키워드')).toEqual({
      sign: 'plus',
      text: '공고명에 제품 키워드',
    });
    expect(parseFitReason('+예산 충분')).toEqual({ sign: 'plus', text: '예산 충분' });
    expect(parseFitReason('－ 마감 임박')).toEqual({ sign: 'minus', text: '마감 임박' });
    expect(parseFitReason('-용역 공고')).toEqual({ sign: 'minus', text: '용역 공고' });
    expect(parseFitReason(' 참고 문장 ')).toEqual({ sign: 'none', text: '참고 문장' });
    expect(reasonCounts(['＋a', '+b', '－c', 'd'])).toEqual({ plus: 2, minus: 1 });
  });
});

describe('외부 링크 허용 스킴', () => {
  it('http(s) 만 링크, 나머지는 null', () => {
    expect(safeExternalUrl('https://example.invalid/bid?no=1')).toBe(
      'https://example.invalid/bid?no=1',
    );
    expect(safeExternalUrl('http://example.invalid/a')).toBe('http://example.invalid/a');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('/relative')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('예산·추정가 억·만 (formatEokMan)', () => {
  it('억·만·원·없음', () => {
    expect(formatEokMan(1_234_000_000)).toBe('12억 3,400만');
    expect(formatEokMan(300_000_000)).toBe('3억');
    expect(formatEokMan(45_670_000)).toBe('4,567만');
    expect(formatEokMan(5_000)).toBe('5,000원');
    expect(formatEokMan(null)).toBe('—');
  });
});

describe('배지 글자 대비 (WCAG AA 4.5:1)', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const hex = (name: string): number[] => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
    expect(match, `${name} 토큰`).not.toBeNull();
    const value = match![1]!;
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  };
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (fg: number[], bg: number[]) => {
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const white = [255, 255, 255];
  const over = (fg: number[], bg: number[], alpha: number) =>
    fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha)));

  it('임박: --accent-orange(=orange-500) 배경 위 ink-900 글자 4.5:1 이상 (흰 글자는 미달이라 쓰지 않는다)', () => {
    expect(css).toMatch(/--accent-orange:\s*var\(--orange-500\)/);
    const orange = hex('--orange-500');
    expect(contrast(hex('--ink-900'), orange)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, orange)).toBeLessThan(4.5);
  });

  it('적합도 상(green-700 on green/12)·중(amber-700 on amber/15)·진행 D-day(purple-600 on purple/12) 4.5:1 이상', () => {
    expect(contrast(hex('--green-700'), over(hex('--green-600'), white, 0.12))).toBeGreaterThan(
      4.5,
    );
    expect(contrast(hex('--amber-700'), over(hex('--amber-500'), white, 0.15))).toBeGreaterThan(
      4.5,
    );
    expect(contrast(hex('--purple-600'), over(hex('--purple-500'), white, 0.12))).toBeGreaterThan(
      4.5,
    );
    expect(contrast(hex('--slate-700-aa'), hex('--gray-100'))).toBeGreaterThan(4.5);
  });
});
