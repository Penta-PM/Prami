import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHART_GRAPHIC_TOKENS, OURS_TOKEN } from '@/features/procurement/charts/palette';

/**
 * Penta 디자인 토큰 (디자인 시스템 PR-1). globals.css 의 3층 구조를 검사한다.
 *   L1 `--penta-*` 원시값 = tests/fixtures/design-tokens/penta.css 기준표와 같은 이름·값 (첫 :root 블록)
 *   L2 의미 토큰(기존 이름 유지)·Maglo 원시 이름 별칭 = Penta L1 참조
 *   L3 `@theme inline` --color-* 유틸리티 별칭
 * 그리고 대비: 글자 AA 4.5:1, 그래픽(포커스·차트·체크박스 테두리) 3:1.
 */
const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'design-tokens', 'penta.css');
const EXPECTED_L1_COUNT = 65;

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

/** `header {` 로 시작하는 n번째(0부터) 블록 본문 (중첩 중괄호 없음을 전제) */
function extractBlock(css: string, header: string, nth = 0): string {
  let start = -1;
  for (let i = 0; i <= nth; i++) {
    start = css.indexOf(header, start + 1);
    if (start < 0) throw new Error(`${header} 블록(${nth})을 찾을 수 없습니다`);
  }
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const fixtureTokens = [
  ...parseDeclarations(stripComments(readFileSync(FIXTURE, 'utf8'))).entries(),
].map(([name, values]) => ({ name, value: values[0]! }));

const declarations = parseDeclarations(globalsCss);
const l1Names = new Set(parseDeclarations(extractBlock(globalsCss, ':root {', 0)).keys());
const themeStaticNames = new Set(
  parseDeclarations(extractBlock(globalsCss, '@theme static')).keys(),
);
const textRootNames = new Set(parseDeclarations(extractBlock(globalsCss, ':root {', 1)).keys());
const themeInline = parseDeclarations(extractBlock(globalsCss, '@theme inline'));

/** 이름 → 한 번만 정의된 값 */
function valueOf(name: string): string {
  const values = declarations.get(name);
  expect(values, `${name} 가 globals.css 에 없습니다`).toBeDefined();
  expect(values, `${name} 가 여러 번 정의되었습니다`).toHaveLength(1);
  return values![0]!;
}

/** var(--x) 를 따라가 #rrggbb 까지 해석 */
function resolveHex(name: string): string {
  const value = valueOf(name);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) return resolveHex(ref[1]!);
  expect(value, `${name} 는 #rrggbb 로 해석되어야 합니다`).toMatch(/^#[0-9a-f]{6}$/i);
  return value.toLowerCase();
}

const PALETTE_STEPS: Record<string, readonly number[]> = {
  primary: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
  neutral: [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
  success: [50, 500, 700, 800],
  warning: [50, 500, 700, 800],
  error: [50, 500, 700],
  info: [50, 500, 700],
};
const PALETTE = Object.entries(PALETTE_STEPS).flatMap(([family, steps]) =>
  steps.map((step) => `${family}-${step}`),
);

/** 디자인 시스템 문서(웹 §1)에 있는 값 — 보충값이 이 값을 덮지 않았는지 */
const DOC_COLORS: Record<string, string> = {
  'primary-50': '#ebf2ff',
  'primary-100': '#c2d9ff',
  'primary-500': '#1e6fff',
  'primary-600': '#1858cc',
  'primary-700': '#124199',
  'primary-900': '#061433',
  'neutral-0': '#ffffff',
  'neutral-50': '#f7f8fa',
  'neutral-100': '#eceef2',
  'neutral-200': '#d9dce3',
  'neutral-400': '#9aa1b0',
  'neutral-600': '#545d70',
  'neutral-900': '#111620',
  'success-500': '#22c55e',
  'success-700': '#15803d',
  'warning-500': '#f59e0b',
  'warning-700': '#b45309',
  'error-500': '#ef4444',
  'error-700': '#b91c1c',
  'info-500': '#3b82f6',
  'info-700': '#1d4ed8',
};

/** Maglo 원시 이름 → Penta 별칭 (docs/design/penta-tokens.md 별칭표와 같다) */
const MAGLO_ALIASES: Record<string, string> = {
  '--white': 'neutral-0',
  '--gray-50': 'neutral-50',
  '--gray-75': 'neutral-50',
  '--gray-100': 'neutral-100',
  '--gray-150': 'neutral-200',
  '--gray-200': 'neutral-100',
  '--slate-600': 'neutral-600',
  '--slate-700': 'neutral-400',
  '--ink-900': 'neutral-900',
  '--ink-950': 'neutral-800',
  '--purple-ink-900': 'primary-900',
  '--purple-ink-800': 'primary-900',
  '--purple-ink-700': 'primary-800',
  '--lime-400': 'primary-100',
  '--lime-500': 'primary-100',
  '--green-600': 'success-500',
  '--purple-500': 'primary-500',
  '--orange-500': 'warning-500',
  '--amber-500': 'warning-500',
  '--red-500': 'error-500',
  '--red-600': 'error-700',
  '--slate-700-aa': 'neutral-600',
  '--slate-600-aa': 'neutral-600',
  '--purple-600': 'primary-600',
  '--green-700': 'success-800',
  '--blue-600': 'primary-600',
  '--gray-600': 'neutral-600',
  '--amber-700': 'warning-800',
};

/** L2 의미 토큰 → 참조 대상 (--text-* 는 :root, 나머지는 @theme static) */
const SEMANTIC: Record<string, string> = {
  '--surface-page': 'var(--penta-neutral-0)',
  '--surface-sidebar': 'var(--penta-neutral-50)',
  '--surface-card': 'var(--penta-neutral-0)',
  '--surface-muted': 'var(--penta-neutral-50)',
  '--surface-inverse': 'var(--penta-neutral-900)',
  '--surface-accent-panel': 'var(--penta-primary-900)',
  '--surface-accent-panel-strong': 'var(--penta-primary-900)',
  '--surface-danger': 'color-mix(in srgb, var(--penta-error-500) 8%, var(--penta-neutral-0))',
  '--border-subtle': 'var(--penta-neutral-100)',
  '--border-default': 'var(--penta-neutral-200)',
  '--border-button': 'var(--penta-neutral-200)',
  '--border-accent-panel': 'var(--penta-primary-800)',
  '--border-danger': 'var(--penta-error-500)',
  '--accent-primary': 'var(--penta-primary-600)',
  '--accent-primary-strong': 'var(--penta-primary-700)',
  '--accent-positive': 'var(--penta-success-500)',
  '--accent-purple': 'var(--penta-primary-600)',
  '--accent-orange': 'var(--orange-500)',
  '--accent-amber': 'var(--penta-warning-500)',
  '--accent-red': 'var(--penta-error-500)',
  '--action-bg': 'var(--penta-primary-600)',
  '--action-bg-hover': 'var(--penta-primary-700)',
  '--action-fg': 'var(--penta-neutral-0)',
  '--focus-ring': 'var(--penta-primary-500)',
  '--danger-bg': 'var(--penta-error-700)',
  '--link': 'var(--penta-primary-600)',
  '--link-hover': 'var(--penta-primary-700)',
  '--text-primary': 'var(--penta-neutral-900)',
  '--text-secondary': 'var(--penta-neutral-600)',
  '--text-tertiary': 'var(--penta-neutral-600)',
  '--text-placeholder': 'var(--penta-neutral-600)',
  '--text-inverse': 'var(--penta-neutral-0)',
  '--text-on-accent': 'var(--penta-neutral-0)',
  '--text-danger': 'var(--penta-error-700)',
};

describe('L1 원시값 (globals.css ↔ penta.css 기준표)', () => {
  it(`기준표는 ${EXPECTED_L1_COUNT}개다`, () => {
    expect(fixtureTokens).toHaveLength(EXPECTED_L1_COUNT);
  });

  it.each(fixtureTokens)('$name = $value 가 L1 :root 에 한 번 정의된다', ({ name, value }) => {
    expect(valueOf(name)).toBe(value);
    expect(l1Names.has(name), `${name} 는 첫 :root(L1) 에 있어야 합니다`).toBe(true);
  });

  it('L1 :root 에는 --penta-* 만 있다', () => {
    for (const name of l1Names) expect(name).toMatch(/^--penta-/);
  });

  it('문서값 단계는 문서 hex 그대로다 (보충값이 덮지 않는다)', () => {
    for (const [step, hex] of Object.entries(DOC_COLORS))
      expect(resolveHex(`--penta-${step}`), step).toBe(hex);
  });

  it('Primary·Neutral 은 단계가 올라갈수록 어두워진다 (보충값이 순서를 뒤집지 않는다)', () => {
    for (const family of ['primary', 'neutral']) {
      const lums = PALETTE_STEPS[family]!.map((step) =>
        luminance(rgb(resolveHex(`--penta-${family}-${step}`))),
      );
      for (let i = 1; i < lums.length; i++)
        expect(lums[i]!, `${family} ${PALETTE_STEPS[family]![i]}`).toBeLessThan(lums[i - 1]!);
    }
  });
});

describe('L2 의미 토큰 · Maglo 별칭 · L3 유틸리티', () => {
  it.each(Object.entries(SEMANTIC))('%s → %s', (name, target) => {
    expect(valueOf(name)).toBe(normalize(target));
    if (name.startsWith('--text-')) {
      expect(textRootNames.has(name), `${name} 는 :root 에 (font-size 충돌 회피)`).toBe(true);
      expect(themeStaticNames.has(name)).toBe(false);
    } else {
      expect(themeStaticNames.has(name), `${name} 는 @theme static 에`).toBe(true);
    }
    expect(themeInline.get(`--color-${name.slice(2)}`)?.[0], `--color-${name.slice(2)}`).toBe(
      `var(${name})`,
    );
  });

  it.each(Object.entries(MAGLO_ALIASES))('Maglo %s → Penta %s (+ --color-* 별칭)', (name, step) => {
    expect(valueOf(name)).toBe(`var(--penta-${step})`);
    expect(themeStaticNames.has(name)).toBe(true);
    expect(themeInline.get(`--color-${name.slice(2)}`)?.[0]).toBe(`var(${name})`);
  });

  it('Penta 원시 팔레트는 전부 --color-<계열>-<단계> 유틸리티가 있다 (bg-primary-600 …)', () => {
    for (const step of PALETTE)
      expect(themeInline.get(`--color-${step}`)?.[0], step).toBe(`var(--penta-${step})`);
  });

  it('Maglo 원본 lime·purple·ink 색값이 globals.css 에 남지 않는다', () => {
    for (const old of ['#c8ee44', '#97f675', '#7b61ff', '#6c55e0', '#1b212d', '#1c1a2e', '#201e34'])
      expect(globalsCss.toLowerCase()).not.toContain(old);
  });

  it('기존 반경·간격 값은 그대로, Penta 반경·높이·그림자는 새 이름으로만 추가된다', () => {
    expect(valueOf('--radius-lg')).toBe('8px');
    expect(valueOf('--radius-xl')).toBe('10px');
    expect(valueOf('--radius-pill')).toBe('100px');
    expect(valueOf('--space-4')).toBe('8px');
    expect(valueOf('--radius-card')).toBe('var(--penta-radius-lg)');
    expect(valueOf('--radius-control')).toBe('var(--penta-radius-md)');
    expect(valueOf('--radius-modal')).toBe('var(--penta-radius-xl)');
    expect(valueOf('--height-control-sm')).toBe('36px');
    expect(valueOf('--height-control-md')).toBe('44px');
    expect(valueOf('--shadow-card')).toBe('var(--penta-shadow-md)');
    // Tailwind 기본 shadow-sm·md·lg·xl 유틸리티를 덮지 않는다
    for (const size of ['sm', 'md', 'lg', 'xl'])
      expect(declarations.has(`--shadow-${size}`)).toBe(false);
  });
});

describe('Pretendard 셀프 호스트', () => {
  const layout = readFileSync(path.join(ROOT, 'src', 'app', 'layout.tsx'), 'utf8');

  it('next/font/local 로 저장소의 가변 폰트를 싣고, 외부 CDN 을 부르지 않는다', () => {
    expect(layout).toContain("from 'next/font/local'");
    expect(layout).toContain("'./fonts/PretendardVariable.woff2'");
    expect(layout).toContain("variable: '--font-pretendard'");
    expect(layout).not.toMatch(/jsdelivr|<link/);
    expect(existsSync(path.join(ROOT, 'src', 'app', 'fonts', 'PretendardVariable.woff2'))).toBe(
      true,
    );
    expect(readFileSync(path.join(ROOT, 'src', 'app', 'fonts', 'OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    );
  });

  it('글꼴 토큰은 --font-pretendard 를 먼저 쓴다', () => {
    for (const name of ['--font-body', '--font-display'])
      expect(valueOf(name).startsWith("var(--font-pretendard,'Pretendard'),'Pretendard',")).toBe(
        true,
      );
  });
});

/* ── 대비 ─────────────────────────────────────────────────────────────── */

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(color: number[]): number {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** WCAG 2.x 상대 휘도 대비 */
function contrast(fg: number[], bg: number[]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}
const hex = (name: string): number[] => rgb(resolveHex(name));
/** fg 를 alpha 만큼 bg 위에 겹친 색 (bg-red-500/10 같은 틴트) */
const over = (fg: number[], bg: number[], alpha: number) =>
  fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha)));
const white = [255, 255, 255];

describe('글자 대비 AA 4.5:1 (Penta 값 기준)', () => {
  /** 밝은 화면 배경: 페이지·카드(흰색), 사이드바·입력·hover 띠(N50), 회색 배지(N100) */
  const lightBackgrounds = ['--surface-page', '--surface-muted', '--gray-75', '--gray-100'];

  it.each([
    '--text-primary',
    '--text-secondary',
    '--text-tertiary',
    '--text-placeholder',
    '--text-danger',
    '--link',
    '--link-hover',
    '--purple-600',
    '--blue-600',
    '--gray-600',
    '--green-700',
    '--amber-700',
  ])('%s 는 밝은 배경 전부에서 4.5:1 이상', (fg) => {
    for (const bg of lightBackgrounds)
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('채움 + 글자 짝: 주 동작·위험 동작·반전 패널·accent 위 글자', () => {
    const pairs: [string, string][] = [
      ['--action-fg', '--action-bg'],
      ['--action-fg', '--action-bg-hover'],
      ['--white', '--danger-bg'],
      ['--text-on-accent', '--accent-primary'],
      ['--text-inverse', '--surface-inverse'],
      ['--white', '--purple-600'], // Checkbox checked ✓
      ['--white', '--red-600'], // 알림·검토 대기 개수 배지
      ['--white', OURS_TOKEN], // "자사" 배지
      // lime 별칭(Primary 100) = 선택·강조 배경 + 어두운 글자, 어두운 패널 위 강조 글자
      ['--ink-900', '--lime-400'],
      ['--ink-900', '--lime-500'],
      ['--lime-500', '--ink-900'],
      ['--amber-500', '--ink-900'], // 어두운 패널 위 경고
      ['--ink-900', '--accent-orange'], // 임박 배지
      ['--ink-900', '--amber-500'], // 테스트 모드 배지
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('틴트 배지·안내 상자: X/10~15 배경 위 글자용 단계', () => {
    const cases: [string, string, number, number[]][] = [
      ['--green-700', '--green-600', 0.12, white],
      ['--amber-700', '--amber-500', 0.15, white],
      ['--amber-700', '--amber-500', 0.15, hex('--gray-75')],
      ['--red-600', '--red-500', 0.12, white],
      ['--red-600', '--red-500', 0.1, hex('--gray-75')], // 업로드 결과 상자 안 오류 상자 (BL-2)
      ['--purple-600', '--purple-500', 0.12, white],
      ['--purple-600', '--purple-600', 0.1, white], // [제안] 배지
      ['--text-primary', '--purple-600', 0.08, white], // 선택 행
      ['--slate-600-aa', '--purple-600', 0.08, white],
      ['--amber-700', '--lime-500', 0.25, white], // 강조 행(lime/25) 위 경고·상태 글자 (BL-1·BL-2)
      ['--blue-600', '--lime-500', 0.25, white],
      ['--gray-600', '--lime-500', 0.25, white],
    ];
    for (const [fg, tint, alpha, base] of cases)
      expect(
        contrast(hex(fg), over(hex(tint), base, alpha)),
        `${fg} on ${tint}/${alpha * 100}`,
      ).toBeGreaterThanOrEqual(4.5);
  });

  it('문서 Status Badge 짝(X-50 배경 + X-700 글자)은 4.5:1 이상', () => {
    for (const family of ['success', 'warning', 'error', 'info'])
      expect(
        contrast(hex(`--penta-${family}-700`), hex(`--penta-${family}-50`)),
        family,
      ).toBeGreaterThanOrEqual(4.5);
  });

  it('500 단계는 흰색 위 글자·흰 글자 배경으로 AA 미달 → 채움 장식·포커스·아이콘·그래픽 전용 (규칙의 근거)', () => {
    for (const family of ['primary', 'success', 'warning', 'error', 'info'])
      expect(contrast(white, hex(`--penta-${family}-500`)), family).toBeLessThan(4.5);
    // 그래서 성공·경고 글자 별칭은 700 이 아닌 보충값 800: 700 은 N100·15% 앰버 틴트 위 미달
    expect(contrast(hex('--penta-success-700'), hex('--gray-100'))).toBeLessThan(4.5);
    expect(
      contrast(hex('--penta-warning-700'), over(hex('--penta-warning-500'), white, 0.15)),
    ).toBeLessThan(4.5);
  });

  it('src 에 text-red-500(hover: 포함) 글자색이 없다 — 어두운 패널 위 빨간 글자도 없어 예외 없음', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          /\btext-red-500\b/.test(readFileSync(full, 'utf8'))
        )
          hits.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});

describe('그래픽 대비 3:1 (WCAG 1.4.11)', () => {
  it('포커스 고리(--focus-ring·purple-500)는 흰색·N50 위 3:1 이상, 고리 안쪽 선택 배경(lime 별칭)과도 3:1 이상', () => {
    for (const ring of ['--focus-ring', '--purple-500'])
      for (const bg of ['--surface-page', '--gray-75', '--lime-500'])
        expect(contrast(hex(ring), hex(bg)), `${ring} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('Checkbox 테두리 slate-600-aa 는 흰색·gray-75·선택 행 위 3:1 이상 — border-default(gray-150)는 미달이라 쓰지 않는다', () => {
    const selectedRow = over(hex('--purple-600'), white, 0.08);
    for (const bg of [white, hex('--gray-75'), selectedRow])
      expect(contrast(hex('--slate-600-aa'), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--gray-150'), white)).toBeLessThan(3);
    expect(contrast(hex('--purple-600'), hex('--gray-75'))).toBeGreaterThanOrEqual(3);
  });

  it('조달 차트 계열 색(자사·경쟁사·나머지·최근 연도)은 카드(흰색)·hover 띠(gray-75) 위 3:1 이상', () => {
    for (const token of CHART_GRAPHIC_TOKENS)
      for (const bg of [white, hex('--gray-75')])
        expect(contrast(hex(token), bg), token).toBeGreaterThanOrEqual(3);
  });

  it('--accent-ours 는 글자로도 쓴다(범례·표 머리글) — 흰색·gray-75 위 4.5:1 이상', () => {
    expect(contrast(hex(OURS_TOKEN), white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(OURS_TOKEN), hex('--gray-75'))).toBeGreaterThanOrEqual(4.5);
  });
});
