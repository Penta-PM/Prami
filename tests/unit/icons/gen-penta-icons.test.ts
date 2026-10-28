// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildPentaIconsSource,
  optimize,
  parseArgs,
  parseSvg,
  PENTA_ICON_ALLOWLIST,
} from '../../../scripts/gen-penta-icons';

/** 디자인 PR-3 아이콘 생성기 — 실제 라이브러리 대신 합성 픽스처(tests/fixtures/penta-icons)로 검사한다 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const library: { icons: Record<string, string> } = JSON.parse(
  readFileSync(path.join(ROOT, 'tests/fixtures/penta-icons/mini-library.json'), 'utf8'),
);

describe('buildPentaIconsSource', () => {
  const source = buildPentaIconsSource(library, ['square', 'shifted-dot']);

  it('allowlist 아이콘만 typed 맵으로, 생성 헤더(재생성 방법)·이름 타입을 포함한다', () => {
    expect(source).toContain('생성 파일 — 직접 고치지 마세요');
    expect(source).toContain('pnpm exec tsx scripts/gen-penta-icons.ts');
    expect(source).toContain("  'square': {");
    expect(source).toContain("  'shifted-dot': {");
    expect(source).not.toContain('colored');
    expect(source).toContain('export type PentaIconName = keyof typeof PENTA_ICONS;');
    expect(source).not.toMatch(/https?:\/\/|figma/i);
  });

  it('SVG 를 JSX 요소로 옮긴다 — 속성 camelCase, 원본 좌표·viewBox·transform 유지, 문자열 HTML 주입 없음', () => {
    expect(source).toContain("viewBox: '0 0 24 24'");
    expect(source).toContain('<g transform="translate(-100,0)">');
    expect(source).toContain('strokeLinecap="round"');
    expect(source).toContain('fillRule="evenodd"');
    expect(source).toContain('clipRule="evenodd"');
    expect(source).toContain('strokeMiterlimit="10"');
    expect(source).not.toMatch(/stroke-|fill-rule|dangerouslySetInnerHTML|innerHTML/);
    // 선 두께를 새로 넣지 않는다(원본 1px)
    expect(source).not.toContain('strokeWidth');
  });

  it('속성 없는 <g> 를 풀고 겹친 똑같은 path 는 하나만 남긴다', () => {
    const square = source.slice(source.indexOf("'square'"), source.indexOf("'shifted-dot'"));
    expect(square.match(/<path /g)).toHaveLength(1);
    expect(square).not.toContain('<g');
    expect(square).not.toContain('<>');
  });

  it('allowlist 에 있는데 라이브러리에 없으면 이름을 대며 실패한다', () => {
    expect(() => buildPentaIconsSource(library, ['square', 'nope', 'ghost'])).toThrow(
      /라이브러리에 없는 아이콘: nope, ghost/,
    );
    expect(() => buildPentaIconsSource({}, ['square'])).toThrow(/icons 객체가 없습니다/);
    expect(() => buildPentaIconsSource(library, ['square', 'square'])).toThrow(/중복/);
  });

  it('currentColor·none 이 아닌 색, 허용하지 않는 요소·속성은 실패한다', () => {
    expect(() => buildPentaIconsSource(library, ['colored'])).toThrow(/currentColor·none 만/);
    expect(() => buildPentaIconsSource(library, ['scripted'])).toThrow(
      /허용하지 않는 요소: <script>/,
    );
    expect(() => buildPentaIconsSource(library, ['handler'])).toThrow(
      /허용하지 않는 속성: onclick/,
    );
  });
});

describe('parseSvg·optimize', () => {
  it('루트가 svg 가 아니거나 닫히지 않으면 실패', () => {
    expect(() => parseSvg('x', '<g><path d="M0 0"/></g>')).toThrow(/루트는 <svg>/);
    expect(() => parseSvg('x', '<svg viewBox="0 0 24 24"><g>')).toThrow(/닫히지 않았습니다/);
    expect(() => parseSvg('x', '<svg viewBox="0 0 24 24">text</svg>')).toThrow(/태그 밖 내용/);
    expect(() => parseSvg('x', '<svg><path d="M0 0"/></svg>')).toThrow(/viewBox/);
  });

  it('빈 <g> 는 버리고, transform 이 다른 형제는 중복으로 보지 않는다', () => {
    const path = { tag: 'path', attrs: [['d', 'M0 0H1']] as [string, string][], children: [] };
    const nodes = optimize([
      { tag: 'g', attrs: [['transform', 'translate(1,0)']], children: [] },
      { tag: 'g', attrs: [['transform', 'translate(1,0)']], children: [path] },
      { tag: 'g', attrs: [['transform', 'translate(2,0)']], children: [path] },
      { tag: 'g', attrs: [['transform', 'translate(2,0)']], children: [path] },
    ]);
    expect(nodes).toHaveLength(2);
  });
});

describe('parseArgs·ALLOWLIST', () => {
  it('기본 입력은 저장소 루트의 design/pentaicon-library.json, 출력은 src/components/icons/penta.tsx', () => {
    expect(parseArgs([])).toEqual({
      input: path.join(ROOT, 'design/pentaicon-library.json'),
      output: path.join(ROOT, 'src/components/icons/penta.tsx'),
    });
    expect(parseArgs(['/abs/lib.json', '--out', 'tmp/out.tsx'])).toEqual({
      input: '/abs/lib.json',
      output: path.join(ROOT, 'tmp/out.tsx'),
    });
  });

  it('커밋된 생성 파일은 ALLOWLIST 와 같은 이름·순서를 갖는다 (재생성 누락 방지)', () => {
    const generated = readFileSync(path.join(ROOT, 'src/components/icons/penta.tsx'), 'utf8');
    const names = [...generated.matchAll(/^ {2}'?([a-z0-9-]+)'?: \{$/gm)].map((m) => m[1]);
    expect(names).toEqual([...PENTA_ICON_ALLOWLIST]);
    expect(generated).not.toMatch(/dangerouslySetInnerHTML|https?:\/\/|figma/i);
  });
});
