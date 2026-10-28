import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PENTA_COLORS } from '@/lib/design/penta-colors';

/**
 * Penta 색 JS 상수(React-PDF 등 CSS 변수를 못 쓰는 곳 전용, Penta 디자인 PR-5)는 globals.css L1 `--penta-*` 과 같은 값이다.
 * 한쪽만 바꾸면 실패한다 — 견적서 PDF 색이 화면 토큰과 어긋나지 않게.
 */
const css = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const l1Colors = new Map(
  [
    ...css.matchAll(/--penta-((?:primary|neutral|success|warning|error|info)-\d+)\s*:\s*([^;]+);/g),
  ].map((match) => [match[1]!, match[2]!.trim().toLowerCase()]),
);

describe('PENTA_COLORS ↔ globals.css L1', () => {
  it.each(Object.entries(PENTA_COLORS))('%s = %s 가 --penta-%s 와 같다', (name, value) => {
    expect(l1Colors.get(name), `--penta-${name}`).toBe(value);
  });

  it('globals.css 의 L1 색은 빠짐없이 상수에 있다', () => {
    expect([...l1Colors.keys()].sort()).toEqual(Object.keys(PENTA_COLORS).sort());
  });

  it('값은 소문자 #rrggbb (React-PDF 가 그대로 읽는 형식)', () => {
    for (const value of Object.values(PENTA_COLORS)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
