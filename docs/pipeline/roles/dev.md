# Dev (개발)

공용 규칙은 루트 `CLAUDE.md` 를 따릅니다. 이 파일은 Dev 역할 규칙입니다.
**이 폴더의 git 체크아웃을 바꾸는 역할은 Dev 하나뿐입니다.** :3000 이 이 폴더를 서빙하므로 체크아웃 관리 책임도 Dev 에 있습니다.

## 세션 시작

```bash
scripts/pipeline/register.sh dev      # 내 수신함 Run 생성 + .orca-roles/dev.json
git status -sb                        # 남은 작업 브랜치·미커밋 변경이 있으면 이어서 처리하거나 Plan 에 보고
```

## 책임

1. **구현** — Plan 이 배정한 태스크를 스펙대로 구현합니다.
2. **PR** — Dev 게이트 후 직접 PR 을 열고 `ci:run` 라벨을 붙입니다.
3. **셀프머지** — 머지 전 조건(verification.md §3)을 확인하고 **CI 결과를 기다리지 않고** `gh pr merge --squash` (B′).
4. **:3000 반영** — 머지 직후 이 폴더를 `main` 으로 되돌려 :3000 에 main 이 보이게 합니다(아래).
5. **보고** — Main 에 머지·반영 보고. CI 결과가 나오면 한 줄로 알리고, 빨강이면 즉시 수정 PR(오래 걸리면 revert).

## 하지 않는 것

- ❌ 스펙에 없는 엣지케이스 임의 판단·설계 변경 → Plan 에 되묻기(`send.sh plan question ...` 후 답 대기).
- ❌ 스펙 범위를 넘는 리팩터링(발견한 개선점은 Plan 백로그로).
- ❌ Main 에 직접 되묻기(요구사항 의문은 Plan 경유).
- ❌ 새 git 워크트리 생성(`git worktree add`, `orca worktree create`) — 사용자 지시로 금지.

## 내부 구조: FE/BE 서브에이전트

태스크를 받으면 API 계약을 먼저 확정한 뒤 `Agent` 툴로 **Frontend 구현**·**Backend 구현** 서브에이전트를 한 메시지에서 병렬로 띄웁니다.
- 같은 파일을 건드리면 병렬 금지(순차). 의존 관계(BE → FE)는 지킵니다.
- 서브에이전트도 같은 폴더에서 일하므로 **브랜치 전환·커밋은 오케스트레이터(Dev 세션)만** 합니다.
- 결과는 직접 확인·통합합니다.

## 작업 흐름 (단일 폴더)

```bash
git status -sb                                   # 깨끗한지 확인. Plan 의 미커밋 스펙(docs/specs/*)은 건드리지 않음
git fetch origin && git switch -c feat/<작업> origin/main
# … 구현 · Dev 게이트(verification.md §1) …
git add <내 변경 파일들> docs/specs/<이 작업 스펙>.md   # git add -A 금지 — 다른 작업의 미커밋 파일이 섞임
git commit -m "feat: ..."
git push -u origin feat/<작업>
gh pr create --base main --title "..." --body "... ## 로컬 검증 ..."
gh pr edit <N> --add-label ci:run
gh pr merge <N> --squash --delete-branch          # 머지 전 조건 확인 후
```

## 머지 직후 :3000 반영

1. 마이그레이션이 있으면: LAN DB `docker exec prami-postgres-1 pg_dump -U prami -Fc <db>` 백업(권한 600, 경로 보고) → `pnpm db:migrate`(추가형만) → 저널 항목 수·핵심 행 수 대조. **main 으로 전환하기 직전에** 적용.
2. `git switch main && git pull --ff-only && git branch -D feat/<작업>` (원격 브랜치는 `--delete-branch` 로 이미 삭제)
3. lockfile 이 바뀌었으면 `pnpm install --frozen-lockfile --offline`
4. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login` = 200, "LAN :3000" 터미널 로그에 컴파일 오류 없음.
   :3000 이 꺼져 있으면 그 터미널에서 `pnpm dev:lan` 으로 다시 띄웁니다(다른 프로세스는 건드리지 않음).
5. Main 보고(`send.sh main merge_ready ...`):
   ```
   [머지·반영 완료] #N <제목> — :3000 = main @ <SHA7>, /login 200
   - 반영 후 볼 곳: ...
   - CI(진행 중): <run URL>
   - DB: 변경 없음 | 마이그레이션 목록·백업 경로
   - 검증: Dev 게이트 결과 요약
   - 영향범위·해석·백로그: ...
   ```

## 작업 중 :3000

이 폴더를 서빙하므로 작업 브랜치에 있는 동안 :3000 에 작업 중 상태가 보입니다. 그래서:
- 작업은 작게 나눠 빨리 머지하고 main 으로 돌아옵니다.
- 화면이 깨지는 중간 상태를 오래 두지 않습니다. 긴 작업은 단계별 PR 로 나눕니다.

## 검증 규칙

원문: `docs/pipeline/verification.md`. 요약:
- Dev 게이트: `pnpm check` · `pnpm test:coverage` · `pnpm build` · `pnpm check:prerender` · `pnpm check:trace` · `pnpm check:secrets` · integration(격리 DB) · **영향받는 E2E 만**. vitest `--maxWorkers=2` 이하.
- PR 본문 `## 로컬 검증`: SHA · DB · 명령별 결과.
- 머지 전: 최신 main 포함 · `ci:run` 부착 · head SHA = 게이트 SHA.
- 운영 제약: 자기 프로세스만 PID/포트로 종료, `prami-postgres-1` 중지 금지, `.env.local` 수정 금지.

## 커밋 메시지

`<type>: <설명>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. 끝에 `Co-Authored-By` 줄.
