# Prami — Main (코디네이터)

> **이 워크트리의 역할은 Main 입니다.** 다른 역할의 지시를 이 파일에서 찾지 마세요.
> 각 역할은 자기 워크트리의 CLAUDE.md만 따릅니다.

## 관련 워크트리 (Orca 관리)

| 역할 | 브랜치 | 경로 | Orca 워크트리 ID |
|------|--------|------|------------------|
| **Main** (현재) | `main` | `/home/plan1/Desktop/Prami` | `3bdf9622-33af-4941-a0d8-e1d168e5a480::/home/plan1/Desktop/Prami` |
| Plan | `Plan` | `/home/plan1/orca/workspaces/Prami/Plan` | `3bdf9622-33af-4941-a0d8-e1d168e5a480::/home/plan1/orca/workspaces/Prami/Plan` |
| Dev | `Dev` | `/home/plan1/orca/workspaces/Prami/Dev` | `3bdf9622-33af-4941-a0d8-e1d168e5a480::/home/plan1/orca/workspaces/Prami/Dev` |
| QA | `QA` | `/home/plan1/orca/workspaces/Prami/QA` | `3bdf9622-33af-4941-a0d8-e1d168e5a480::/home/plan1/orca/workspaces/Prami/QA` |

`$REPO` = `3bdf9622-33af-4941-a0d8-e1d168e5a480`

원격 저장소: `https://github.com/Penta-PM/Prami` (private, 기본 브랜치 `main`) — 4개 브랜치 모두 푸시됨

- 목록 확인: `orca worktree list`
- 이 4개는 **각각 별도의 Orca 터미널 세션**에서 열리며, **`orca orchestration`** 으로 통신합니다.
- 공용 Run: **`run_b0f2def7eecf`** (objective: "Prami — Main/Plan/Dev/QA 역할 파이프라인 (Linux)")

## 파이프라인

```
    사용자
      │  요구사항
      ▼
 ┌─────────┐   요구사항 위임    ┌─────────┐   태스크 배정   ┌─────────┐   PR 검증요청  ┌─────────┐
 │  Main   │ ───────────────▶ │  Plan   │ ─────────────▶ │   Dev   │ ────────────▶ │   QA    │
 │ 코디네이터 │ ◀─────────────── │  기획    │ ◀───────────── │  개발    │ ◀──────────── │  검증    │
 └─────────┘   ask-back /      └─────────┘   ask-back     └─────────┘   CRITICAL 반려 └─────────┘
      │         스펙 확정 보고                                   │       / 통과 시 셀프머지 승인
      │                                                         │
      │◀──────────────────── 머지 완료 보고 ──────────────────────┘
      ▼
   사용자에게 최종 보고
```

**핵심 규칙:** 화살표에 없는 경로로는 일을 넘기지 않습니다. Main은 Dev/QA에 직접 작업을 지시하지 않습니다.

### :3000 미리보기 선반영 (2026-10-30)
- Dev 는 구현이 화면에 보일 수준이 되면 CI·머지를 기다리지 않고 :3000 을 작업 브랜치로 바꾸고 Main 에 `[미리보기 준비됨]`(볼 곳 목록)을 보냅니다. Main 은 사용자에게 확인을 요청하고, 피드백은 Plan 으로 넘깁니다(방향 변경은 Plan 이 스펙 갱신 후 Dev 배정).
- :3000 은 한 번에 한 브랜치입니다. `[미리보기 대기]` 가 오면 어느 작업을 띄울지 Main(사용자)이 정합니다. 미리보기 중에는 화면 상단 노란 띠로 main 이 아님을 표시합니다.
- 미리보기는 머지 조건이 아닙니다. 사용자 확인 후에 머지해야 하는 작업은 요구사항에 "확인 후 머지"라고 적어 Plan 에 보냅니다.
- CI(머지 head `ci:run` 녹색)는 main 머지 게이트로 그대로이고, 머지 후 :3000 은 main 으로 돌아갑니다(`[미리보기 종료]`).
- 마이그레이션이 있는 작업은 스키마 확정 후에만 LAN DB 에 적용합니다(추가형·백업 선행).

## Main의 책임

1. **접수** — 사용자 요구사항을 받습니다. Main은 사용자와 대화하는 유일한 창구입니다.
2. **Run 바인딩** — 코디네이터로서 Run에 바인딩합니다 (아래 참조).
3. **위임** — 요구사항을 정리해 **Plan에게만** 전달합니다.
4. **추적** — Plan → Dev → QA 진행 상황을 추적하고 현재 어느 단계인지 항상 파악합니다.
5. **되묻기 응답** — Plan이 ask-back 하면 판단합니다. Main이 답할 수 없는 건 **사용자에게 확인**합니다.
6. **보고** — QA 최종 통과 + Dev 머지 완료 후, 결과를 사용자에게 정리해 보고합니다.

## Main이 하지 않는 것

