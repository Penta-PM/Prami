import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 클릭 커서 (UX PR-U1 §2): globals.css @layer base 의 전역 규칙을 문자열로 검사한다.
 * 실제 계산된 커서(hover)는 E2E(shell.spec) 가 본다 — jsdom 은 @layer·:where 를 계산하지 않는다.
 */
const css = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, '')
  .replace(/"/g, "'");

const POINTER_SELECTOR =
  ":where(button,[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='switch'],summary,a[href],label[for],select," +
  "input:is([type='checkbox'],[type='radio'],[type='range'],[type='file'],[type='color'],[type='submit'],[type='button'])," +
  "[data-clickable]):not(:disabled,[aria-disabled='true'])";

/** `@layer base { … }` 블록들의 본문 (중괄호 짝 맞춤) */
function baseLayerBodies(source: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  while ((from = source.indexOf('@layerbase{', from)) !== -1) {
    const start = from + '@layerbase{'.length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
    }
    bodies.push(source.slice(start, i - 1));
    from = i;
  }
  return bodies;
}

describe('globals.css 클릭 커서 (UX PR-U1 §2)', () => {
  const base = baseLayerBodies(css).join('');

  it('클릭 가능한 요소 전체 목록에 pointer — @layer base 안, :where(명시도 0), 비활성 제외', () => {
    expect(base).toContain(`${POINTER_SELECTOR}{cursor:pointer;}`);
  });

  it('비활성(:disabled·aria-disabled=true)은 not-allowed', () => {
    expect(base).toContain(":where(:disabled,[aria-disabled='true']){cursor:not-allowed;}");
  });

  it('텍스트 입력은 목록에 없다 (브라우저 기본 text 커서)', () => {
    for (const type of ['text', 'search', 'email', 'number', 'password'])
      expect(POINTER_SELECTOR).not.toContain(`[type='${type}']`);
    expect(POINTER_SELECTOR).not.toMatch(/textarea/);
  });

  it('범위 슬라이더 thumb 의 grab 은 components 층에 그대로 (base 보다 우선)', () => {
    expect(css).toContain(
      '.range-slider-input::-webkit-slider-thumb{appearance:none;pointer-events:auto;cursor:grab;',
    );
    expect(css).toContain(
      '.range-slider-input:disabled::-webkit-slider-thumb{cursor:not-allowed;}',
    );
    expect(base).not.toContain('range-slider');
  });
});
