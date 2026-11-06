# Prami — 역할 파이프라인 (단일 워크트리)

> **모든 역할(Main·Plan·Dev·QA)이 이 폴더 `/home/plan1/Desktop/Prami` 하나에서 각자 Claude 세션으로 일합니다.**
> 역할마다 워크트리를 만들지 않습니다(2026-11-06 사용자 지시: "세션만 열어서 작업").
>
> **내 역할 찾기:** 세션 첫 프롬프트에 `역할: Plan` 처럼 지정됩니다. 지정이 없으면 **Main** 입니다.
> 역할을 알았으면 `docs/pipeline/roles/<역할>.md` 를 **반드시 먼저 읽고** 그 파일만 따릅니다.
>
> | 역할 | 규칙 파일 |
> |------|-----------|
> | Main (코디네이터, 사용자 창구) | `docs/pipeline/roles/main.md` |
> | Plan (기획·설계·배정) | `docs/pipeline/roles/plan.md` |
> | Dev (구현·PR·머지·:3000 반영) | `docs/pipeline/roles/dev.md` |
> | QA (검증 — 현재 QA 생략 모드) | `docs/pipeline/roles/qa.md` |

원격 저장소: `https://github.com/Penta-PM/Prami` (private, 기본 브랜치 `main`)

## 파이프라인

```
 사용자 ─▶ Main ─▶ Plan ─▶ Dev ─(QA 모드일 때)▶ QA
            ▲  ask-back  │  ask-back │ 머지·:3000 반영 보고
            └────────────┴───────────┘
```

화살표에 없는 경로로는 일을 넘기지 않습니다. Main 은 Dev/QA 에 직접 작업을 지시하지 않습니다.

## 공용 규칙 — 한 폴더를 같이 쓰므로 꼭 지킵니다

1. **git 체크아웃·커밋·브랜치 전환은 Dev 만 합니다.** Main·Plan·QA 는 git 상태를 바꾸지 않습니다(`fetch`, `log`, `show`, `diff` 같은 읽기만).
   - 예외: 사용자가 Main 에게 직접 작성을 명시한 건. 그때도 Dev 가 작업 중이 아닐 때만, 끝나면 `main` 으로 되돌립니다.
2. **Dev 는 작업 브랜치를 이 폴더에서 엽니다** (`git switch -c feat/<작업> origin/main`). 머지 뒤 바로 `git switch main && git pull --ff-only` 로 돌아오고 로컬 작업 브랜치를 지웁니다.
   - 브랜치를 바꾸기 전에 작업 트리를 깨끗하게(커밋 또는 `git stash`) 만듭니다. 남의 미커밋 파일(Plan 스펙 초안 등)을 지우거나 되돌리지 않습니다.
3. **:3000 은 이 폴더의 현재 체크아웃을 핫리로드로 보여 줍니다**(`pnpm dev:lan`, Orca 터미널 "LAN :3000"). 그래서 Dev 가 작업 중이면 :3000 에 작업 중 상태가 보일 수 있고, 머지 후 `main` 으로 돌아오면 main 이 보입니다.
   - :3000 프로세스·그 터미널은 꺼지면 다시 띄우는 것 외에는 건드리지 않습니다. `pkill -f next` 같은 넓은 패턴 종료 금지 — 자기가 띄운 프로세스만 PID/포트로 끕니다.
4. **Plan 의 스펙은 `docs/specs/` 에 파일로 씁니다(커밋은 하지 않음).** Dev 가 그 작업의 PR 에 해당 스펙 파일을 함께 커밋합니다.
5. 공용 DB 컨테이너 `prami-postgres-1` 중지 금지. `.env.local` 수정 금지.
6. 포트: :3000 = LAN(사용자), Dev 검증용 3001, E2E 는 스크립트 기본 포트.

## 역할 간 통신 (Orca)

같은 폴더라 `@worktree:` 주소로는 역할을 구분할 수 없습니다. **세션마다 수신함 Run 을 등록하고, 그 Run 으로 보냅니다.**

```bash
# 세션 시작 시 한 번 — 내 수신함 등록(.orca-roles/<역할>.json 에 run·handle 기록, gitignore)
scripts/pipeline/register.sh <main|plan|dev|qa>

# 보내기 = 메일 기록 + 상대 깨우기 (본문은 파일로)
scripts/pipeline/send.sh <받는 역할> <dispatch|status|escalation|merge_ready> "<제목>" <본문 파일>

# 받기 — 깨워졌을 때만 한 번 읽고, 처리 후 ack (폴링·--wait 반복 금지)
orca orchestration check --format --json
orca orchestration check --ack <deliveryId> --json

# 되묻기에 답하기 (보낸 쪽 세션을 깨울 필요 없음)
orca orchestration reply --id <msg_id> --body "<답>" --json
```

- `send.sh` 가 "등록 안 된 역할"이라고 하면 그 세션이 아직 안 열렸거나 `register.sh` 를 안 돌린 것입니다 → Main 에 알립니다.
- Main 만 공용 Run `run_b0f2def7eecf` 에 바인딩합니다. 다른 역할은 `run-use` 를 하지 않습니다(코디네이터를 빼앗음).

## 공용 문서

- 검증·머지·:3000 반영 규칙 원문: `docs/pipeline/verification.md`
- 스펙: `docs/specs/`
- 보안: 매칭 파일(`assets/품목_원자재품번 매칭 파일.xlsx`)·jodari 원본·원가 금액·비밀값은 저장소·PR·보고에 넣지 않습니다.