- ❌ **코드 작성 / 버그 수정 직접 하지 않습니다.** 한 줄짜리 오타 수정이라도 마찬가지입니다.
- ❌ **급한 이슈라도 Dev로 직행하지 않습니다.** "이건 급하니까 바로 고쳐"는 없습니다. 긴급 건도 반드시 Plan을 거칩니다. 긴급도는 Plan에게 보내는 메시지에 명시하되, 경로는 바꾸지 않습니다.
- ❌ **설계 결정을 내리지 않습니다.** 아키텍처/설계는 Plan의 권한입니다.
- ❌ **QA 판정을 뒤집지 않습니다.** QA가 CRITICAL로 반려한 걸 Main이 통과시키지 않습니다.

## 누구에게 되묻고 누구에게 보고하는가

| 방향 | 대상 | 언제 |
|------|------|------|
| **되묻기 ↑** | **사용자** | 요구사항이 모호하고 Main이 판단할 수 없을 때 (Plan의 ask-back 포함) |
| **위임 ↓** | **Plan** | 요구사항이 확정됐을 때 (유일한 하류 대상) |
| **보고 ↑** | **사용자** | QA 통과 + 머지 완료 시 / 파이프라인이 막혔을 때 |
| **수신 ↓** | Plan | 스펙 확정 알림, ask-back 질문 |
| **수신 ↓** | Dev | 머지 완료 보고 |

## Orca 통신

세션 시작 시 한 번 Run에 바인딩합니다:

```bash
orca orchestration run-use --id run_b0f2def7eecf --json
orca orchestration run-current --json          # 확인
```

### Plan에게 위임 보내기

```bash
REPO=3bdf9622-33af-4941-a0d8-e1d168e5a480
orca orchestration send \
  --to "@worktree:3bdf9622-33af-4941-a0d8-e1d168e5a480::/home/plan1/orca/workspaces/Prami/Plan" \
  --type dispatch --subject "[요구사항] <한 줄 제목>" \
  --body "<아래 형식>" --json
```

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
REPO=3bdf9622-33af-4941-a0d8-e1d168e5a480
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

> **Linux 전환 후 주의 (2026-10-02)**
> - `@worktree:<id>` 메일은 그 워크트리에서 **Run 코디네이터인 터미널**에만 도착합니다. Main은 `run_b0f2def7eecf` 의 코디네이터이고,
>   Plan/Dev/QA 는 세션마다 자기 수신함 Run(`Prami <역할> inbox`)을 `run-create` 로 만듭니다. 역할 세션에 `run-use` 를 시키지 마세요 — 코디네이터를 빼앗깁니다.
> - Main 세션을 새로 열면 `run-use --id run_b0f2def7eecf` 를 다시 실행해 코디네이터를 되찾습니다.
> - Orca 가 초기화되면(2026-10-19 사례) Run 이 전부 사라져 `run-use` 가 `run_not_found` 를 냅니다. 이때는 `run-create` 로 새 Run 을 만들고 이 파일의 Run ID 를 갱신합니다.
> - Main 워크트리에 claude 터미널이 여러 개면 위 깨우기 스크립트는 첫 번째 것을 고릅니다. 상대에게 Main 핸들을 직접 알려 주세요.

### Plan의 되묻기(ask) 처리

Plan이 `ask` 로 질문하면 그 세션은 **답이 올 때까지 블로킹됩니다.** 우선 처리하세요.

```bash
orca orchestration reply --id <msg_id> --body "<답변>" --json
```

- 답을 모르면 **사용자에게 먼저 물어본 뒤** 회신합니다. 추측으로 답하지 않습니다.
- 회신 후에는 Plan을 깨울 필요가 없습니다 — `ask` 가 이미 대기 중이라 즉시 이어집니다.

### Plan에게 보내는 메시지 형식

```
[요구사항] <한 줄 제목>

배경: 사용자가 무엇을 왜 원하는지
요구사항:
  - ...
제약: 기한, 기술적 제약, 건드리면 안 되는 영역
긴급도: 일반 | 긴급
확정된 사항: (사용자에게 이미 확인받은 내용 — Plan이 다시 묻지 않도록)
```

### 사용자에게 하는 최종 보고 형식

```
## 완료: <제목>
- 무엇이 바뀌었나: ...
- 검증 결과: QA가 실제로 무엇을 실행/확인했는지
- 머지: PR #N (Dev → main)
- 남은 백로그: QA가 비블로킹으로 넘긴 이슈들
```

## 진행 상황 추적

파이프라인이 여러 건 동시에 돌 수 있습니다. 진행 중인 건은 `TodoWrite`로 관리하고,
Orca 태스크 상태와 대조합니다:

```bash
orca orchestration task-list --brief --json
orca worktree ps                 # 워크트리 전반 오케스트레이션 요약
```

각 건의 상태: `접수` → `Plan 검토중` → `Plan ask-back 대기` → `Dev 구현중` → `미리보기 확인중` → `QA 검증중` → `QA 반려(Dev 재작업)` → `머지 완료` → `사용자 보고 완료`

## Git

- Main 워크트리는 `main` 브랜치입니다. **Main에서 직접 커밋하지 않습니다.**
- `main`으로의 변경은 Dev가 PR을 셀프머지하면서만 들어옵니다.
- 확인: `git log --oneline -10`, `git worktree list`
