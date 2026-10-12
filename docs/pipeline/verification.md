# 검증 규칙 (Dev · QA · Main 공용)

- 출처: CI 사용량 절감 스펙 `docs/specs/ci-usage-reduction.md` §3 (Plan 브랜치), Main 승인(사용자 확인, 2026-10-02)
- 적용: CI 라벨 게이트(PR #37) 머지 직후부터 모든 PR
- 이 문서가 **단일 원본**이다. 각 역할 워크트리의 `CLAUDE.md` 는 이 문서를 참조하고 체크리스트 요약만 둔다.
  (Dev 는 `feat/*` 브랜치에서 일하므로 역할 브랜치의 `CLAUDE.md` 를 보지 못한다 — main 문서는 모든 브랜치에 있다.)

## 0. 배경 — 왜 이 규칙인가

- GitHub Free 플랜은 월 2,000분이다. 2026-10 은 이틀 만에 397분을 썼다(머지 1건 ≈ 50분).
- 그래서 CI(`.github/workflows/ci.yml`)는 PR 에서만 돌고, 무거운 단계(lint·typecheck·unit coverage·build·integration·e2e)는
  PR 에 **`ci:run` 라벨이 있을 때만** 돈다. 라벨 없는 PR 은 secret scan 과 판정만(약 1분) 돈다.
  판정은 job 로그에 `CI 판정: <문서 전용: secret scan만 | ci:run 없음: 경량 | 다른 라벨 추가: 경량 | 전체>` 로 남는다
  (`gh run view <id> --log | grep 'CI 판정:'`). "다른 라벨 추가: 경량"은 `ci:run` 이 이미 붙은 PR 에 다른 라벨을 더했을 때로,
  전체를 다시 돌리지 않고 진행 중인 `ci:run` 실행도 취소하지 않는다.
- 브랜치 보호·ruleset·필수 검사를 쓸 수 없다(Free 플랜 403). **CI 통과는 이 규칙으로만 강제된다.**
- main push 실행은 없다. PR CI 는 `refs/pull/N/merge` 를 검증하므로, 머지 전에 PR 이 최신 main 을 포함하는지 확인하는 것으로 대신한다.

## 1. Dev 게이트 (로컬, PR 올리기 전)

새로 만든 격리 DB 에서 다음을 실행한다.

| 명령 | 내용 |
| --- | --- |
| `pnpm check` | lint · typecheck · format · unit |
| `pnpm test:coverage` | 단위 + coverage 80% |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm check:prerender` · `pnpm check:trace` · `pnpm check:secrets` | 정적 프리렌더 없음 · 함수 번들 PGlite 없음 · 비밀값 없음 |
| integration | `DB_DRIVER=pg DATABASE_URL=<격리 DB> pnpm db:migrate && pnpm seed && pnpm test:integration` (`PRAMI_ALLOW_SEED=1`) |
| 영향받는 E2E 스펙 | 변경과 관련된 `tests/e2e/*.spec.ts` 만. **E2E 전체는 Dev 가 돌리지 않는다**(QA 몫) |

- 로컬 vitest 는 `--maxWorkers=2` 이하로 돌린다(4코어 공유 호스트).
- PR 본문에 `## 로컬 검증` 블록을 남긴다:
  - 커밋 SHA
  - DB (새로 만들었는지 / 기존 것인지, 이름)
  - 명령별 passed / failed 수
  - 실패가 있으면 main 과 대조한 결과
- PR 은 **라벨 없이** 올린다. 이 단계에서 CI 는 secret scan 과 판정만 돈다.

## 2. QA 검증 (로컬)

- 스펙 수용 기준으로 실제 검증하고, **E2E 전체를 1회** 돌린다(새 DB, PR head SHA).
- **문서 전용 PR**(생략 대상 경로 — `CLAUDE.md`·`README.md`·`docs/specs/**`·`docs/qa/**`·`docs/pipeline/**` — 만 바뀐 PR)은
  QA E2E 전체 1회를 생략하고, QA 는 문서 검토와 secret scan 녹색만 확인한다. 생략 대상 밖의 경로가 하나라도 바뀌면 일반 규칙을 따른다.
- Dev 와 QA 가 E2E 를 **동시에 돌리지 않는다**(4코어 호스트 과부하). 로컬 vitest 는 `--maxWorkers=2` 이하.
- 반복 실행은 실패가 1회 나왔는데 main 에서 재현되지 않을 때만, **해당 스펙만** `--repeat-each=3`.
  전체 반복은 금지한다. 스펙에 "연속 N회"가 명시돼 있으면 그 지시를 따른다.
- 다음 중 하나라도 해당하면 QA 는 Dev 결과를 믿지 않고 해당 영역을 직접 다시 돌린다:
  - Dev 기록에 SHA 나 DB 정보가 없거나, 기록된 SHA 가 PR head 와 다르다.
  - `playwright.config.ts`, `src/proxy.ts`, auth/session, `drizzle/**`, `src/components/ui/**` 중 하나가 바뀌었다.
- QA 승인 형식에 반드시 넣는다:
  - `검증 SHA: <sha>`
  - `SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA` (rebase 로만 달라진 경우는 그 사실과 diff 동일 여부를 적는다)

## 3. 머지 (Dev)

머지 전에 세 가지를 **모두** 확인한다.

1. **최신 main 포함**: `git fetch origin && git merge-base --is-ancestor origin/main origin/<branch>` 가 참.
   거짓이면 rebase 하고 다시 확인한다(rebase 하면 head SHA 가 바뀌므로 2·3 도 다시).
2. **head SHA 의 `ci:run` 녹색**: QA 통과 후 PR 에 `ci:run` 라벨을 붙여 1회 돌리고, 그 run 의 head SHA 가 머지할 head SHA 와 같고 녹색이다.
   (`gh pr checks <N>` 전부 pass, `gh run view <id> --json headSha`)
   - **문서 전용 PR**(`CLAUDE.md`·`README.md`·`docs/specs/**`·`docs/qa/**`·`docs/pipeline/**` 만 변경)은 라벨이 있어도 secret scan 만 돈다.
     이 경우 2번은 **head SHA 에서 문서 전용 판정 run(secret scan)이 녹색**이면 충족한다(로그 `CI 판정: 문서 전용: secret scan만`).
3. **SHA 대조**: head SHA = QA 승인서의 `검증 SHA`. rebase 로만 달라졌다면 `git range-diff` 로 diff 가 같은지 확인하고 그 사실을 기록한다.

- 머지는 `gh pr merge <N> --squash`. `--delete-branch` 는 역할 브랜치에 쓰지 않는다.
- 머지 완료 보고(Main)에 **머지 SHA** 와 **ci:run run URL** 을 넣는다.
- **연속 머지**(예: Motion PR-2 → 3 → 4)에서는 앞 PR 이 머지될 때마다 뒤 PR 에 대해 1번을 다시 확인한다.

## 4. CI 실패 분류 (Dev)

| 분류 | 판단 | 조치 |
| --- | --- | --- |
| 실제 버그 | 로컬에서도 재현, 또는 원인이 PR 변경 | 수정 → QA 재검증 요청 |
| flake | 원인이 PR 밖(타이밍·부하), main 에서도 같은 실패 기록 | **rerun 1회까지**, PR 에 기록하고 QA 백로그에 넣는다 |
| 환경 차이 | 로컬 녹색 · CI 빨강, 원인 불명 | Plan 에 되묻는다 |

## 5. Plan 수용 기준 표준 문구

스펙의 "단위·E2E 전부 통과" 대신 다음 문구를 쓴다:

> Dev 게이트 기록(§1) + QA E2E 전체 1회(§2) + 머지 head SHA 의 `ci:run` 녹색(§3)

## 6. 운영 제약 (모든 태스크 공통, Plan `docs/specs/operating-constraints.md`)

- 자기가 띄운 dev 서버만 **PID 또는 포트로 정확히** 종료한다. `pkill -f next`, `pkill -f "next dev"` 같은 넓은 패턴 금지.
- `:3000` 과 `/home/plan1/Desktop/Prami` 경로의 프로세스는 건드리지 않는다(사용자 실사용 경로).
- `docker compose down` 등 공용 DB 컨테이너(`prami-postgres-1`) 중지 금지 — Main 서버도 같은 DB 를 쓴다.
- 포트: Main 3000 / Dev 3001 / QA 3200대. 이미 다른 프로세스가 쓰는 포트는 피한다(점유자를 종료하지 않는다).
