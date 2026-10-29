/**
 * Penta 아이콘 생성기 (디자인 PR-3, docs/design/penta-tokens.md "아이콘").
 *
 *   pnpm exec tsx scripts/gen-penta-icons.ts [라이브러리 JSON 경로] [--out 출력 경로]
 *
 * - 입력: Penta 아이콘 라이브러리 JSON(`{ icons: { 이름: "<svg …>…</svg>" } }`). 기본 `design/pentaicon-library.json`
 *   (저장소 루트 기준, `/design/` 은 gitignore — 원본은 커밋하지 않는다). 절대경로도 받는다.
 * - 출력: `src/components/icons/penta.tsx` — 아래 ALLOWLIST(실제로 쓰는 아이콘)만, SVG 를 JSX 요소로 옮긴 typed 맵.
 *   CI·앱은 생성 결과만 쓴다(JSON 불필요). 문자열 HTML 주입(dangerouslySetInnerHTML)은 쓰지 않는다.
 * - 변환: 원본 선 두께(1px)·viewBox·좌표 그대로. 속성 없는 <g> 는 풀고, 같은 부모 안의 똑같은 요소는 하나만 남긴다.
 * - 허용하지 않은 요소·속성·값, ALLOWLIST 에 있는데 라이브러리에 없는 이름은 즉시 실패한다(조용히 빠뜨리지 않음).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 화면에서 쓰는 Penta 아이콘 (매핑 표: docs/design/penta-tokens.md "아이콘"). 추가하면 생성기를 다시 돌린다 */
export const PENTA_ICON_ALLOWLIST = [
  'home',
  'calculator',
  'file-edit',
  'users',
  'search',
  'bell',
  'list',
  'eye',
  'eye-off',
  'file-log',
  'file-text',
  'chart-line',
  'message',
  'grid',
  'won-note',
  'blocks-2',
  'warning',
  'close',
  'chevron-right',
] as const;

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_INPUT = 'design/pentaicon-library.json';
const DEFAULT_OUTPUT = 'src/components/icons/penta.tsx';

/** 허용 요소 (그리기 요소만 — script·foreignObject·use·image 등은 거부) */
const ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);

/** 허용 속성 → JSX 이름. 이벤트 핸들러·href·style 등은 목록에 없으므로 거부된다 */
const ATTRIBUTES: Record<string, string> = {
  d: 'd',
  transform: 'transform',
  fill: 'fill',
  stroke: 'stroke',
  opacity: 'opacity',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'fill-opacity': 'fillOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x: 'x',
  y: 'y',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  width: 'width',
  height: 'height',
  points: 'points',
};

