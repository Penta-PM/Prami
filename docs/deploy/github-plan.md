# GitHub 플랜과 배포 시크릿 (PRAMI-003 PR-4, PR #26 S1-c)

배포 워크플로(`deploy-production`·`preview-migrate`·`preview-smoke`)가 쓰는 시크릿을 어디에 두고, GitHub 플랜마다 무엇을 막을 수 있는지 정리한다.
워크플로 자체는 [`vercel.md`](vercel.md) §10, 운영 절차는 [`../ops/runbook.md`](../ops/runbook.md), 설정 확인은 [`checklist.md`](checklist.md) C-3 이다.

> **현재 전제 (2026-10-02 QA 실측, `gh api` 읽기)**: 조직 `Penta-PM` 플랜 **Free**, 저장소 **private**, `allow_forking: false`, Environments 0개,
> GitHub Actions 는 조직에서 실행이 막혀 있다(queued). 플랜 업그레이드는 **사용자 결정 대기**다. 결정 전까지는 §3(Free 유지)대로 둔다.

## 1. 플랜별로 쓸 수 있는 것 (private 저장소 기준)

| 기능 | Free | Team | Enterprise Cloud | 이 저장소에서 쓰는 곳 |
| --- | --- | --- | --- | --- |
| Environments | 불가 | 가능 | 가능 | `production`·`production-rollback`·`preview` |
| Environment 시크릿 | 불가 | 가능 | 가능 | 운영 DB·Vercel 토큰을 Environment 에만 |
| Deployment branches(Environment 를 `main` 에서만) | 불가 | 가능 | 가능 | 다른 브랜치 워크플로가 Environment 시크릿을 못 받게 |
| Required reviewers · Prevent self-review | 불가 | **불가**(public 만) | 가능 | 운영 배포 승인 |
| Wait timer | 불가 | 불가(public 만) | 가능 | (쓰지 않음) |
| 브랜치 보호 · rulesets | 불가 | 가능 | 가능 | `main` 직접 push 금지 · CI 2잡(quality·e2e) 통과 필수 |
| CODEOWNERS | 불가 | 가능 | 가능 | `.github/workflows/`·`drizzle/` 변경에 지정 리뷰어 |
| 조직 시크릿을 private 저장소에서 사용 | 불가 | 가능 | 가능 | (쓰지 않음) |
| 저장소 시크릿 | 가능 | 가능 | 가능 | Free 에서는 여기에만 둘 수 있다 |
| GitHub-hosted 러너 포함 분(private) | 월 2,000분 | 플랜 문서 | 플랜 문서 | CI 2잡(무거운 단계는 `ci:run` 라벨 PR 만) · 배포 워크플로 |

"불가" 는 private 저장소 기준이다(public 은 모든 플랜에서 대부분 가능). 근거는 §6.

## 2. 플랜과 무관하게 워크플로가 지키는 것 (PR #26 S1-a·S1-b)

| 워크플로 | 트리거 | 실행되는 YAML · 코드 | 쓰는 시크릿 |
| --- | --- | --- | --- |
| `ci.yml` | `pull_request`(opened·synchronize·reopened·labeled) | PR 머지 커밋 | **없음**(`secrets.*`·`github.token` 0 — 정적 테스트) |
| `deploy-production.yml` | `workflow_dispatch` 만 | 기본 브랜치(`main`)에서 실행할 때만 잡이 돈다 | `DATABASE_URL_UNPOOLED`·`VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID` |
| `preview-migrate.yml` | `workflow_dispatch` 만(PR 번호 + 검토한 head SHA) | 기본 브랜치 코드 + PR 의 `drizzle/` 파일만 | `PREVIEW_DATABASE_URL_UNPOOLED` |
| `preview-smoke.yml` | `repository_dispatch`(`vercel.deployment.success`) · `workflow_dispatch` | 기본 브랜치 | `VERCEL_AUTOMATION_BYPASS_SECRET` |

- **PR 이벤트에는 시크릿이 없다**: `pull_request` 는 PR 커밋의 YAML 로 돌기 때문에 시크릿을 쓰는 워크플로는 이 이벤트를 받지 않는다.
  `pull_request_target`·`workflow_run`·`deployment_status`·`issue_comment` 는 어떤 워크플로에도 없다.
  `tests/unit/ops/workflows.test.ts` 의 "트리거 화이트리스트" 가 파일 목록·트리거·시크릿 위치·`if: github.ref == 'refs/heads/main'`·체크아웃 옵션을 고정한다.
