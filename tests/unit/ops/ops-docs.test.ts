import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** AC-365: 런북 R-1~R-10(R-2 롤포워드 품목 재적용 점검 포함) · 체크리스트 C-1~C-18 이 문서에 있다 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const range = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

describe('운영 문서 (AC-365)', () => {
  it('docs/ops/runbook.md 에 R-1~R-10 절과 R-2 롤포워드 후 품목 재적용 점검', () => {
    const runbook = read('docs/ops/runbook.md');
    for (const id of range('R', 10)) expect(runbook).toMatch(new RegExp(`^## ${id} `, 'm'));
    const r2 = runbook.slice(runbook.indexOf('## R-2 '), runbook.indexOf('## R-3 '));
    expect(r2).toContain('롤포워드 후 점검');
    expect(r2).toContain('기존 파일 재사용');
  });

  it('docs/deploy/checklist.md 에 C-1~C-18 행', () => {
    const checklist = read('docs/deploy/checklist.md');
    const rows = new Set(
      checklist
        .split(/\r?\n/)
        .map((line) => /^\| (C-\d+) \|/.exec(line)?.[1])
        .filter(Boolean),
    );
    for (const id of range('C', 18)) expect(rows.has(id), id).toBe(true);
  });
});
