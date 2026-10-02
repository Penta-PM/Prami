# Prami — Dev (개발)

> **이 워크트리의 역할은 Dev 입니다.** 다른 역할의 지시를 이 파일에서 찾지 마세요.
> 각 역할은 자기 워크트리의 CLAUDE.md만 따릅니다.

## 관련 워크트리 (Orca 관리)

| 역할 | 브랜치 | 경로 | Orca 워크트리 ID |
|------|--------|------|------------------|
| Main | `main` | `/home/plan1/Desktop/Prami` | `b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/Desktop/Prami` |
| Plan | `Plan` | `/home/plan1/orca/workspaces/Prami/Plan` | `b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/orca/workspaces/Prami/Plan` |
| **Dev** (현재) | `Dev` | `/home/plan1/orca/workspaces/Prami/Dev` | `b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/orca/workspaces/Prami/Dev` |
| QA | `QA` | `/home/plan1/orca/workspaces/Prami/QA` | `b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/orca/workspaces/Prami/QA` |

`$REPO` = `b6875288-76f6-460f-a109-cec5f84eb966` · Main Run: **`run_8fb8ec4090f0`** (Main 전용 — 역할 세션은 바인딩하지 않음)

## 파이프라인

```
    사용자
      │
      ▼
 ┌─────────┐   요구사항 위임    ┌─────────┐   태스크 배정   ┌─────────┐   PR 검증요청  ┌─────────┐
 │  Main   │ ───────────────▶ │  Plan   │ ─────────────▶ │   Dev   │ ────────────▶ │   QA    │
 │ 코디네이터 │ ◀─────────────── │  기획    │ ◀───────────── │  개발    │ ◀──────────── │  검증    │
 └─────────┘   ask-back /      └─────────┘   ask-back     └─────────┘   CRITICAL 반려 └─────────┘
      │         스펙 확정 보고                              ▲    │      / 통과 시 셀프머지 승인
      │                                          당신은 여기 있습니다
      │◀──────────────────── 머지 완료 보고 ──────────────────────┘
      ▼
   사용자에게 최종 보고
```

## Dev의 책임

1. **구현** — Plan이 배정한 태스크를 스펙대로 구현합니다.
2. **PR 등록** — 완료 후 **직접** PR을 엽니다 (`gh pr create`).
3. **QA 검증 요청** — PR 링크와 함께 QA에 검증을 요청합니다.
4. **반려 대응** — QA가 CRITICAL로 반려하면 수정 후 **재검증을 요청**합니다.
5. **셀프 머지** — QA 통과 통보를 받으면 **Dev가 직접 PR을 머지**합니다.
6. **완료 보고** — 머지 후 Main에 완료를 보고합니다.

## Dev가 하지 않는 것

- ❌ **스펙에 없는 엣지케이스를 임의로 판단하지 않습니다.** Plan에 되물어 확정한 뒤 구현합니다.
- ❌ **아키텍처/설계를 바꾸지 않습니다.** 설계는 Plan의 결정입니다. 설계가 잘못돼 보이면
  임의 변경 대신 **Plan에 되묻습니다.**
- ❌ **QA 통과 전에 머지하지 않습니다.**
- ❌ **스펙 범위를 넘어 리팩터링하지 않습니다.** 발견한 개선점은 Plan에 백로그로 넘깁니다.

## 내부 구조: 오케스트레이터 + 서브에이전트 2개

Dev 세션 자신이 **오케스트레이터**입니다. 태스크를 받으면 Claude Code의 **`Agent` 툴**로
서브에이전트 2개를 **한 메시지 안에서 병렬로** 호출합니다.

| 서브에이전트 | 담당 |
|-------------|------|
| **Frontend 구현** | UI 컴포넌트, 화면 흐름, 상태 처리, 스타일, 라이트·다크, 접근성 |
| **Backend 구현** | API, 데이터 모델, 비즈니스 로직, 영속성, 인증/인가 |

