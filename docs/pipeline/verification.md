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

## 2.5 :3000 미리보기 (2026-10-30, Plan `docs/specs/preview-on-3000.md`)

CI·머지를 기다리지 않고 사용자가 :3000(LAN `next dev`, Dev 워크트리 체크아웃)에서 바로 확인합니다. **CI 는 main 머지 게이트로 그대로**이고, 미리보기는 머지 조건이 아닙니다(Main 이 "확인 후 머지" 로 지정한 작업만 사용자 OK 전 머지 금지).

1. **흐름**: Dev 구현(wt-*) → 미리보기 게이트 → :3000 = 작업 브랜치 커밋 → Main 에 `[미리보기 준비됨]`(+ Plan 한 줄) → 피드백(Main → Plan → Dev, 방향이 바뀌면 Plan 이 스펙 갱신) → 같은 브랜치 수정·:3000 갱신 반복 → Dev 게이트 + CI 녹색 → 셀프머지 → :3000 = main 복귀 `[미리보기 종료] :3000 = main @ <SHA>, /login 200`.
2. **미리보기 게이트**: 커밋·푸시된 SHA 만(미커밋 금지, Dev 워크트리에서 직접 개발 금지). 그 SHA 에서 typecheck + 바뀐 영역 단위 통과 → 전환 후 `/login`·볼 곳 200, dev 서버 로그에 컴파일 오류 없음. lockfile 이 바뀌면 `pnpm install --frozen-lockfile --offline`(복귀 때도). 실패하면 즉시 main(또는 직전 미리보기 SHA)으로 되돌리고 보고. 재시작은 사전 승인 — 그 프로세스만 PID/포트로, `.env.local`·`prami-postgres-1` 은 건드리지 않음.
3. **슬롯 — 한 번에 한 브랜치**: 사용자가 확인 중인(가장 최근 `[미리보기 준비됨]`) 작업이 슬롯을 가짐. 다른 작업이 준비되면 바로 바꾸지 않고 Main 에 `[미리보기 대기] <작업> — 현재 슬롯: <작업>`. 사용자 OK·머지된 작업이면 바로 교체 가능, 30분 넘게 반응이 없으면 Main 에 교체를 물음(임의 교체 금지). 통합 브랜치 미리보기 금지. 긴급 버그는 Main 지시로 선점.
4. **마이그레이션**: 추가형만·적용 전 `pg_dump` 백업 + 경로 보고, 그리고 **스키마 동결 후에만 LAN 적용**(그 전엔 자기 포트 :32xx + 합성 DB, :3000 은 UI 가 스키마와 무관할 때만). 머지 때 같은 파일·같은 번호. 스키마를 바꿔야 하면 새 추가형 마이그레이션 또는 Plan 승인 down SQL — 백업 복원은 최후 수단(Main 승인).
5. **알림 형식** (Dev → Main, Plan 에 한 줄 사본):
   ```
   [미리보기 준비됨] <작업명> — :3000 = <브랜치> @ <SHA 7자>
   볼 곳: - <URL 경로> — <무엇을 보면 되는지>  (여러 개)
   미완성/알려진 차이: ... (없으면 "없음")
   DB: 변경 없음 | 마이그레이션 <번호> 적용(백업 <경로>)
   슬롯 이전 상태: main | <이전 작업 브랜치>
   ```
6. **표시 띠**: :3000 이 main 이 아니면 화면 맨 위에 "미리보기 중 — <브랜치> @ <SHA 7자> (main 아님)"(`src/components/PreviewBanner.tsx`, 요청 시점에 `.git` HEAD 를 읽고 ≈5초 캐시). detached 라도 SHA 가 main 과 같으면 띠 없음. production·E2E(`PREVIEW_BANNER=off`)에서는 그리지 않음.

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
- **마이그레이션 포함 PR**(`drizzle/*.sql` 변경)은 머지 **직후** LAN 개발 DB 에 적용한다(Plan `docs/specs/migration-apply-lan.md`, 2026-10-20 0008·0009 미적용으로 가격정책 화면·알림이 죽은 사례).
  1. LAN 서버가 쓰는 DB 접속 정보는 Main 워크트리 env 파일에서 **읽기만**(파일 수정·LAN 서버/:3000 재시작·컨테이너 중지 금지).
  2. 적용 전 백업: `docker exec prami-postgres-1 pg_dump -U prami -Fc <db> > <스크래치>/…dump`.
  3. **머지된 origin/main 과 같은 코드**(작업 브랜치가 아닌 main 기준 임시 워크트리)에서 그 DB 대상으로 `pnpm db:migrate`.
  4. 확인: `drizzle.__drizzle_migrations` 행 수 = main `drizzle/meta/_journal.json` 항목 수, 새 테이블 존재, 기존 테이블 행 수 무변화.
  5. 머지 완료 보고에 **적용한 마이그레이션 목록·백업 경로**를 함께 적는다.
  - 개발 서버(`next dev`)는 기동 시 미적용 마이그레이션이 있으면 콘솔에 파일 목록 + `pnpm db:migrate` 안내를 띄운다(자동 적용은 하지 않음).
- **LAN :3000 이 Dev 워크트리를 서빙할 때**(Plan `docs/specs/migration-apply-lan.md` §6, 2026-10-21 Main msg_011f4cff3c74 — `pnpm dev:lan` 이 Dev 워크트리의 현재 체크아웃을 핫리로드로 서빙, `.env.local` 은 Main 원본으로의 심볼릭 링크):
  1. **서버**: Dev 는 :3000 서버·그 터미널을 종료·재시작하지 않는다. E2E 는 기존대로 별도 포트·`.next-e2e`, 게이트 빌드도 `.next` 가 아닌 별도 `NEXT_DIST_DIR` 로. `.env.local` 수정 금지(Main 원본이 바뀐다).
  2. **노출 인지**: Dev 워크트리의 체크아웃·미커밋 변경이 사용자에게 바로 보인다. 깨진 중간 상태를 오래 두지 않고, 큰 리팩터링·실험은 서빙되지 않는 임시 git 워크트리에서 한 뒤 가져온다.
  3. **미머지 마이그레이션**(브랜치에 새 `drizzle/*.sql` 이 생길 때):
     - **추가형만**(테이블·컬럼·인덱스 추가, nullable 또는 기본값 있는 컬럼). 삭제·이름 변경·타입 변경 등 파괴적 변경은 Plan 에 먼저 되묻는다. 추가형이라 main 코드(다른 브랜치)로 돌아가도 기존 쿼리가 동작한다.
     - 그 브랜치를 Dev 워크트리에 체크아웃하기 **직전에** LAN DB `pg_dump` 백업 → 그 브랜치 코드로 `pnpm db:migrate` → :3000 이 깨지지 않게 한다. 적용한 파일명·백업 경로를 Plan·Main 에 짧게 보고.
     - **한 번 LAN DB 에 적용한 마이그레이션 파일은 수정하지 않는다**(drizzle 기록 해시 불일치). 바꿀 게 있으면 새 마이그레이션을 추가.
     - PR 이 폐기되거나 마이그레이션을 되돌려야 하면 백업으로 복원하고 Plan·Main 에 보고.
  4. 이렇게 미리 적용한 마이그레이션은 머지 직후 위 1~5 확인(행 수 = 저널 항목 수 등)만 하고 보고에 "머지 전 적용" 으로 적는다. 되돌리기(Main 워크트리 서빙 복귀)는 Main 이 결정·실행.

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
