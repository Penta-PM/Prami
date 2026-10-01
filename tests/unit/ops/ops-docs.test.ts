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

/** PR #26 QA 반려 D-1~D-4 — 운영자가 문서를 그대로 따라 해도 거짓 통과·점검 해제·실행 불가가 없게 고정한다 */
describe('PR #26 D-1~D-4 운영 절차 회귀', () => {
  const runbook = read('docs/ops/runbook.md');
  const checklist = read('docs/deploy/checklist.md');
  const section = (text: string, from: string, to: string) =>
    text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from) + from.length));

  it('D-1 킬스위치 재배포는 deploy-production(maintenance 입력)으로만, 대시보드 Redeploy 는 금지', () => {
    const killSwitch = section(runbook, '### 0.3 ', '### 0.4 ');
    expect(killSwitch).toContain('`deploy-production` → **Run workflow**');
    expect(killSwitch).toContain('`maintenance`');
    expect(killSwitch).toMatch(/\*\*쓰지 않는다\*\*: Vercel 대시보드 \*\*Redeploy\*\*/);
    expect(killSwitch).toContain('자동 롤백하지 않는다');
    for (const step of ['## R-3 ', '## R-4 ']) {
      const body = section(runbook, step, '\n## R-');
      expect(body).toContain('deploy-production');
      expect(body).not.toMatch(/→ 재배포\./);
    }
  });

  it('D-3 R-2 에 롤포워드(Undo Rollback · vercel promote)가 롤포워드 후 점검보다 앞에 있다', () => {
    const r2 = section(runbook, '## R-2 ', '## R-3 ');
    const rollForward = r2.indexOf('**롤포워드 (PR #26 D-3)**');
    expect(rollForward).toBeGreaterThan(-1);
    expect(r2).toContain('Undo Rollback');
    expect(r2).toContain('vercel promote');
    expect(rollForward).toBeLessThan(r2.indexOf('롤포워드 후 점검'));
  });

  it('D-2 C-6 은 0건 통과가 불가능한 pnpm test:neon (vitest 프로젝트 neon, 건너뛰기 없음)', () => {
    const c6 = checklist.split(/\r?\n/).find((line) => line.startsWith('| C-6 |'))!;
    expect(c6).toContain('pnpm test:neon');
    expect(c6).not.toContain('--project neon');
    expect(JSON.parse(read('package.json')).scripts['test:neon']).toBe('vitest run --project neon');
    expect(read('vitest.config.mts')).toMatch(/name: 'neon'/);
    const neonTest = read('tests/neon/driver.neon.test.ts');
    expect(neonTest).not.toMatch(/\.skip(If)?\(|\.todo\(/);
    expect(neonTest).toContain('throw new Error(target.reason)');
  });

  it('D-4 C-18 preview 리허설은 Instant Rollback 이 아닌 별칭 재할당, production 리허설은 배포 직후 A-4', () => {
    const c18 = checklist.split(/\r?\n/).find((line) => line.startsWith('| C-18 |'))!;
    expect(c18).toContain('vercel alias set');
    expect(c18).toContain('production 전용');
    const rows = new Set(
      checklist
        .split(/\r?\n/)
        .map((line) => /^\| (A-\d+) \|/.exec(line)?.[1])
        .filter(Boolean),
    );
    expect([...rows]).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(checklist.split(/\r?\n/).find((line) => line.startsWith('| A-4 |'))).toContain(
      'Undo Rollback',
    );
  });
});