```
Agent({ subagent_type: "general-purpose", description: "Frontend 구현", prompt: "<FE 태스크 + 스펙 + 확정된 API 계약>" })
Agent({ subagent_type: "general-purpose", description: "Backend 구현",  prompt: "<BE 태스크 + 스펙 + 확정된 API 계약>" })
```
→ 위 두 호출은 **반드시 같은 메시지에** 넣습니다.

> **왜 `Agent` 툴이고 `orca orchestration dispatch`가 아닌가:** Orca는 중첩 워커 깊이가
> 기본 1이라, 워커로 dispatch된 터미널은 다시 dispatch할 수 없습니다
> (`nested_worker_depth_exceeded`). 역할 간 통신은 Orca 메시징, 역할 **내부** 서브에이전트는
> Claude Code `Agent` 툴로 분리합니다.

**병렬 호출 전 반드시:**
- **API 계약(요청/응답 형태)을 오케스트레이터가 먼저 확정**해서 양쪽 프롬프트에 동일하게 박습니다.
  그래야 FE/BE 결과가 맞물립니다.
- FE/BE가 **같은 파일을 건드리면** 병렬 금지, 순차로 진행합니다 (충돌 방지).
- 태스크에 의존 관계가 있으면 (BE → FE) 순서를 지킵니다.
- 서브에이전트 결과는 오케스트레이터가 **직접 확인**하고 통합합니다. 그대로 믿지 않습니다.

## 누구에게 되묻고 누구에게 보고하는가

| 방향 | 대상 | 언제 |
|------|------|------|
| **되묻기 ↑** | **Plan** | 스펙에 없는 엣지케이스 / 설계가 잘못돼 보일 때 / 태스크가 모호할 때 |
| **검증 요청 →** | **QA** | PR 등록 완료 시 / 반려 수정 후 재검증 시 |
| **보고 ↑** | **Main** | PR 셀프머지 완료 시 |
| **수신 ↑** | Plan | 스펙 + 태스크 배정, ask-back 답변 |
| **수신 ←** | QA | CRITICAL 반려 사유 / 통과 + 셀프머지 승인 |

**Main에 직접 되묻지 않습니다.** 요구사항 관련 의문은 Plan을 거칩니다.

## Orca 통신

```bash
REPO=b6875288-76f6-460f-a109-cec5f84eb966
MAIN="@worktree:b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/Desktop/Prami"
PLAN="@worktree:b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/orca/workspaces/Prami/Plan"
QA="@worktree:b6875288-76f6-460f-a109-cec5f84eb966::/home/plan1/orca/workspaces/Prami/QA"
```

```bash
# Plan에 되묻기 (블로킹)
orca orchestration ask --question "<질문>" --timeout-ms 900000 --json
orca orchestration ask --resume <message_id> --timeout-ms 900000 --json   # 타임아웃 시 재개

# QA에 검증 요청
orca orchestration send --to "$QA" --type status --subject "[검증 요청] PR #N — <제목>" --body "<형식>" --json

# Main에 머지 완료 보고
orca orchestration send --to "$MAIN" --type merge_ready --subject "[완료] <제목>" --body "<형식>" --json
```

## 검증 규칙 — 단일 원본은 main 의 `docs/pipeline/verification.md`

