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
    const rollForward = r2.indexOf('**롤포워드 (PR #26 D-3·D3-N1)**');
    expect(rollForward).toBeGreaterThan(-1);
    expect(r2).toContain('Undo Rollback');
    expect(r2).toContain('vercel promote');
    expect(rollForward).toBeLessThan(r2.indexOf('롤포워드 후 점검'));
  });

  it('D3-N1 롤포워드 기본 경로 = 새(다른) 배포 promote — 이미 promote 된 지금 배포를 다시 promote 하라는 절차 없음, A-4 에 재promote 시도 기록', () => {
    const r2 = section(runbook, '## R-2 ', '## R-3 ');
    expect(r2).toContain('**다른(새) 배포를 promote**');
    expect(r2).toContain('promoting a different deployment');
    expect(r2).not.toMatch(
      /지금 서비스 중인\(되돌린\) 배포를 골라|promote <지금 production 배포 URL>/,
    );
    expect(r2).not.toContain('C-18 리허설에서 기록');
    const a4 = checklist.split(/\r?\n/).find((line) => line.startsWith('| A-4 |'))!;
    expect(a4).toContain('현재 배포 재promote 시도');
    expect(a4).toContain('Staged');
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

/** PR #26 S1-c — GitHub 플랜 전제조건이 문서에 있고, 현 플랜(Free)에서 설정할 수 없는 통제를 "필수" 로 적지 않는다 */
describe('PR #26 S1-c GitHub 플랜 문서', () => {
  const plan = read('docs/deploy/github-plan.md');
  const docs = ['docs/ops/runbook.md', 'docs/deploy/checklist.md', 'docs/deploy/vercel.md'].map(
    read,
  );

  it('플랜별(Free/Team/Enterprise) 가능·불가 표 · Free 남는 위험 · 업그레이드 절차 · Actions queued 확인 방법', () => {
    expect(plan).toMatch(/\| 기능 \| Free \| Team \| Enterprise Cloud \|/);
    for (const row of [
      'Environment 시크릿',
      'Required reviewers',
      'Deployment branches',
      '브랜치 보호',
      'CODEOWNERS',
    ]) {
      expect(plan).toContain(row);
    }
    expect(plan).toContain('### 3.2 남는 위험');
    expect(plan).toContain('### 4.1 Team');
    expect(plan).toContain('### 4.2 Enterprise Cloud');
    expect(plan).toContain('## 5. Actions 가 queued 로 멈춘 원인 확인');
    expect(plan).toContain('Billing & licensing');
  });

  it('runbook·checklist·vercel.md 가 github-plan.md 를 가리키고, preview-smoke Environment·승인 2회·deployment_status 트리거 서술이 남지 않는다', () => {
    for (const doc of docs) expect(doc).toContain('github-plan.md');
    for (const doc of docs) {
      expect(doc).not.toMatch(/Environment `preview-smoke`|\*\*두 번\*\* 한다|Sensitive 로 두지/);
    }
    expect(read('docs/deploy/vercel.md')).not.toMatch(/Vercel `deployment_status`\(success/);
  });
});
