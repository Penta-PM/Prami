# 스펙: GitHub Actions CI 사용량 절감 + 검증 중복 정리

- 요구사항: Main `msg_604035d2087c` (2026-10-02)
- 되묻기 답변: Main `msg_eee19a41965b`. 사용자 확인 완료, 세 질문 모두 A.
- 상태: 확정 → Dev 배정. 우선순위는 Motion PR-2 머지 직후, PR-3보다 먼저 들어갑니다. 한도 소진이 10/10 전후로 예상되기 때문입니다.

## 1. 실측 근거 (gh API)

- Free 플랜, private 저장소, 한도 월 2,000분. 사용량은 9월 346분, 10월은 이틀 만에 397분.
- 머지 1건 ≈ PR 실행 1.4회 + main push 1회 ≈ 50분.
- 실행 1회 ≈ 20 billable 분. 그중 coverage를 켠 단위 테스트가 45~55%, E2E는 약 6분, Playwright 설치는 약 30초.
- 실패 8건 중 6건은 타이밍성 flaky 단위 테스트: `xai-adapter` 503, `llm-diagnostics-r2:262`, `costs/ui` dialog.
- 브랜치 보호·ruleset·Draft PR을 쓸 수 없습니다(403). 필수 검사가 없으므로 CI 통과는 **규칙으로만** 강제됩니다.
- 보안 워크플로(deploy-production·preview-migrate·preview-smoke)는 `ci.yml`과 연결돼 있지 않습니다(`workflow_run`·`needs` 0건). deploy-production은 `workflow_dispatch` 전용입니다.
- main은 squash 머지입니다. PR CI는 `refs/pull/N/merge`를 검증하므로, PR이 최신 main을 포함하고 있으면 main push 실행은 중복입니다.

## 2. 기술 결정 (Dev는 이대로 구현)

### PR-A: `ci.yml`
1. **push(main) 트리거를 제거**하고 `pull_request`만 남깁니다. `tests/unit/ops/workflows.test.ts:323`의 트리거 고정값을 `['pull_request']`로 바꿉니다(트리거가 줄어드는 쪽이라 보안 강화 방향).
2. **라벨 게이트**를 둡니다.
   - `pull_request.types`: `[opened, synchronize, reopened, labeled]`.
   - 무거운 job(quality, e2e)은 `if: contains(github.event.pull_request.labels.*.name, 'ci:run')` 조건으로만 돕니다.
   - 라벨이 붙은 뒤 push가 오면 `synchronize`로 다시 돕니다.
   - **`pull_request_target`은 금지합니다.**
3. **job 통합**
   - secret scan을 quality의 한 단계로 넣되, 라벨과 무관하게 항상 돌게 합니다. 구현 방법: quality job은 항상 시작하고, secret scan 다음 단계부터 라벨 조건으로 건너뜁니다. 같은 효과를 내는 다른 구조도 됩니다.
   - integration은 e2e job 안으로 넣습니다. 같은 postgres 서비스를 쓰고 DB 이름만 분리합니다.
   - quality → e2e의 `needs`는 유지합니다. 병렬화하지 않습니다.
4. **문서 전용 변경 감지**
   - `git diff --name-only <base>...<head>` 셸 단계로 판정합니다. 토큰, API, 외부 action은 쓰지 않습니다.
   - 생략 대상은 `CLAUDE.md`, `README.md`, `docs/specs/**`, `docs/qa/**`, `docs/pipeline/**`뿐입니다(`docs/pipeline/**`는 §7 결정으로 추가). 이 파일만 바뀐 PR은 secret scan만 돌립니다.
   - `docs/**` 전체는 생략 대상이 아닙니다. 단위 테스트가 `docs/ops`, `docs/deploy`, `docs/chat`, `vercel.md`를 직접 읽기 때문입니다.
5. **요약 단계**: 항상 실행되는 job 1개(또는 단계)가 `$GITHUB_STEP_SUMMARY`에 판정을 기록합니다. 판정 값은 "문서 전용: secret scan만", "ci:run 없음: 경량", "전체" 중 하나입니다.
6. 워크플로 단위 `paths-ignore`는 쓰지 않습니다. 나중에 Team 플랜으로 바꾸면 필수 검사가 영구 대기에 걸리기 때문입니다.
7. 권한은 `permissions: {contents: read}` 그대로입니다. `github.token` 사용 금지 규칙과 시크릿 설정도 바꾸지 않습니다. 보안 워크플로 3개는 손대지 않습니다.
8. Playwright 브라우저 캐시는 **보류**합니다. 절감이 실행당 0~1분 수준입니다.
9. `timeout-minutes`: quality는 15분인데 실측이 12분까지 늘고 있습니다. PR-C 결과를 보고 다시 판단하고, 이번에는 바꾸지 않습니다.
10. 문서 `docs/deploy/github-plan.md:18,85`와 `vercel.md:15,212`의 "CI 4잡" 서술을 새 구조에 맞게 고칩니다.
11. 라벨 `ci:run`은 PR-A **머지 전에** `gh label create ci:run`으로 만듭니다.

