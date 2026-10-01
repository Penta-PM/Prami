// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * AC-362 워크플로 정적 검사 (PRAMI-003 §4.3.1·§4.3.6). actionlint 는 로컬 `docker run rhysd/actionlint` 로 별도 실행한다.
 * deploy-production: environment production · 순서(마이그레이션 → 빌드 → 배포 → 스모크 → 실패 시 롤백) · 마이그레이션 실패 시 배포 미실행 ·
 * 시크릿은 secrets.* 로만 · run: 에 시크릿 echo 없음 · concurrency 그룹 · main 에서만.
 */
type Step = { name?: string; run?: string; env?: Record<string, string>; uses?: string };
type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

const ROOT = path.resolve(import.meta.dirname, '../../..');
const raw = (name: string) => readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8');
const load = (name: string) => parse(raw(name)) as Workflow;
const needsOf = (job: Job) => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);
const SECRET_NAMES = [
  'DATABASE_URL_UNPOOLED',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
];

describe('deploy-production.yml (AC-362)', () => {
  const workflow = load('deploy-production.yml');
  const { migrate, deploy, smoke, rollback } = workflow.jobs;

  it('main push(+수동)만, 모든 잡이 main 에서만 실행', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(workflow.on.push).toEqual({ branches: ['main'] });
    for (const name of ['migrate', 'deploy', 'smoke']) {
      expect(workflow.jobs[name]!.if).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it('시크릿을 받는 잡은 environment: production (승인 필요)', () => {
    for (const job of [migrate, deploy]) expect(job!.environment).toBe('production');
    // 롤백은 승인 대기 없이 — Vercel 시크릿만 가진 별도 Environment (보안 리뷰 L-2)
    expect(rollback!.environment).toBe('production-rollback');
  });

  it('순서: 마이그레이션 → 빌드 → 배포 → 스모크 → 실패 시 롤백 (needs 사슬)', () => {
    expect(needsOf(migrate!)).toEqual([]);
    expect(needsOf(deploy!)).toEqual(['migrate']);
    expect(needsOf(smoke!)).toEqual(['deploy']);
    expect(needsOf(rollback!).sort()).toEqual(['deploy', 'smoke']);
    const deployRuns = deploy!.steps.map((step) => step.run ?? '');
    const buildAt = deployRuns.findIndex((run) => run.includes('vercel build --prod'));
    const deployAt = deployRuns.findIndex((run) => run.includes('vercel deploy --prebuilt --prod'));
    expect(buildAt).toBeGreaterThan(-1);
    expect(deployAt).toBeGreaterThan(buildAt);
    expect(migrate!.steps.some((step) => step.run === 'pnpm db:migrate')).toBe(true);
    expect(smoke!.steps.some((step) => step.run === 'pnpm smoke')).toBe(true);
  });

  it('마이그레이션 실패 시 배포 미실행: deploy 는 needs migrate 이고 always()/failure() 로 우회하지 않는다', () => {
    expect(deploy!.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    expect(smoke!.if ?? '').not.toMatch(/always\(\)|failure\(\)/);
  });

  it('롤백은 실패 시에만, 배포가 성공했고 직전 배포가 있을 때', () => {
    expect(rollback!.if).toContain('failure()');
    expect(rollback!.if).toContain("needs.deploy.result == 'success'");
    expect(rollback!.steps.some((step) => step.run?.includes('vercel rollback'))).toBe(true);
  });

  it('concurrency 그룹 · 진행 중 취소 안 함 · 최소 권한', () => {
    expect(workflow.concurrency).toEqual({
      group: 'deploy-production',
      'cancel-in-progress': false,
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});

describe.each(['deploy-production.yml', 'preview-migrate.yml', 'preview-smoke.yml', 'ci.yml'])(
  '%s 시크릿 취급 (AC-362)',
  (name) => {
    const text = raw(name);
    const workflow = load(name);
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

    it('시크릿 이름은 secrets.* 표현식으로만 나온다 (env·run 에 리터럴 값 없음)', () => {
      for (const secret of SECRET_NAMES) {
        for (const match of text.matchAll(new RegExp(`${secret}:\\s*(.+)`, 'g'))) {
          expect(match[1]).toMatch(/\$\{\{.*secrets\.|\$\{\{.*vars\./);
        }
      }
      // 자격 증명 URL 리터럴은 CI 서비스 컨테이너(localhost)·빌드용 더미(*.example.*)만 허용
      expect(text).not.toMatch(
        /postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@(?!localhost[:/]|[^\s'"/]*\.example\.)/,
      );
    });

    it('run: 에 시크릿 표현식·echo 없음 — 값은 단계 env 로만 넘긴다', () => {
      for (const step of steps) {
        const run = step.run ?? '';
        expect(run).not.toMatch(/\$\{\{\s*secrets\./);
        for (const secret of SECRET_NAMES) {
          expect(run).not.toMatch(new RegExp(`(echo|printf)[^\\n]*\\$\\{?${secret}`));
        }
      }
    });
  },
);

describe('preview 워크플로 (AC-362)', () => {
  it('preview-migrate: drizzle 변경 + db-migration 라벨 + 같은 저장소 PR, 동시에 하나(취소 안 함)', () => {
    const workflow = load('preview-migrate.yml');
    // 라벨을 붙이는 순간에만 — 라벨 후 push 로 검토 안 된 코드가 시크릿을 받지 않게 (보안 리뷰 M-1)
    expect(workflow.on).toEqual({ pull_request: { types: ['labeled'], paths: ['drizzle/**'] } });
    expect(workflow.concurrency).toEqual({
      group: 'preview-db-migration',
      'cancel-in-progress': false,
    });
    const job = workflow.jobs['migrate-preview']!;
    expect(job.environment).toBe('preview');
    expect(job.if).toContain("github.event.label.name == 'db-migration'");
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('preview-smoke: Vercel deployment_status 성공 + Preview 에서 pnpm smoke, 우회 시크릿은 deployment_status 일 때만', () => {
    const workflow = load('preview-smoke.yml');
    const job = workflow.jobs.smoke!;
    expect(job.if).toContain("github.event.deployment_status.state == 'success'");
    expect(job.if).toContain("github.event.deployment.environment == 'Preview'");
    const smoke = job.steps.find((step) => step.run === 'pnpm smoke')!;
    expect(smoke.env?.SMOKE_BYPASS_SECRET).toContain("github.event_name == 'deployment_status'");
  });
});