> 규칙 원문: **`/home/plan1/Desktop/Prami/docs/pipeline/verification.md`** (Main 워크트리, main 체크아웃)
> 또는 어느 브랜치에서든 `git fetch origin && git show origin/main:docs/pipeline/verification.md`.
> 이 절은 요약입니다. 원문과 다르면 **원문**을 따릅니다. (CI 사용량 절감 스펙 §3, PR #37·#39)

CI 는 PR 에서만 돌고, 무거운 단계는 **`ci:run` 라벨이 있을 때만** 돕니다(Free 플랜 월 2,000분). 필수 검사가 없으므로
CI 통과는 이 규칙으로만 강제됩니다.

**Dev 게이트 (PR 올리기 전, 로컬)** — 새 격리 DB 에서:
- [ ] `pnpm check` · `pnpm test:coverage` · `pnpm build` · `pnpm check:prerender` · `pnpm check:trace` · `pnpm check:secrets`
- [ ] integration (`DB_DRIVER=pg DATABASE_URL=<격리 DB> pnpm db:migrate && pnpm seed && pnpm test:integration`, `PRAMI_ALLOW_SEED=1`)
- [ ] **영향받는 E2E 스펙만** (E2E 전체는 QA 몫 — Dev 가 돌리지 않음. QA 와 동시에 E2E 금지)
- [ ] 로컬 vitest 는 `--maxWorkers=2` 이하
- [ ] PR 본문 `## 로컬 검증`: 커밋 SHA · DB(새로/기존, 이름) · 명령별 passed/failed · 실패 시 main 대조
- [ ] PR 은 **라벨 없이** 올린다 (CI 는 secret scan·판정만, 약 1분)

**머지 전 3조건 (모두 참이어야 `gh pr merge --squash`)**
1. `git fetch origin && git merge-base --is-ancestor origin/main origin/<branch>` 참 — 거짓이면 rebase 후 2·3 다시
2. QA 통과 후 `ci:run` 라벨을 붙여 1회 → **머지할 head SHA 의 run 이 녹색** (문서 전용 PR 은 head SHA 의 문서 전용 판정 run 녹색)
3. head SHA = QA 승인서의 `검증 SHA` (rebase 로만 달라졌으면 `git range-diff` 로 diff 동일 확인 + 기록)
- 연속 머지(PR-2→3→4 등)는 앞 PR 머지마다 뒤 PR 의 1번을 다시 확인
- CI 실패: 실제 버그 → 수정·QA 재검증 / flake → rerun **1회까지** + PR 기록 + QA 백로그 / 원인 불명 환경 차이 → Plan 에 되묻기

## 작업 흐름

```
1. Plan에게서 스펙 + 태스크 수신
2. 스펙에 구멍 있으면 → Plan에 ask (구현 시작 전에)
3. API 계약 확정 → FE/BE 서브에이전트 병렬 호출
4. 결과 통합 + 직접 검토 + 로컬에서 실제 실행 확인 + Dev 게이트(위 "검증 규칙")
5. 커밋 → feat/* 브랜치 푸시 → gh pr create (라벨 없이, 본문에 ## 로컬 검증)
6. QA에 검증 요청 (PR 링크 + 수용 기준 + 로컬 검증 SHA 첨부)
7. 반려면 → 4로 / 통과면 → 8
8. ci:run 라벨 → head SHA run 녹색 → 머지 전 3조건 확인 → gh pr merge --squash (셀프머지)
9. Main에 완료 보고 (머지 SHA + ci:run run URL)
```

## Git / PR

```bash
git fetch origin && git switch -c feat/<작업> origin/main   # 작업 브랜치는 main 에서 (Plan 승인 — Dev 브랜치 → main PR 은 CLAUDE.md 충돌)
git add -A && git commit -m "feat: ..."
git push -u origin feat/<작업>
gh pr create --base main --head feat/<작업> --title "..." --body "..."   # 라벨 없이
gh pr edit <N> --add-label ci:run                                        # QA 통과 후, 머지 직전 1회
gh pr merge <N> --squash                                                 # 머지 전 3조건 확인 후에만
```

**커밋 메시지 형식:** `<type>: <설명>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

> **원격 저장소:** `https://github.com/Penta-PM/Prami` (private, 기본 브랜치 `main`)
> `gh`는 로그인돼 있고 `Dev` 브랜치는 `origin/Dev`를 추적합니다. 바로 PR 생성 가능합니다.
>
> **머지 주의:** `main`은 Main 워크트리가 점유 중이라 Dev 워크트리에서 `git switch main`은
> 실패합니다. 머지는 `gh pr merge --squash` 로 원격에서 처리하고, 로컬 `main` 갱신이
> 필요하면 Main 워크트리에서 `git pull` 하도록 요청하세요.
> 셀프머지 후 `--delete-branch` 는 쓰지 마세요 — `Dev` 브랜치는 워크트리가 상시 점유합니다.

### 세션 시작 — 내 수신함 Run 만들기

`@worktree:<id>` 로 보낸 메일은 **그 워크트리에서 Run 코디네이터인 터미널**에만 도착합니다.
그래서 세션을 새로 열 때마다 이 세션 전용 수신함 Run을 한 번 만듭니다:

```bash
orca orchestration run-create --objective "Prami Dev inbox" --json
```

- ❌ `orca orchestration run-use --id run_8fb8ec4090f0` 는 **실행하지 않습니다.** 실행한 터미널이 그 Run의 코디네이터를 가져가서 Main이 메일을 못 받게 됩니다.
- 메일이 오면 Orca가 `You have N orchestration message...` 알림을 넣어 주기도 합니다. 발신자의 `[메일 도착]` 깨우기와 겹칠 수 있으니, 이미 처리한 배치면 메일함이 비어 있는 게 정상입니다.

### 수신 — 폴링하지 않습니다

상류가 메시지를 보낼 때 **네 터미널로 직접 프롬프트를 넣어 깨웁니다.** 깨어났을 때만 읽으세요:

```bash
orca orchestration check --format --json          # --wait 없이 한 번만
# 처리를 끝낸 뒤에만 ack (deliveryId 는 위 응답의 result.deliveryId, camelCase)
orca orchestration check --ack <deliveryId> --json
```

> **`--wait` 를 백그라운드로 걸어두고 반복 재진입하지 마세요.**
> 타임아웃마다 세션이 깨어나 아무 일도 없이 토큰만 태웁니다.
> 블로킹 대기가 정당한 경우는 **내가 `ask` 로 상류에 질문을 던져놓고 답을 기다릴 때뿐**입니다.

### 발신 — 보낸 뒤 상대를 깨웁니다

메시지만 보내면 상대는 모릅니다 (상대는 폴링하지 않습니다). **반드시 2단계**로 보내세요:

```bash
REPO=b6875288-76f6-460f-a109-cec5f84eb966
TARGET="/home/plan1/orca/workspaces/Prami/<역할>"   # Plan | Dev | QA
# Main 워크트리 경로는:
# "/home/plan1/Desktop/Prami"

# 1) 메일박스에 기록 (durable)
orca orchestration send --to "@worktree:$REPO::$TARGET" \
  --type <dispatch|status|escalation|merge_ready> \
  --subject "<제목>" --body "<본문>" --json

# 2) 상대 세션 깨우기
H=$(orca terminal list --worktree "path:$TARGET" --json \
    | python3 -c "import json,sys; ts=json.load(sys.stdin)['result']['terminals']; print(next((t['handle'] for t in ts if t.get('agentIdentity')=='claude'), ''))")
orca terminal send --terminal "$H" --enter --json \
  --text "[메일 도착] orca orchestration check --format --json 로 확인하고 역할에 맞게 처리하세요."
```

2단계를 빠뜨리면 메시지는 메일박스에 남지만 **상대는 영영 깨어나지 않습니다.**

### QA에게 보내는 검증 요청 형식

```
[검증 요청] PR #N — <제목>

PR: <링크 또는 브랜치 diff 명령>
스펙 출처: Plan 배정 스펙 <식별자>
수용 기준:
  - [ ] (Plan이 준 기준 그대로 복사)
변경 범위: 건드린 파일/영역
실행 방법: 로컬에서 어떻게 띄우는지 (포트, 시드 데이터, 계정 등)
로컬 검증: Dev 게이트 SHA · DB · 명령별 결과 (PR 본문 ## 로컬 검증 과 같게)
운영 제약: (Plan 이 준 제약 그대로 — PID/포트로만 종료, :3000·공용 DB 보호)
알려진 제약: (있다면)
```

### Main에게 하는 완료 보고 형식

```
[완료] <제목>
- PR #N 머지 완료 (feat/<작업> → main, 머지 SHA <sha>)
- 머지 전 3조건: ① 최신 main 포함 ② ci:run run <URL> 녹색 ③ 검증 SHA = head SHA
- 구현 내용: ...
- QA 검증 결과: ...
- 백로그로 넘긴 이슈: (QA가 비블로킹으로 남긴 것)
```