### PR-B: `docs/pipeline/verification.md` (main, 공용 규칙)
- Dev·QA·Main이 따르는 검증 규칙의 단일 원본입니다(3절 내용).
- 이유: Dev는 `feat/*` 브랜치에서 일하기 때문에 역할 브랜치의 CLAUDE.md를 보지 못합니다. main 문서는 모든 브랜치에 들어 있습니다.
- 각 역할 CLAUDE.md에는 "검증 규칙은 `<저장소>/docs/pipeline/verification.md`를 따른다"는 참조와 체크리스트 요약만 둡니다.
  - Dev 브랜치 CLAUDE.md: Dev가 커밋합니다.
  - QA 브랜치 CLAUDE.md: Dev가 QA에게 전달하고 QA가 커밋합니다.

### PR-C: 단위 테스트 가속 + flaky 수정 (테스트 인프라)
- 먼저 coverage 오버헤드를 측정합니다(coverage on/off 시간 비교).
- CI의 vitest `maxWorkers`를 러너 코어 수(2)에 맞춥니다. 로컬 기본값은 `vitest.config.mts`에서 env로 분기합니다.
- PGlite 마이그레이션 템플릿을 재사용할 수 있으면 적용합니다(측정 후 판단, 효과가 없으면 생략하고 기록).
- 타이밍성 flaky 3건을 고칩니다. 가짜 타이머나 명시적 대기로 바꾸고, sleep 기반 단언은 없앱니다.
  - `xai-adapter` 503(`timeout` vs `http`)
  - `llm-diagnostics-r2:262`
  - `costs/ui` 수정 모달
- **coverage 80% 기준은 CI에 그대로 유지합니다.**

## 3. 검증 규칙 (PR-B 문서의 내용)

### 3.1 Dev 게이트 (로컬, PR 올리기 전)
- 새 격리 DB에서 실행합니다: `pnpm check`(lint·typecheck·format·unit), `test:coverage`, `build`, `check:prerender/trace/secrets`, integration, **변경 영향을 받는 E2E 스펙**.
- E2E 전체는 Dev가 돌리지 않습니다.
- PR 본문에 `## 로컬 검증` 블록을 남깁니다: 커밋 SHA, DB(새로 만들었는지 / 기존 것인지), 명령별 passed/failed 수, 실패가 있으면 main과 대조한 결과.
- PR은 라벨 없이 올립니다. 이 단계에서는 CI가 secret scan과 요약만 돕니다.

### 3.2 QA 검증 (로컬)
- 스펙 수용 기준으로 실제 검증하고, **E2E 전체를 1회** 돌립니다(새 DB, PR head SHA).
- Dev와 QA가 E2E를 **동시에 돌리지 않습니다.** 4코어 호스트라 과부하가 생깁니다. 로컬 vitest는 `--maxWorkers=2` 이하로 돌립니다.
- 반복 실행은 실패가 1회 나왔는데 main에서 재현되지 않을 때만, 해당 스펙만 `--repeat-each=3`으로 돌립니다. 전체 반복은 금지합니다. 스펙에 "연속 N회"가 명시돼 있으면 예외로 그 지시를 따릅니다.
- QA가 Dev 결과를 믿지 않고 해당 영역을 직접 다시 돌리는 조건(하나라도 해당하면):
  - Dev 기록에 SHA나 DB 정보가 없거나, 기록된 SHA가 PR head와 다르다.
  - `playwright.config.ts`, `src/proxy.ts`, auth/session, `drizzle/**`, `src/components/ui/**` 중 하나가 바뀌었다.
- QA 승인 형식에는 다음을 반드시 넣습니다:
  - `검증 SHA: <sha>`
  - 머지 전 대조 항목: `검증 SHA = 머지 head SHA = ci:run 녹색 run의 head SHA`(rebase로만 달라진 경우는 그 사실을 적습니다)

### 3.3 머지 (Dev)
- 머지 전에 세 가지를 **모두** 확인합니다.
  1. `git fetch && git merge-base --is-ancestor origin/main origin/<branch>`가 참이다(최신 main을 포함). 거짓이면 rebase하고 다시 확인합니다.
  2. 머지할 head SHA에서 `ci:run` 실행이 녹색이다. QA 통과 후 라벨을 붙여 1회 돌립니다.
  3. head SHA = QA 승인서의 검증 SHA이다. rebase로만 달라졌다면 diff가 같은지 확인하고 그 사실을 기록합니다.
- 머지 완료 보고에 머지 SHA와 CI run URL을 넣습니다.
- 연속 머지(PR-2→3→4)에서는 앞 PR이 머지될 때마다 뒤 PR에 대해 1번을 다시 확인합니다.

### 3.4 CI 실패 분류 (Dev)
- 실제 버그: 수정한 뒤 QA에 재검증을 요청합니다.
- flake: rerun은 1회까지만 허용하고, PR에 기록한 뒤 QA 백로그에 넣습니다.
- 환경 차이(로컬은 녹색, CI는 빨강, 원인 불명): Plan에 되묻습니다.

