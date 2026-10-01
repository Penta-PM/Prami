// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * AC-362 워크플로 정적 검사 (PRAMI-003 §4.3.1·§4.3.6). actionlint 는 로컬 `docker run rhysd/actionlint` 로 별도 실행한다.
 * deploy-production: environment production · 순서(점검 판정 → 마이그레이션 → 빌드 → 배포 → 도메인 할당 확인 → 스모크 → 실패 시 롤백) ·
 * 시크릿은 secrets.* 로만 · run: 에 시크릿 echo 없음 · concurrency 그룹 · main 에서만.
 * PR #26 S1-b: 시크릿을 쓰는 워크플로는 기본 브랜치 YAML 로만 도는 트리거(workflow_dispatch·repository_dispatch)만 — 트리거 화이트리스트.
 */
type Step = {
  name?: string;
  id?: string;
  if?: string;
  shell?: string;
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
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');
const raw = (name: string) => readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
const load = (name: string) => parse(raw(name)) as Workflow;
const needsOf = (job: Job) => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);
const stepNamed = (job: Job, name: string) => job.steps.find((step) => step.name === name);
const indexOfStep = (job: Job, name: string) => job.steps.findIndex((step) => step.name === name);
const SECRET_NAMES = [
  'DATABASE_URL_UNPOOLED',
  'PREVIEW_DATABASE_URL_UNPOOLED',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
];
/** 운영 DB·Vercel 토큰 — deploy-production 밖에 나오면 안 된다 */
const PRODUCTION_SECRETS = [
  'DATABASE_URL_UNPOOLED',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
];
/** 시크릿 참조 전부 — `secrets.X`·`secrets['X']`·`toJSON(secrets)`·`secrets: inherit`. 표기를 바꿔 검사를 피하지 못하게 (보안 리뷰 M-2) */
const ANY_SECRET_REF = /\bsecrets\s*(\.|\[|\))|secrets:\s*inherit|toJSON\(\s*secrets/;
const ANY_SECRET_REF_G = new RegExp(ANY_SECRET_REF.source, 'g');
/** 이름이 보이는 참조(`secrets.X`·`secrets['X']`)의 이름 목록 */
const secretNames = (text: string) =>
  [...text.matchAll(/\bsecrets\s*(?:\.\s*(\w+)|\[\s*['"](\w+)['"]\s*\])/g)].map(
    (match) => match[1] ?? match[2],
  );
const MAIN_GUARD = "github.ref == 'refs/heads/main'";
/**
 * 잡 if 가 `github.ref == 'refs/heads/main'` 로 시작하고 그 뒤는 `&& …` 뿐이며, 최상위(괄호·따옴표 밖)에 `||` 가 없다 —
 * `… || true` 같은 우회를 막는다 (보안 리뷰 M-2)
 */
function mainGuarded(expression: string | undefined): boolean {
  const body = (expression ?? '')
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/\s+/g, ' ');
  if (!body.startsWith(MAIN_GUARD)) return false;
  const rest = body.slice(MAIN_GUARD.length).trim();
  if (rest !== '' && !rest.startsWith('&& ')) return false;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && body.startsWith('||', index)) return false;
  }
  return depth === 0 && !quoted;
}

describe('deploy-production.yml (AC-362)', () => {
  const workflow = load('deploy-production.yml');
  const { deploy, smoke, rollback } = workflow.jobs;

  it('PR #26 S1-b: 수동 실행(workflow_dispatch)만, 모든 잡이 main 에서만 실행', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(workflow.jobs).sort()).toEqual(['deploy', 'rollback', 'smoke']);
    for (const job of Object.values(workflow.jobs)) expect(mainGuarded(job.if), job.if).toBe(true);
  });

  it('시크릿을 받는 잡은 environment: production / 롤백은 production-rollback, 스모크 잡은 시크릿 없음', () => {
    expect(deploy!.environment).toBe('production');
    // 롤백은 승인 대기 없이 — Vercel 시크릿만 가진 별도 Environment (보안 리뷰 L-2)
    expect(rollback!.environment).toBe('production-rollback');
    expect(JSON.stringify(smoke)).not.toMatch(/secrets\./);
  });

  it('순서: 점검 판정 → 마이그레이션 → 빌드 → 배포 → 도메인 할당 확인 (한 잡 — 앞 단계 실패 시 뒤 단계 미실행), 스모크 → 롤백', () => {
    expect(needsOf(deploy!)).toEqual([]);
    expect(needsOf(smoke!)).toEqual(['deploy']);
    expect(needsOf(rollback!).sort()).toEqual(['deploy', 'smoke']);
    const order = [
      '직전 production 배포 기록',
      'Vercel env 가져오기 (production)',
      '점검 모드 판정 (MAINTENANCE_MODE)',
      'Migrate (DATABASE_URL_UNPOOLED)',
      'Build (vercel build --prod)',
      'Deploy (vercel deploy --prebuilt --prod)',
      '도메인 할당 확인 (Staged 감지)',
    ].map((name) => indexOfStep(deploy!, name));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stepNamed(deploy!, 'Migrate (DATABASE_URL_UNPOOLED)')!.run).toBe('pnpm db:migrate');
    expect(stepNamed(deploy!, 'Build (vercel build --prod)')!.run).toContain('vercel build --prod');
    expect(stepNamed(deploy!, 'Deploy (vercel deploy --prebuilt --prod)')!.run).toContain(
      'vercel deploy --prebuilt --prod',
    );
    // 단계 if 로 실패를 건너뛰는 단계가 없다 — 마이그레이션 실패 시 빌드·배포 미실행
    expect(deploy!.steps.some((step) => step.if)).toBe(false);
    expect(smoke!.steps.some((step) => step.run === 'pnpm smoke')).toBe(true);
  });

  it('DB 시크릿은 마이그레이션 단계 env 에만 (잡 env·다른 단계에 없음)', () => {
    expect(Object.keys(deploy!.env ?? {})).not.toContain('DATABASE_URL_UNPOOLED');
    const withDb = deploy!.steps.filter((step) =>
      JSON.stringify(step).includes('secrets.DATABASE_URL_UNPOOLED'),
    );
    expect(withDb.map((step) => step.name)).toEqual(['Migrate (DATABASE_URL_UNPOOLED)']);
  });

  it('스모크·롤백은 deploy 실패(마이그레이션·도메인 할당 확인 포함)를 always()/cancelled() 로 우회하지 않는다', () => {
    expect(smoke!.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    expect(rollback!.if).toContain('failure()');
    expect(rollback!.if).toContain("needs.deploy.result == 'success'");
    expect(rollback!.if).not.toMatch(/always\(\)/);
    expect(rollback!.steps.some((step) => step.run?.includes('vercel rollback'))).toBe(true);
  });

  it('L2-9·I2-8: 직전 배포 = 운영 도메인 별칭이 가리키는 배포 · pipefail · API 실패는 중단 · 별칭 없음(첫 배포)만 경고', () => {
    const previous = stepNamed(deploy!, '직전 production 배포 기록')!;
    expect(previous.shell).toBe('bash');
    expect(previous.run).toContain('https://api.vercel.com/v4/aliases/');
    expect(previous.run).toMatch(/"\$code" = "404"[\s\S]*?::warning::/);
    expect(previous.run).toMatch(/else\s+echo "::error::Vercel 별칭 조회 실패[\s\S]*?exit 1/);
    expect(previous.run).toContain('echo "url=${previous}" >> "$GITHUB_OUTPUT"');
  });

  it('L2-1·D3-N1: 배포 직후 운영 도메인 별칭의 deploymentId 가 이번 배포 ID 가 아니면(Staged) 실패', () => {
    const check = stepNamed(deploy!, '도메인 할당 확인 (Staged 감지)')!;
    expect(check.shell).toBe('bash');
    expect(check.env?.DEPLOY_URL).toBe('${{ steps.deploy.outputs.url }}');
    expect(check.run).toContain('https://api.vercel.com/v13/deployments/');
    expect(check.run).toContain('.deploymentId // empty');
    expect(check.run).toMatch(/"\$assigned" = "\$deployment_id"[\s\S]*?exit 0/);
    expect(check.run).toMatch(/런북 R-2 5단계[\s\S]*?exit 1\s*$/);
  });

  describe('PR #26 D-1 점검 모드 — 자동 롤백이 쓰기 차단을 풀지 않는다', () => {
    it('수동 실행 입력 maintenance(false|true, 기본 false)와 production env 의 MAINTENANCE_MODE 가 다르면 마이그레이션 전에 중단 (L2-2)', () => {
      const dispatch = workflow.on.workflow_dispatch as {
        inputs: Record<string, { type: string; options: string[]; default: string }>;
      };
      expect(dispatch.inputs.maintenance).toMatchObject({
        type: 'choice',
        options: ['false', 'true'],
        default: 'false',
      });
      const mode = stepNamed(deploy!, '점검 모드 판정 (MAINTENANCE_MODE)')!;
      expect(indexOfStep(deploy!, mode.name!)).toBeGreaterThan(
        indexOfStep(deploy!, 'Vercel env 가져오기 (production)'),
      );
      expect(indexOfStep(deploy!, mode.name!)).toBeLessThan(
        indexOfStep(deploy!, 'Migrate (DATABASE_URL_UNPOOLED)'),
      );
      // Actions 기본 셸(bash -e)에는 pipefail 이 없다 — 아래 실행 테스트와 같은 셸이 되게 명시 (보안 리뷰 L-3)
      expect(mode.shell).toBe('bash');
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
      // 키는 있는데 값이 빔 = Secret 이라 pull 이 값을 안 줌 — false 로 읽지 않고 중단 (self-review M)
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

const WORKFLOW_FILES = [
  'ci.yml',
  'deploy-production.yml',
  'preview-migrate.yml',
  'preview-smoke.yml',
];

describe.each(WORKFLOW_FILES)('%s 시크릿 취급 (AC-362)', (name) => {
  const text = raw(name);
  const workflow = load(name);
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

  it('시크릿 이름은 secrets.* 표현식으로만 나온다 (env·run 에 리터럴 값 없음)', () => {
    for (const secret of SECRET_NAMES) {
      for (const match of text.matchAll(new RegExp(`\\b${secret}:\\s*(.+)`, 'g'))) {
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
});

/**
 * PR #26 S1-b — 운영 DB·Vercel 토큰·preview DB 시크릿이 PR 커밋의 YAML·포크·PR 이벤트에서 닿지 않는 구조를 고정한다.
 * 근거(GitHub Docs "Events that trigger workflows"): repository_dispatch·workflow_dispatch 는 기본 브랜치에 워크플로 파일이 있어야 트리거되고,
 * pull_request 는 PR 머지 커밋의 YAML, deployment_status 는 배포 커밋의 YAML 로 돈다. pull_request_target·workflow_run 은 기본 브랜치 YAML 이지만
 * PR·다른 워크플로가 영향을 주는 이벤트에 시크릿을 준다 — 이 저장소에서는 쓰지 않는다.
 * 한계: write 권한자가 자기 브랜치에 새 워크플로를 push 하면 저장소 시크릿을 받을 수 있다(YAML 로 못 막음 — docs/deploy/github-plan.md).
 */
describe('PR #26 S1-b 트리거 화이트리스트 · 시크릿 경계', () => {
  const ALLOWED_TRIGGERS: Record<string, string[]> = {
    'ci.yml': ['pull_request', 'push'],
    'deploy-production.yml': ['workflow_dispatch'],
    'preview-migrate.yml': ['workflow_dispatch'],
    'preview-smoke.yml': ['repository_dispatch', 'workflow_dispatch'],
  };
  const DEFAULT_BRANCH_ONLY = new Set(['workflow_dispatch', 'repository_dispatch']);
  const usesSecrets = (name: string) => ANY_SECRET_REF.test(raw(name));

  it('mainGuarded: main 조건으로 시작 + 최상위 || 없음만 통과 (우회 표현 거부)', () => {
    expect(mainGuarded(MAIN_GUARD)).toBe(true);
    expect(mainGuarded(`\${{ ${MAIN_GUARD} && failure() && (a || b) }}`)).toBe(true);
    expect(mainGuarded(`${MAIN_GUARD} || true`)).toBe(false);
    expect(mainGuarded(`${MAIN_GUARD} && false || true`)).toBe(false);
    expect(mainGuarded(`!(${MAIN_GUARD})`)).toBe(false);
    expect(mainGuarded(`${MAIN_GUARD}x`)).toBe(false);
    expect(mainGuarded(undefined)).toBe(false);
  });

  it.each(WORKFLOW_FILES)(
    '%s: toJSON(secrets)·secrets: inherit·재사용 워크플로(잡 uses) 없음, 모든 시크릿 참조는 이름이 보이는 형태',
    (name) => {
      // 주석 줄은 빼고 센다(설명 문장의 `secrets.*` 는 참조가 아니다)
      const text = raw(name).replace(/^\s*#.*$/gm, '');
      expect(text).not.toMatch(/toJSON\(\s*secrets|secrets:\s*inherit/);
      expect((text.match(ANY_SECRET_REF_G) ?? []).length).toBe(secretNames(text).length);
      for (const job of Object.values(load(name).jobs)) expect('uses' in job).toBe(false);
    },
  );

  it('워크플로 파일 목록이 고정돼 있다 — 새 워크플로는 이 화이트리스트를 갱신해야 한다', () => {
    const files = readdirSync(WORKFLOW_DIR).filter((file) => /\.ya?ml$/.test(file));
    expect(files.sort()).toEqual(Object.keys(ALLOWED_TRIGGERS).sort());
  });

  it.each(Object.entries(ALLOWED_TRIGGERS))('%s 트리거 = %j', (name, triggers) => {
    expect(Object.keys(load(name).on).sort()).toEqual(triggers);
  });

  it.each(WORKFLOW_FILES)(
    '%s: pull_request_target·workflow_run·deployment_status·issue_comment 없음',
    (name) => {
      expect(raw(name)).not.toMatch(
        /^\s*(pull_request_target|workflow_run|deployment_status|deployment|issue_comment):/m,
      );
    },
  );

  it('시크릿을 쓰는 워크플로는 기본 브랜치 YAML 트리거만, 모든 잡이 main 에서만', () => {
    const withSecrets = WORKFLOW_FILES.filter(usesSecrets);
    expect(withSecrets.sort()).toEqual([
      'deploy-production.yml',
      'preview-migrate.yml',
      'preview-smoke.yml',
    ]);
    for (const name of withSecrets) {
      const workflow = load(name);
      for (const trigger of Object.keys(workflow.on))
        expect(DEFAULT_BRANCH_ONLY.has(trigger), `${name} ${trigger}`).toBe(true);
      for (const job of Object.values(workflow.jobs)) {
        expect(mainGuarded(job.if), `${name} ${job.if}`).toBe(true);
      }
    }
  });

  it('PR 이벤트를 받는 ci.yml 은 시크릿을 쓰지 않는다 (GITHUB_TOKEN 표현식도 없음)', () => {
    expect(raw('ci.yml')).not.toMatch(ANY_SECRET_REF);
    expect(raw('ci.yml')).not.toMatch(/github\.token/);
    // 체크아웃이 토큰을 .git/config 에 남기지 않는다 (보안 리뷰 L-6)
    for (const step of Object.values(load('ci.yml').jobs).flatMap((job) => job.steps)) {
      if (step.uses?.startsWith('actions/checkout@')) {
        expect(step.with?.['persist-credentials']).toBe(false);
      }
    }
    expect(load('ci.yml').permissions).toEqual({ contents: 'read' });
  });

  it('운영 DB·Vercel 토큰은 deploy-production 에만, preview DB 는 이름이 다른 PREVIEW_DATABASE_URL_UNPOOLED', () => {
    for (const name of WORKFLOW_FILES.filter((file) => file !== 'deploy-production.yml')) {
      for (const secret of PRODUCTION_SECRETS) {
        expect(secretNames(raw(name)), `${name} ${secret}`).not.toContain(secret);
      }
    }
    expect(new Set(secretNames(raw('preview-migrate.yml')))).toEqual(
      new Set(['PREVIEW_DATABASE_URL_UNPOOLED']),
    );
    expect(secretNames(raw('preview-smoke.yml'))).toEqual(['VERCEL_AUTOMATION_BYPASS_SECRET']);
    // 표기 우회도 이름으로 잡는다
    expect(secretNames("${{ secrets['VERCEL_TOKEN'] }} ${{ secrets . X }}")).toEqual([
      'VERCEL_TOKEN',
      'X',
    ]);
  });

  it.each(['deploy-production.yml', 'preview-migrate.yml', 'preview-smoke.yml'])(
    '%s: 시크릿은 잡·워크플로 env 가 아니라 쓰는 단계 env 에만 — 패키지 설치 단계는 시크릿을 받지 않는다 (보안 리뷰 M-1)',
    (name) => {
      const workflow = load(name) as Workflow & { env?: Record<string, string> };
      expect(JSON.stringify(workflow.env ?? {})).not.toMatch(/secrets\./);
      for (const job of Object.values(workflow.jobs)) {
        expect(JSON.stringify(job.env ?? {}), name).not.toMatch(/secrets\./);
        for (const step of job.steps) {
          if (/(pnpm|npm) install/.test(step.run ?? '')) {
            expect(JSON.stringify(step.env ?? {}), `${name} ${step.name}`).not.toMatch(/secrets\./);
          }
        }
      }
    },
  );

  it.each(['deploy-production.yml', 'preview-migrate.yml', 'preview-smoke.yml'])(
    '%s: 체크아웃은 자격 증명 미보존 · 이벤트 값(PR head 등)으로 ref 를 고르지 않는다 · pnpm 캐시 없음 (L2-8)',
    (name) => {
      for (const step of Object.values(load(name).jobs).flatMap((job) => job.steps)) {
        if (step.uses?.startsWith('actions/checkout@')) {
          expect(step.with?.['persist-credentials'], name).toBe(false);
          expect(String(step.with?.ref ?? '')).not.toMatch(/github\.(event|head_ref)/);
        }
        if (step.uses?.startsWith('actions/setup-node@'))
          expect(step.with?.cache, name).toBeUndefined();
      }
    },
  );
});

describe('preview 워크플로 (AC-362)', () => {
  describe('preview-migrate — 기본 브랜치 수동 실행, PR 에서는 drizzle/ 만 (S1-b)', () => {
    const workflow = load('preview-migrate.yml');
    const job = workflow.jobs['migrate-preview']!;

    it('입력 PR 번호 + 검토한 head SHA, 동시에 하나(취소 안 함), Environment preview', () => {
      const dispatch = workflow.on.workflow_dispatch as {
        inputs: Record<string, { required: boolean }>;
      };
      expect(Object.keys(dispatch.inputs).sort()).toEqual(['pr', 'sha']);
      expect(dispatch.inputs.pr!.required && dispatch.inputs.sha!.required).toBe(true);
      expect(workflow.concurrency).toEqual({
        group: 'preview-db-migration',
        'cancel-in-progress': false,
      });
      expect(job.environment).toBe('preview');
      expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    });

    it('PR 확인(열린 같은 저장소 PR · head = 입력 SHA)이 PR 커밋 체크아웃보다 먼저', () => {
      const verify = stepNamed(job, 'PR 확인 (열린 PR · 같은 저장소 · head = 입력 SHA)')!;
      expect(verify.run).toMatch(/"\$head_repo" != "\$REPO"[\s\S]*?exit 1/);
      expect(verify.run).toMatch(/"\$head_sha" != "\$EXPECTED_SHA"[\s\S]*?exit 1/);
      expect(verify.run).toContain('^[0-9a-f]{40}$');
      const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
      expect(checkouts).toHaveLength(2);
      expect(checkouts[0]!.with).toEqual({ 'persist-credentials': false });
      expect(checkouts[1]!.with).toEqual({
        ref: '${{ inputs.sha }}',
        path: '.pr-src',
        'sparse-checkout': 'drizzle',
        'persist-credentials': false,
      });
      expect(job.steps.indexOf(verify)).toBeLessThan(job.steps.indexOf(checkouts[1]!));
    });

    it('PR 커밋에서는 drizzle/ 복사만 하고 실행하지 않는다 — 설치·마이그레이션 코드는 기본 브랜치', () => {
      const copy = stepNamed(job, 'PR 의 drizzle/ 로 교체 (SQL·저널만)')!;
      expect(copy.run).toContain('src=.pr-src/drizzle');
      expect(copy.run).toContain('cp -R "$src" drizzle');
      expect(copy.run).toContain('rm -rf .pr-src');
      const others = job.steps.filter((step) => step !== copy && step.run);
      for (const step of others) expect(step.run).not.toContain('.pr-src');
      // 설치(기본 브랜치 lockfile) 뒤에 교체하고, 그다음 마이그레이션 (보안 리뷰 L-1)
      const migrateAt = indexOfStep(job, 'Migrate (PREVIEW_DATABASE_URL_UNPOOLED)');
      expect(indexOfStep(job, 'Install')).toBeLessThan(job.steps.indexOf(copy));
      expect(job.steps.indexOf(copy)).toBeLessThan(migrateAt);
      expect(copy.shell).toBe('bash');
    });

    // 교체 셸을 실제로 실행한다(jq 는 통과 stub — 저널 태그 검사는 CI 러너의 jq). 정해진 이름의 일반 파일만 받는다
    const copyScript = stepNamed(job, 'PR 의 drizzle/ 로 교체 (SQL·저널만)')!.run!;
    const runCopy = (files: Record<string, string>, extraDirs: string[] = []) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'prami-drizzle-'));
      try {
        const src = path.join(dir, '.pr-src');
        mkdirSync(path.join(src, 'drizzle/meta'), { recursive: true });
        for (const extra of extraDirs) mkdirSync(path.join(src, extra), { recursive: true });
        for (const [file, body] of Object.entries(files)) writeFileSync(path.join(src, file), body);
        const git = (...args: string[]) =>
          spawnSync('git', ['-C', src, ...args], { encoding: 'utf8' }).stdout.trim();
        git('init', '-q');
        git('add', '-A');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'x');
        const sha = git('rev-parse', 'HEAD');
        const bin = path.join(dir, 'bin');
        mkdirSync(bin);
        writeFileSync(path.join(bin, 'jq'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        const result = spawnSync(
          'bash',
          ['--noprofile', '--norc', '-eo', 'pipefail', '-c', copyScript],
          {
            cwd: dir,
            encoding: 'utf8',
            env: {
              ...process.env,
              EXPECTED_SHA: sha,
              PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            },
          },
        );
        const copied = result.status === 0 ? readdirSync(path.join(dir, 'drizzle')).sort() : [];
        return { status: result.status, copied };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const valid = {
      'drizzle/0000_initial.sql': 'select 1;',
      'drizzle/meta/_journal.json': '{"entries":[{"tag":"0000_initial"}]}',
      'drizzle/meta/0000_snapshot.json': '{}',
    };

    it('교체 셸: 정해진 이름의 SQL·저널·스냅샷이면 drizzle/ 로 교체', () => {
      expect(runCopy(valid)).toEqual({ status: 0, copied: ['0000_initial.sql', 'meta'] });
    });

    it.each<[string, Record<string, string>, string[]]>([
      ['허용되지 않은 파일(package.json)', { ...valid, 'drizzle/package.json': '{}' }, []],
      ['대문자 든 SQL 이름', { ...valid, 'drizzle/0001_X.sql': 'select 1;' }, []],
      ['meta 밖 JSON', { ...valid, 'drizzle/0001_snapshot.json': '{}' }, []],
      ['meta 외 하위 폴더(빈 폴더)', valid, ['drizzle/sub']],
    ])('교체 셸: %s 이면 중단(exit 1)', (_label, files, dirs) => {
      expect(runCopy(files, dirs).status).toBe(1);
    });
  });

  describe('preview-smoke — Vercel repository_dispatch(기본 브랜치 YAML), deployment_status 없음 (S1-a)', () => {
    const workflow = load('preview-smoke.yml');
    const job = workflow.jobs.smoke!;
    const smoke = stepNamed(job, 'Smoke')!;

    it('vercel.deployment.success + payload environment preview, 수동 실행', () => {
      expect(workflow.on.repository_dispatch).toEqual({ types: ['vercel.deployment.success'] });
      expect(job.if).toContain("github.event.client_payload.environment == 'preview'");
      expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
      expect(smoke.env?.TARGET).toBe(
        '${{ github.event.client_payload.url || github.event.inputs.url }}',
      );
      expect(smoke.run).toContain('SMOKE_URL="$TARGET" pnpm smoke');
      expect(smoke.shell).toBe('bash');
    });

    // 대상 URL 판정을 실제로 실행한다(pnpm 은 받은 SMOKE_URL 을 출력하는 stub) — 문자열 전체 판정 (보안 리뷰 L-2)
    it.each<[string, string | null]>([
      ['prami-abc123-team.vercel.app', 'https://prami-abc123-team.vercel.app'],
      ['https://prami-abc123-team.vercel.app/', 'https://prami-abc123-team.vercel.app/'],
      ['https://a\n@evil.com', null],
      ['https://user@evil.com', null],
      ['https://169.254.169.254', null],
      ['http://prami.vercel.app', null],
      ['https://prami.vercel.app:8443', null],
      ['', null],
    ])('스모크 대상 %j → %j', (target, expected) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'prami-smoke-target-'));
      try {
        writeFileSync(path.join(dir, 'pnpm'), '#!/bin/sh\nprintf "%s" "$SMOKE_URL"\n', {
          mode: 0o755,
        });
        const result = spawnSync(
          'bash',
          ['--noprofile', '--norc', '-eo', 'pipefail', '-c', smoke.run!],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              TARGET: target,
              PATH: `${dir}${path.delimiter}${process.env.PATH}`,
            },
          },
        );
        expect(result.status).toBe(expected === null ? 1 : 0);
        if (expected !== null) expect(result.stdout).toBe(expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('우회 시크릿은 호스트 패턴과 함께만 (판정은 스모크 코드 bypassAllowed) · 체크아웃 하나 · 최소 권한', () => {
      expect(smoke.env?.SMOKE_BYPASS_SECRET).toBe('${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}');
      expect(smoke.env?.SMOKE_BYPASS_HOST_PATTERN).toBe('${{ vars.VERCEL_PREVIEW_HOST_PATTERN }}');
      expect(job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))).toHaveLength(
        1,
      );
      expect(Object.keys(workflow.jobs)).toEqual(['smoke']);
      expect(workflow.permissions).toEqual({ contents: 'read' });
    });
  });
});