- **포크**: `allow_forking: false`. 포크에서 온 워크플로에는 GitHub 가 시크릿을 넘기지 않는다(GITHUB_TOKEN 제외).
- **deployment_status 끄기**: Vercel 프로젝트 → Settings → Git → **`deployment_status` Events** 토글을 끈다(C-3). PR 브랜치에 새로 추가한
  `on: deployment_status` 워크플로가 Vercel 배포 때마다 PR 커밋의 YAML 로 실행되는 경로를 없앤다.
- **시크릿 이름 분리**: preview DB 는 `PREVIEW_DATABASE_URL_UNPOOLED`, 운영 DB 는 `DATABASE_URL_UNPOOLED` 다. Environment 가 없는 플랜에서는
  둘 다 저장소 시크릿이 되므로 이름이 같으면 preview 마이그레이션이 운영 DB 에 적용된다.
- **캐시 없음**: 시크릿을 쓰는 잡은 `setup-node` 의 pnpm 캐시를 쓰지 않는다(다른 실행이 만든 store 를 복원하지 않음, L2-8).
- **우회 시크릿(`VERCEL_AUTOMATION_BYPASS_SECRET`)은 PR 작성자에게는 원래 비밀이 아니다**: Vercel 이 이 값을 모든 배포의 빌드·런타임
  system env 로 넣는다 — PR 코드는 preview 빌드 중에 읽을 수 있다. 영향은 preview 배포 보호 우회뿐이다(앱 로그인은 그대로). 그래서 저장소 시크릿으로 두는 것을
  **수용**한다. 유출이 의심되면 재생성하고 preview 를 다시 배포한다(런북 R-5). 스모크 코드는 이 값을 https + `VERCEL_PREVIEW_HOST_PATTERN` 호스트에만 보낸다.

## 3. Free 유지 시 (현재)

### 3.1 설정

| 위치 | 이름 |
| --- | --- |
| 저장소 시크릿 | `DATABASE_URL_UNPOOLED`(Neon `main` 직접 연결) · `VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` · `PREVIEW_DATABASE_URL_UNPOOLED`(Neon `preview` 직접 연결) · `VERCEL_AUTOMATION_BYPASS_SECRET`(배포 보호를 켰을 때만) |
| 저장소 변수 | `PRODUCTION_URL` · `PREVIEW_URL` · `VERCEL_PREVIEW_HOST_PATTERN` |
| 조직·저장소 권한 | 저장소 **write 이상 권한자 = 운영 비밀값을 이미 맡은 사람(운영자)** 으로 줄인다. 에이전트·봇 토큰은 F-R7 기준(Workflows·Actions write 없음). 조직 기본 권한(Base permissions)은 Read 이하. 봇·외부 협업자에게 write 를 주지 않는다 |
| Vercel | `deployment_status` Events 끔(§2). `VERCEL_TOKEN` 은 팀 범위·만료일 있는 토큰 |

- 워크플로의 `environment: production` 등은 그대로 둔다(업그레이드하면 바로 쓰인다). Free private 저장소에서 Environment 를 참조한 잡이 어떻게 도는지
  (그냥 실행되는지)는 문서에 명시가 없다 — Actions 해제 후 첫 실행에서 확인해 PR-5 에 기록한다. 실행되지 않으면 Main 에 올린다.
- 브랜치 보호·rulesets·CODEOWNERS 는 Free private 에서 **설정할 수 없다**. 대신 운영 규칙으로 둔다: `main` 직접 push 금지, `main` 머지는 QA 승인 PR 만,
  `deploy-production` 실행은 운영자만(R-1), 실행 기록을 배포 PR 에 남긴다.

### 3.2 남는 위험 (YAML 구조로는 막을 수 없다)