/** 색은 currentColor·none 만 (테마·토큰은 CSS color 로 준다) */
const PAINT_ATTRIBUTES = new Set(['fill', 'stroke']);
const PAINT_VALUES = new Set(['currentColor', 'none']);
/** 속성 값에 허용하는 글자 — 숫자·경로 명령·transform 함수·키워드. 따옴표·괄호 밖 URL·꺾쇠·중괄호는 거부 */
const SAFE_VALUE = /^[A-Za-z0-9 .,\-+()#%]*$/;

export type SvgNode = { tag: string; attrs: [string, string][]; children: SvgNode[] };
export type ParsedIcon = { viewBox: string; children: SvgNode[] };

const fail = (name: string, message: string): never => {
  throw new Error(`[gen-penta-icons] ${name}: ${message}`);
};

/** 라이브러리 SVG 문자열 하나를 트리로 (svg·g·도형만, 자식 텍스트·주석·CDATA 거부) */
export function parseSvg(name: string, source: string): ParsedIcon {
  const tokens = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let cursor = 0;
  for (const match of source.matchAll(tokens)) {
    const between = source.slice(cursor, match.index);
    if (between.trim() !== '')
      fail(name, `태그 밖 내용은 허용하지 않습니다: ${between.trim().slice(0, 40)}`);
    cursor = match.index + match[0].length;
    const [, closing, tag = '', rawAttrs = '', selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (!open || open.tag !== tag) fail(name, `닫는 태그가 맞지 않습니다: </${tag}>`);
      continue;
    }
    const attrs = [...rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(
      ([, key = '', value = '']) => [key, value] as [string, string],
    );
    const node: SvgNode = { tag, attrs, children: [] };
    if (stack.length === 0) {
      if (root) fail(name, '루트 요소가 둘 이상입니다');
      if (tag !== 'svg') fail(name, `루트는 <svg> 여야 합니다: <${tag}>`);
      root = node;
    } else {
      if (!ELEMENTS.has(tag)) fail(name, `허용하지 않는 요소: <${tag}>`);
      stack.at(-1)?.children.push(node);
    }
    if (!selfClosing) stack.push(node);
  }
  if (source.slice(cursor).trim() !== '') fail(name, '닫는 태그 뒤에 내용이 있습니다');
  if (!root || stack.length > 0) fail(name, '<svg> 가 닫히지 않았습니다');
  const svg = root as SvgNode;
  const rootAttrs = new Map(svg.attrs);
  const viewBox = rootAttrs.get('viewBox') ?? fail(name, 'viewBox 가 없습니다');
  if (!/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(viewBox)) fail(name, `viewBox 형식: ${viewBox}`);
  const rootFill = rootAttrs.get('fill');
  if (rootFill !== undefined && rootFill !== 'none')
    fail(name, `루트 fill 은 none 이어야 합니다: ${rootFill}`);
  for (const key of rootAttrs.keys()) {
    if (!['xmlns', 'width', 'height', 'viewBox', 'fill'].includes(key)) {
      fail(name, `루트 <svg> 의 허용하지 않는 속성: ${key}`);
    }
  }
  for (const child of svg.children) validate(name, child);
  return { viewBox, children: optimize(svg.children) };
}

function validate(name: string, node: SvgNode): void {
  for (const [key, value] of node.attrs) {
    if (!(key in ATTRIBUTES)) fail(name, `<${node.tag}> 의 허용하지 않는 속성: ${key}`);
    if (!SAFE_VALUE.test(value))
      fail(name, `<${node.tag} ${key}> 값에 허용하지 않는 글자: ${value}`);
    if (PAINT_ATTRIBUTES.has(key) && !PAINT_VALUES.has(value)) {
      fail(name, `<${node.tag} ${key}> 는 currentColor·none 만 허용합니다: ${value}`);
    }
  }
  node.children.forEach((child) => validate(name, child));
}

const serialize = (node: SvgNode): string =>
  `<${node.tag}${node.attrs.map(([k, v]) => ` ${k}="${v}"`).join('')}>${node.children
    .map(serialize)
    .join('')}</${node.tag}>`;

/** 속성 없는 <g> 를 풀고(그리기 결과 같음), 같은 부모 안의 똑같은 요소는 첫 번째만 남긴다(겹쳐 그리기 제거) */
export function optimize(nodes: SvgNode[]): SvgNode[] {
  const flat: SvgNode[] = [];
  for (const node of nodes) {
    const children = optimize(node.children);
    if (node.tag === 'g' && node.attrs.length === 0) flat.push(...children);
    else if (node.tag === 'g' && children.length === 0) continue;
    else flat.push({ ...node, children });
  }
  const seen = new Set<string>();
  return flat.filter((node) => {
    const key = serialize(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toJsx(node: SvgNode, indent: string): string {
  const attrs = node.attrs.map(([key, value]) => ` ${ATTRIBUTES[key]}="${value}"`).join('');
  if (node.children.length === 0) return `${indent}<${node.tag}${attrs} />`;
  const inner = node.children.map((child) => toJsx(child, `${indent}  `)).join('\n');
  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
}

function bodyJsx(children: SvgNode[]): string {
  const [only] = children;
  if (children.length === 1 && only) return toJsx(only, '      ');
  return `      <>\n${children.map((child) => toJsx(child, '        ')).join('\n')}\n      </>`;
}

/** 라이브러리 JSON 을 읽어 생성 파일 소스(포맷 전)를 만든다. allowlist 순서대로, 없는 이름은 실패 */
export function buildPentaIconsSource(library: unknown, allowlist: readonly string[]): string {
  const icons = (library as { icons?: unknown } | null)?.icons;
  if (!icons || typeof icons !== 'object' || Array.isArray(icons)) {
    throw new Error('[gen-penta-icons] 라이브러리 JSON 에 icons 객체가 없습니다');
  }
  const table = icons as Record<string, unknown>;
  const missing = allowlist.filter((name) => typeof table[name] !== 'string');
  if (missing.length > 0) {
    throw new Error(`[gen-penta-icons] 라이브러리에 없는 아이콘: ${missing.join(', ')}`);
  }
  if (new Set(allowlist).size !== allowlist.length) {
    throw new Error('[gen-penta-icons] allowlist 에 중복 이름이 있습니다');
  }
  const entries = allowlist.map((name) => {
    const icon = parseSvg(name, table[name] as string);
    if (icon.children.length === 0) fail(name, '그릴 요소가 없습니다');
    return `  '${name}': {\n    viewBox: '${icon.viewBox}',\n    body: (\n${bodyJsx(icon.children)}\n    ),\n  },`;
  });
  return `/**
 * 생성 파일 — 직접 고치지 마세요 (Penta 아이콘, 디자인 PR-3).
 * 다시 만들기: pnpm exec tsx scripts/gen-penta-icons.ts [라이브러리 JSON 경로]
 * 쓰는 아이콘을 늘리려면 scripts/gen-penta-icons.ts 의 PENTA_ICON_ALLOWLIST 에 이름을 더하고 다시 만든다.
 * 원본 선 두께(1px)·viewBox 그대로 — 렌더링은 src/components/icons/Icon.tsx(20·24px, aria) 로만 한다.
 */
import type { ReactElement } from 'react';

export type PentaIconDef = { viewBox: string; body: ReactElement };

export const PENTA_ICONS = {
${entries.join('\n')}
} satisfies Record<string, PentaIconDef>;

export type PentaIconName = keyof typeof PENTA_ICONS;
`;
}

async function format(source: string, filePath: string): Promise<string> {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(filePath)) ?? {};
  return prettier.format(source, { ...options, filepath: filePath });
}

export function parseArgs(argv: readonly string[]): { input: string; output: string } {
  let input = DEFAULT_INPUT;
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      output = argv[i + 1] ?? fail('args', '--out 뒤에 경로가 필요합니다');
      i += 1;
    } else input = argv[i] ?? input;
  }
  return { input: path.resolve(ROOT, input), output: path.resolve(ROOT, output) };
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const library: unknown = JSON.parse(readFileSync(input, 'utf8'));
  const source = await format(buildPentaIconsSource(library, PENTA_ICON_ALLOWLIST), output);
  writeFileSync(output, source);
  console.log(
    `[gen-penta-icons] ${PENTA_ICON_ALLOWLIST.length}개 → ${path.relative(ROOT, output)}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('gen-penta-icons')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
