import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * AC-00: globals.css 의 CSS 변수가 디자인 토큰 원본(4파일)과 같은 이름·값으로 정의되는지 검증한다.
 * 원본은 tests/fixtures/design-tokens/ 에 그대로 보존되어 있다.
 */
const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'design-tokens');
const TOKEN_FILES = ['colors.css', 'typography.css', 'spacing.css', 'effects.css'] as const;
const EXPECTED_TOKEN_COUNT = 85;

const globalsCss = stripComments(
  readFileSync(path.join(ROOT, 'src', 'app', 'globals.css'), 'utf8'),
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 비교용 정규화: 공백 제거, 큰따옴표 → 작은따옴표 */
function normalize(value: string): string {
  return value.replace(/\s+/g, '').replace(/"/g, "'");
}

function parseDeclarations(css: string): Map<string, string[]> {
  const declarations = new Map<string, string[]>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1] as string;
    const value = normalize(match[2] as string);
    declarations.set(name, [...(declarations.get(name) ?? []), value]);
  }
  return declarations;
}

/** `header {` 로 시작하는 블록 본문을 돌려준다 (중첩 중괄호 없음을 전제) */
function extractBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start < 0) throw new Error(`${header} 블록을 찾을 수 없습니다`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const fixtureTokens = TOKEN_FILES.flatMap((file) => {
  const css = stripComments(readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
  return [...parseDeclarations(css)].map(([name, values]) => ({ file, name, value: values[0] }));
});

const globalsDeclarations = parseDeclarations(globalsCss);
const themeStaticNames = new Set(
  parseDeclarations(extractBlock(globalsCss, '@theme static')).keys(),
);
const rootNames = new Set(parseDeclarations(extractBlock(globalsCss, ':root')).keys());

describe('디자인 토큰 이식 (globals.css ↔ 원본 토큰 파일)', () => {
  it(`원본 토큰은 ${EXPECTED_TOKEN_COUNT}개다`, () => {
    expect(fixtureTokens).toHaveLength(EXPECTED_TOKEN_COUNT);
  });

  it.each(fixtureTokens)('$file: $name 이 같은 값으로 정의된다', ({ name, value }) => {
    const defined = globalsDeclarations.get(name);
    expect(defined, `${name} 가 globals.css 에 없습니다`).toBeDefined();
    expect(defined, `${name} 가 여러 번 정의되었습니다`).toHaveLength(1);
    expect(defined?.[0]).toBe(value);
  });

  it('--text-* 토큰은 :root 에, 나머지는 @theme static 에 있다 (A안)', () => {
    for (const { name } of fixtureTokens) {
      if (name.startsWith('--text-')) {
        expect(rootNames.has(name), `${name} 는 :root 에 있어야 합니다`).toBe(true);
        expect(themeStaticNames.has(name), `${name} 는 @theme 에 있으면 안 됩니다`).toBe(false);
      } else {
        expect(themeStaticNames.has(name), `${name} 는 @theme static 에 있어야 합니다`).toBe(true);
      }
    }
  });

  it('색상 팔레트에는 --color-* 별칭이 있다', () => {
    const paletteNames = fixtureTokens
      .filter(({ file, name }) => file === 'colors.css' && !name.startsWith('--shadow-'))
      .map(({ name }) => name);
    for (const name of paletteNames) {
      const alias = `--color-${name.slice(2)}`;
      expect(globalsDeclarations.get(alias)?.[0], `${alias} 별칭이 없습니다`).toBe(`var(${name})`);
    }
  });
});