| # | 위험 | 왜 남나 | 완화 |
| --- | --- | --- | --- |
| F-R1 | write 권한자가 자기 브랜치에 `on: push` 워크플로를 추가하면 **모든 저장소 시크릿**(운영 DB 직접 연결·Vercel 토큰)을 받는다 | 저장소 시크릿은 브랜치를 가리지 않는다. GitHub 문서: write 권한자는 저장소의 모든 시크릿을 읽을 수 있다 | write 권한자 = 운영 비밀값 보유자. 권한자가 바뀌면 운영 비밀값 교체(R-5) |
| F-R2 | write 권한자가 `main` 에 직접 push 해 `deploy-production` YAML 을 바꾼 뒤 실행 | 브랜치 보호 불가 | 운영 규칙 + 배포 전 `git log main` 확인(R-1 1단계) |
| F-R3 | 승인 없는 운영 배포 — write 권한자는 누구나 Run workflow 를 누를 수 있다 | Required reviewers 불가 | 실행자를 운영자로 한정(운영 규칙), 실행 기록 |
| F-R4 | `preview-migrate` 를 실행한 사람이 검토하지 않은 SQL 을 preview DB 에 적용 | 입력 SHA 는 실행자가 고른다 | head SHA 일치 확인(검토 뒤 push 차단) · PR 의 `drizzle/` 외 코드는 실행 안 함 · preview DB 만 영향 |
| F-R5 | 우회 시크릿 노출 | 원래 모든 배포 env 에 있다(§2) | 수용 · 재생성 |
| F-R6 | preview DB 연결 문자열(PR 코드가 Vercel Preview 에서 읽을 수 있음)의 비밀번호가 운영과 같으면 호스트만 바꿔 운영 DB 접속 | Neon 브랜치는 부모의 역할을 물려받는다(비밀번호 동일 여부 PR-5 확인) | `preview` 역할 비밀번호 재설정(체크리스트 C-5) — 플랜과 무관 |
| F-R7 | AI 에이전트·봇 토큰이 `contents: write`(→ `main` push)·`workflow` 권한(→ 새 워크플로 push)·Actions write(→ Run workflow)를 가지면, 프롬프트 주입된 에이전트가 사람 없이 저장소 시크릿에 닿는다 | Free 는 브랜치 보호가 없다 · 잡 `if: github.ref == 'refs/heads/main'` 은 실수 방지일 뿐(브랜치에서 YAML 을 고쳐 `--ref` 로 실행 가능) | 에이전트·봇 토큰은 fine-grained, 이 저장소 한정, **Workflows 권한 없음 · Actions write 없음**, 가능하면 `contents: write` 없이 PR 만(보안 리뷰 M-3). 머지·`deploy-production` 실행은 사람 |

## 4. 업그레이드 시 전환 절차

### 4.1 Team

1. 조직 플랜을 Team 으로 바꾼다(사용자).
2. Environments 생성 — 전부 **Deployment branches and tags: Selected branches `main`**:
   `production`(시크릿 `DATABASE_URL_UNPOOLED`·`VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`) · `production-rollback`(`VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`) ·
   `preview`(`PREVIEW_DATABASE_URL_UNPOOLED`).
3. 같은 이름의 **저장소 시크릿을 삭제**한다(남겨 두면 다른 브랜치 워크플로가 계속 받는다). `VERCEL_AUTOMATION_BYPASS_SECRET` 은 저장소 시크릿으로 둬도 된다(§2).
4. `main` 브랜치 보호(또는 ruleset): PR 필수 · CI 2잡(quality: secret scan → `ci:run` 라벨이면 lint·typecheck·format·unit·build / e2e: integration + E2E) 통과 필수 · 직접 push 금지 · 강제 push 금지.
   필수 검사로 걸 때는 라벨 게이트 때문에 라벨 없는 PR 의 e2e 가 skipped 로 끝난다 — skipped 를 통과로 볼지 Team 전환 시 정한다(워크플로 `paths-ignore` 를 쓰지 않는 이유와 같음, `docs/specs/ci-usage-reduction.md` §2-6).
5. `.github/CODEOWNERS` 에 `/.github/workflows/`·`/drizzle/` 담당자를 두고 "Require review from Code Owners" 를 켠다.
6. C-3 로 설정을 확인하고 PR-5 에 기록한다. 남는 위험: F-R3(승인 없는 실행 — Team 은 reviewers 불가)은 `main` 보호 + 실행자 운영 규칙으로 줄인다.
   F-R1 은 Environment 시크릿 + 배포 브랜치 `main` 으로 닫힌다(브랜치 워크플로가 Environment 를 참조하면 거부).

### 4.2 Enterprise Cloud

