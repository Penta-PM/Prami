# Act AI Prami — Dev (개발)

> **이 워크트리의 역할은 Dev 입니다.** 다른 역할의 지시를 이 파일에서 찾지 마세요.
> 각 역할은 자기 워크트리의 CLAUDE.md만 따릅니다.

## 관련 워크트리 (Orca 관리)

| 역할 | 브랜치 | 경로 | Orca 워크트리 ID |
|------|--------|------|------------------|
| Main | `main` | `C:\Users\USER\OneDrive - Pentasecurity inc\바탕 화면\Act AI Prami` | `a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/OneDrive - Pentasecurity inc/바탕 화면/Act AI Prami` |
| Plan | `Plan` | `C:\Users\USER\orca\workspaces\Act AI Prami\Plan` | `a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/orca/workspaces/Act AI Prami/Plan` |
| **Dev** (현재) | `Dev` | `C:\Users\USER\orca\workspaces\Act AI Prami\Dev` | `a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/orca/workspaces/Act AI Prami/Dev` |
| QA | `QA` | `C:\Users\USER\orca\workspaces\Act AI Prami\QA` | `a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/orca/workspaces/Act AI Prami/QA` |

`$REPO` = `a717899a-bc90-4a01-ae64-d258e2174771` · 공용 Run: **`run_8fb8a89f0626`**

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
REPO=a717899a-bc90-4a01-ae64-d258e2174771
MAIN="@worktree:a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/OneDrive - Pentasecurity inc/바탕 화면/Act AI Prami"
PLAN="@worktree:a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/orca/workspaces/Act AI Prami/Plan"
QA="@worktree:a717899a-bc90-4a01-ae64-d258e2174771::C:/Users/USER/orca/workspaces/Act AI Prami/QA"
```

```bash
# 수신 대기 (폴링/sleep 금지)
orca orchestration check --wait --types dispatch,question,status --timeout-ms 900000 --format --json
orca orchestration check --ack <delivery_id> --json          # 전부 처리한 뒤에만

# Plan에 되묻기 (블로킹)
orca orchestration ask --question "<질문>" --timeout-ms 900000 --json
orca orchestration ask --resume <message_id> --timeout-ms 900000 --json   # 타임아웃 시 재개

# QA에 검증 요청
orca orchestration send --to "$QA" --type status --subject "[검증 요청] PR #N — <제목>" --body "<형식>" --json

# Main에 머지 완료 보고
orca orchestration send --to "$MAIN" --type merge_ready --subject "[완료] <제목>" --body "<형식>" --json
```

## 작업 흐름

```
1. Plan에게서 스펙 + 태스크 수신
2. 스펙에 구멍 있으면 → Plan에 ask (구현 시작 전에)
3. API 계약 확정 → FE/BE 서브에이전트 병렬 호출
4. 결과 통합 + 직접 검토 + 로컬에서 실제 실행 확인
5. 커밋 → 푸시 → gh pr create
6. QA에 검증 요청 (PR 링크 + 수용 기준 첨부)
7. 반려면 → 4로 / 통과면 → 8
8. gh pr merge (셀프머지)
9. Main에 완료 보고
```

## Git / PR

```bash
git add -A && git commit -m "feat: ..."
git push -u origin Dev
gh pr create --base main --head Dev --title "..." --body "..."
gh pr merge --squash            # QA 승인 후에만
```

**커밋 메시지 형식:** `<type>: <설명>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

> **⚠️ 현재 미설정:** 이 저장소에는 **원격 저장소가 없고 `gh` 로그인도 안 돼 있습니다.**
> 첫 PR 전에 한 번 필요합니다:
> ```bash
> gh auth login
> gh repo create <이름> --private --source=. --remote=origin --push
> ```
> 원격이 붙기 전까지는 PR 대신 **로컬 브랜치 diff**로 대체하고, QA에는 PR 링크 대신
> `git log main..Dev --oneline` + `git diff main...Dev` 를 전달합니다.
> 이 경우 머지는 `git push . Dev:main` 으로 합니다 (`main`은 Main 워크트리가 점유 중이라
> `git switch main`은 실패합니다).

### QA에게 보내는 검증 요청 형식

```
[검증 요청] PR #N — <제목>

PR: <링크 또는 브랜치 diff 명령>
스펙 출처: Plan 배정 스펙 <식별자>
수용 기준:
  - [ ] (Plan이 준 기준 그대로 복사)
변경 범위: 건드린 파일/영역
실행 방법: 로컬에서 어떻게 띄우는지 (포트, 시드 데이터, 계정 등)
알려진 제약: (있다면)
```

### Main에게 하는 완료 보고 형식

```
[완료] <제목>
- PR #N 머지 완료 (Dev → main)
- 구현 내용: ...
- QA 검증 결과: ...
- 백로그로 넘긴 이슈: (QA가 비블로킹으로 남긴 것)
```
