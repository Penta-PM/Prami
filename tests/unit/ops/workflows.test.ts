// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * AC-362 워크플로 정적 검사 (PRAMI-003 §4.3.1·§4.3.6). actionlint 는 로컬 `docker run rhysd/actionlint` 로 별도 실행한다.
 * deploy-production: environment production · 순서(마이그레이션 → 빌드 → 배포 → 스모크 → 실패 시 롤백) · 마이그레이션 실패 시 배포 미실행 ·
 * 시크릿은 secrets.* 로만 · run: 에 시크릿 echo 없음 · concurrency 그룹 · main 에서만.
 */
type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  uses?: string;
  with?: Record<string, unknown>;
};
type Job = {
  needs?: string | string[];
  outputs?: Record<string, string>;
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

  describe('PR #26 D-1 점검 모드 — 자동 롤백이 쓰기 차단을 풀지 않는다', () => {
    const stepNamed = (job: Job, name: string) => job.steps.find((step) => step.name === name);

    it('수동 실행 입력 maintenance(false|true, 기본 false)와 production env 의 MAINTENANCE_MODE 가 다르면 빌드·배포 전에 중단', () => {
      const dispatch = workflow.on.workflow_dispatch as {
        inputs: Record<string, { type: string; options: string[]; default: string }>;
      };
      expect(dispatch.inputs.maintenance).toMatchObject({
        type: 'choice',
        options: ['false', 'true'],
        default: 'false',
      });
      const names = deploy!.steps.map((step) => step.name ?? step.uses ?? '');
      const mode = stepNamed(deploy!, '점검 모드 판정 (MAINTENANCE_MODE)')!;
      expect(names.indexOf(mode.name!)).toBeGreaterThan(
        names.indexOf('Vercel env 가져오기 (production)'),
      );
      expect(names.indexOf(mode.name!)).toBeLessThan(names.indexOf('Build (vercel build --prod)'));
      // push 실행은 입력이 없으므로 false 를 기대한다 — 점검 중 main push 는 배포 전에 멈춘다
      expect(mode.env?.EXPECTED).toBe("${{ inputs.maintenance || 'false' }}");
      expect(mode.run).toContain('.vercel/.env.production.local');
      expect(mode.run).toMatch(/"\$maintenance" != "\$EXPECTED"[\s\S]*exit 1/);
      expect(mode.run).toContain('echo "maintenance=${maintenance}" >> "$GITHUB_OUTPUT"');
      expect(deploy!.outputs?.maintenance).toBe('${{ steps.mode.outputs.maintenance }}');
    });

    // 판정 셸을 Actions 기본 셸(bash -eo pipefail)로 실제 실행한다 — pull 결과 형식(따옴표·CRLF·대소문자)과 불일치·누락 처리
    it.each<[string | null, string, number, string | null]>([
      ['MAINTENANCE_MODE="true"\n', 'true', 0, 'true'],
      ['A="1"\r\nMAINTENANCE_MODE="TRUE"\r\n', 'true', 0, 'true'],
      ['A="1"\n', 'false', 0, 'false'],
      ['MAINTENANCE_MODE="false"\n', 'false', 0, 'false'],
      ['MAINTENANCE_MODE="true"\n', 'false', 1, null],
      ['A="1"\n', 'true', 1, null],
      ['MAINTENANCE_MODE="maybe"\n', 'false', 1, null],
      // 키는 있는데 값이 빔 = Sensitive 라 pull 이 값을 안 줌 — false 로 읽지 않고 중단 (self-review M)
      ['MAINTENANCE_MODE=""\n', 'false', 1, null],
      // pull 결과 파일이 없으면 판정 없이 배포 중단
      [null, 'false', 1, null],
    ])('판정 셸: env 파일 %j · 기대 %s → exit %i · 출력 %s', (file, expected, code, output) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'prami-mode-'));
      try {
        mkdirSync(path.join(dir, '.vercel'));
        if (file !== null) writeFileSync(path.join(dir, '.vercel/.env.production.local'), file);
        const githubOutput = path.join(dir, 'out.txt');
        writeFileSync(githubOutput, '');
        const result = spawnSync(
          'bash',
          [
            '--noprofile',
            '--norc',
            '-eo',
            'pipefail',
            '-c',
            stepNamed(deploy!, '점검 모드 판정 (MAINTENANCE_MODE)')!.run!,
          ],
          {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, EXPECTED: expected, GITHUB_OUTPUT: githubOutput },
          },
        );
        expect(result.status).toBe(code);
        const written = readFileSync(githubOutput, 'utf8').trim();
        expect(written).toBe(output === null ? '' : `maintenance=${output}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('스모크는 점검 모드 배포면 점검 503 을 기대한다 (SMOKE_MAINTENANCE)', () => {
      const step = smoke!.steps.find((s) => s.run === 'pnpm smoke')!;
      expect(step.env?.SMOKE_MAINTENANCE).toBe('${{ needs.deploy.outputs.maintenance }}');
    });

    it('롤백 잡은 점검 모드 배포에서 실행되지 않고, 실행돼도 운영이 점검 503 이면 vercel rollback 전에 멈춘다', () => {
      expect(rollback!.if).toContain("needs.deploy.outputs.maintenance != 'true'");
      const guard = stepNamed(rollback!, '롤백 전 확인 (점검 모드 · 도메인 할당)')!;
      const guardAt = rollback!.steps.indexOf(guard);
      const rollbackAt = rollback!.steps.findIndex((step) => step.run?.includes('vercel rollback'));
      expect(guardAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(rollbackAt);
      expect(guard.run).toMatch(/"\$chat_code" = "MAINTENANCE"[\s\S]*?exit 1/);
      // 운영 URL 이 비면 판정 불가 → 멈춘다, 요청마다 타임아웃
      expect(guard.run).toMatch(/-z "\$PRODUCTION_URL"[\s\S]*?exit 1/);
      expect(guard.run!.match(/curl -s --max-time 10 /g)).toHaveLength(2);
    });

    it('D-3: 운영 도메인 헬스 release 가 이번 커밋이 아니면(롤백 상태) 롤백을 반복하지 않는다', () => {
      const guard = stepNamed(rollback!, '롤백 전 확인 (점검 모드 · 도메인 할당)')!;
      expect(guard.run).toMatch(/"\$release" != "\$GITHUB_SHA"[\s\S]*?exit 1/);
      expect(rollback!.env?.PRODUCTION_URL).toBe('${{ vars.PRODUCTION_URL }}');
    });
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
    // F-21: `Preview – <프로젝트>` 형식도 받는다
    expect(job.if).toContain("startsWith(github.event.deployment.environment, 'Preview')");
    const smoke = job.steps.find((step) => step.run === 'pnpm smoke')!;
    expect(smoke.env?.SMOKE_BYPASS_SECRET).toContain("github.event_name == 'deployment_status'");
    expect(smoke.env?.SMOKE_BYPASS_HOST_PATTERN).toBe('${{ vars.VERCEL_PREVIEW_HOST_PATTERN }}');
  });

  describe('PR #26 S-1 preview-smoke 는 PR 코드에 시크릿을 주지 않는다', () => {
    const workflow = load('preview-smoke.yml');
    const job = workflow.jobs.smoke!;
    const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));

    it('체크아웃은 하나, 배포 커밋이 아니라 기본 브랜치(신뢰 코드) · 자격 증명 미보존', () => {
      expect(checkouts).toHaveLength(1);
      expect(checkouts[0]!.with).toEqual({
        ref: '${{ github.event.repository.default_branch }}',
        'persist-credentials': false,
      });
    });

    it('우회 시크릿은 승인이 필요한 Environment(preview-smoke) 잡에서만 — 저장소 시크릿으로 받는 잡 없음', () => {
      expect(job.environment).toBe('preview-smoke');
      expect(Object.keys(workflow.jobs)).toEqual(['smoke']);
    });

    it('최소 권한 · 쓰기 권한·pull_request_target 없음', () => {
      expect(workflow.permissions).toEqual({ contents: 'read' });
      expect(Object.keys(workflow.on).sort()).toEqual(['deployment_status', 'workflow_dispatch']);
    });
  });
});