### 3.5 Plan 수용 기준 표준 문구 (Plan 자체 규칙)
- 지금까지 쓰던 "단위·E2E 전부 통과" 대신 다음 문구를 씁니다: **"Dev 게이트 기록(3.1) + QA E2E 전체 1회(3.2) + 머지 head SHA의 ci:run 녹색(3.3)"**.

## 4. 비범위
- 보안 워크플로 3개 변경, 권한·시크릿 변경.
- Playwright 캐시.
- coverage 기준을 로컬로 옮기는 것.
- 병렬화로 wall-clock 단축.
- Team 플랜 전환.

## 5. 수용 기준

### PR-A
- [ ] `ci.yml` 트리거가 `pull_request`만이고, `pull_request_target`이 없다. `workflows.test.ts` 통과(트리거 고정값 `['pull_request']`, `contents: read`, `github.token` 금지 유지).
- [ ] 라벨 없는 PR: secret scan과 요약만 돌고 나머지는 skip된다. 해당 run의 과금 분이 2분 이하다.
- [ ] `ci:run` 라벨을 붙이면 quality·e2e(integration 포함)가 1회 돈다. 라벨이 붙은 상태에서 push하면 다시 돈다.
- [ ] `CLAUDE.md`·`docs/specs/**`·`docs/qa/**`·`docs/pipeline/**`·`README.md`만 바뀐 PR은 라벨이 있어도 secret scan만 돈다. `docs/ops/**`가 바뀐 PR은 라벨이 있을 때 quality가 돈다.
- [ ] Job Summary에 판정(문서 전용 / 경량 / 전체)이 기록된다.
- [ ] 보안 워크플로 3개의 diff가 0이다.
- [ ] `github-plan.md`·`vercel.md`의 CI job 서술이 새 구조와 일치한다.
- [ ] PR 본문에 같은 변경 기준의 이전/이후 과금 분 비교(실측 run URL)가 있다.

### PR-B
- [ ] main에 `docs/pipeline/verification.md`가 있고 3절 규칙을 모두 담는다.
- [ ] Dev 브랜치 CLAUDE.md, QA 브랜치 CLAUDE.md에 이 문서의 절대경로 참조와 체크리스트 요약이 있다. QA는 승인 형식에 `검증 SHA`와 SHA 대조 줄이 있다.

### PR-C
- [ ] coverage on/off 측정값과 적용한 최적화별 효과가 PR 본문에 있다.
- [ ] flaky 3건이 가짜 타이머나 명시적 대기로 바뀌었고, 해당 테스트를 `--repeat-each=20`(로컬, `--maxWorkers=2`)으로 돌려 0 실패다.
- [ ] CI quality job 시간이 PR-A 이후 기준선보다 줄었다(run URL로 비교). coverage 80% 기준이 유지된다.

## 6. 태스크
1. **[PR-A]** `ci.yml` 개편, `workflows.test.ts`, 배포 문서 문구 수정. 머지 전에 `ci:run` 라벨을 만듭니다.
2. **[PR-B]** `docs/pipeline/verification.md` 작성. 이어서 Dev 브랜치 CLAUDE.md 참조 추가(Dev 커밋)와 QA 브랜치 CLAUDE.md 참조 추가(Dev가 QA에 전달, QA 커밋).
3. **[PR-C]** 단위 테스트 가속과 flaky 수정.

의존 관계: 1 → 2 → 3. PR-A는 Motion PR-2 머지 직후, PR-3보다 먼저 들어갑니다. 파일 겹침은 0입니다. PR-A가 머지되면 진행 중인 PR도 다음 실행부터 새 규칙(라벨 게이트)을 따릅니다. PR-A 자체는 기존 트리거로 1회 돕니다.

운영 제약은 `docs/specs/operating-constraints.md`를 따릅니다.

## 7. 구현 중 결정 (Dev 되묻기 `msg_51d2c85df5b0` → Plan 결정, 2026-10-02)

- PR-A(#37) 실측: 라벨 없음 1분, `ci:run` 전체 18분, 문서 전용 1분. 이전에는 PR 21분 + main push 18분.
- **`docs/pipeline/**`를 문서 전용 생략 대상에 추가한다 (A).** 이 폴더를 읽는 단위 테스트가 없고, `docs/**` 전체를 제외한 이유(테스트가 `docs/ops`·`deploy`·`chat`·`vercel.md`를 읽음)에 해당하지 않는다. 생략 대상에서도 secret scan은 계속 돈다.
- 보호 장치: `ci.yml`의 판정 정규식 옆에 "이 목록의 경로를 읽는 테스트가 생기면 목록에서 뺄 것"이라는 주석을 단다. `workflows.test.ts`가 생략 대상 목록을 정확히 고정한다(목록이 넓어지면 테스트가 실패하도록).
- 문서 전용 PR의 머지 규칙 3.3-②는 "head SHA에서 문서 전용 판정 run(secret scan) 녹색"으로 충족한다.