4.1 전부 + `production`·`preview` 에 **Required reviewers ≥ 1** · **Prevent self-review** 를 켠다(`production-rollback` 은 reviewers 없음 — 사고 중 승인 대기 없이 롤백).
`deploy-production` 은 한 잡이라 승인은 한 번이다(R-1). F-R3 이 닫힌다.

## 5. Actions 가 queued 로 멈춘 원인 확인 (사용자 — 조직 소유자)

Free 플랜 private 저장소는 GitHub-hosted 러너 **월 2,000분**이 포함되고, 결제 수단이 없으면 다 쓴 뒤 사용이 막힌다. 다음 순서로 본다(읽기만):

1. **사용량**: 조직 Settings → **Billing & licensing** → **Usage**(또는 Metered usage) → Actions 분 사용량·한도. REST 로는
   `gh api /organizations/Penta-PM/settings/billing/usage`(조직 소유자, "enhanced billing platform" 조직만 — 아니면 화면으로).
2. **조직 Actions 정책**: 조직 Settings → Actions → General — Actions 가 꺼져 있는지(꺼져 있으면 어떤 워크플로도 돌지 않는다),
   허용 액션이 "조직 안 액션만" 인지(`actions/checkout` 등 GitHub 액션이 막힌다), "액션을 전체 커밋 SHA 로 고정 필수" 인지(이 저장소는 `@v4` 태그라 막힌다).
3. **저장소 Actions 설정**: 저장소 Settings → Actions → General 의 Actions permissions.
4. 결과(원인·조치)는 PR-5 와 이 문서 머리말 전제에 적는다. 분 한도가 원인이면 결제 수단·예산 설정 또는 플랜 변경은 사용자 결정이다.
   한도 소진 시 잡이 queued 로 남는지 실패하는지는 문서에 명시가 없다 — 확인한 동작을 함께 기록한다.

## 6. 근거 (공식 문서, 2026-10-02 확인)

- GitHub "Managing environments for deployment" — "For access to environments, environment secrets, and deployment branches in private or internal repositories,
  you must use GitHub Pro, GitHub Team, or GitHub Enterprise. If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, other deployment protection rules,
  such as a wait timer or required reviewers, are only available for public repositories." https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub "Deployments and environments" — environment secrets(Free 는 public 만), required reviewers(Free·Pro·Team 은 public 만), deployment branches(Pro·Team 은 private 가능).
  https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub "Events that trigger workflows" — `repository_dispatch`·`workflow_dispatch`·`workflow_run`: "This event will only trigger a workflow run if the workflow file exists on the default branch."
  `deployment_status`: `GITHUB_SHA` = "Commit to be deployed"(기본 브랜치 조건 없음). `pull_request`: PR 머지 커밋. https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- GitHub "Secure use reference" — "Any user with write access to your repository has read access to all secrets configured in your repository." https://docs.github.com/en/actions/reference/security/secure-use
- GitHub "Using secrets in GitHub Actions" — 포크 워크플로에는 시크릿 미전달, "Organization-level secrets and variables are not accessible by private repositories for GitHub Free."
  https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- GitHub "About protected branches"·"About rulesets"·"About code owners" — Free 는 public 저장소만. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub "GitHub Actions billing" — GitHub Free for organizations 2,000분/월, "If your account does not have a valid payment method on file, usage is blocked once you use up your quota."
  https://docs.github.com/en/billing/concepts/product-billing/github-actions · 사용량 보기 https://docs.github.com/en/billing/how-tos/products/view-productlicense-use ·
  REST https://docs.github.com/en/rest/billing/usage · 조직 Actions 정책 https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization
- GitHub "Dependency caching" — 실행은 현재 브랜치·기본 브랜치 캐시를 복원한다. https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- Vercel "Vercel for GitHub" — `repository_dispatch` 이벤트 `vercel.deployment.success` 등, `github.event.client_payload.url`·`environment`, deployment_status 대신 repository_dispatch 권고,
  `deployment_status` Events 토글로 끄기. https://vercel.com/docs/git/vercel-for-github
- Vercel "System environment variables" — `VERCEL_AUTOMATION_BYPASS_SECRET`: "Available at: Both build and runtime."
  https://vercel.com/docs/environment-variables/system-environment-variables · Protection Bypass for Automation https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
