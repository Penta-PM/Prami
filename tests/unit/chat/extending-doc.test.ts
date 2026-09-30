// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * AC-245 확장 가이드 문서-코드 일치: docs/chat/extending.md 의 `<!-- include: 경로 -->` 바로 아래 코드 블록이
 * 그 파일 내용과 같다. §4.3.6 의 7단계 제목이 모두 있다.
 */
const doc = readFileSync('docs/chat/extending.md', 'utf8').replace(/\r\n/g, '\n');

function includedBlocks(): { path: string; code: string }[] {
  const pattern = /<!-- include: (\S+) -->\n```ts\n([\s\S]*?)\n```/g;
  return [...doc.matchAll(pattern)].map((match) => ({ path: match[1]!, code: match[2]! }));
}

describe('docs/chat/extending.md (AC-245)', () => {
  it('예제 기능·테스트 예제 코드가 실제 파일과 같다', () => {
    const blocks = includedBlocks();
    expect(blocks.map((block) => block.path)).toEqual([
      'tests/fixtures/chat/sample-feature.ts',
      'tests/unit/chat/sample-feature.example.test.ts',
    ]);
    for (const block of blocks) {
      const file = readFileSync(block.path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
      expect(block.code).toBe(file);
    }
  });

  it('§4.3.6 7단계가 모두 있다', () => {
    for (const step of [
      '범위 확인',
      '기능 파일',
      '등록',
      '테스트',
      '규칙 폴백',
      '스트리밍 진행 표시',
      'PR 본문',
    ]) {
      expect(doc).toContain(`**${step}`);
    }
  });
});
