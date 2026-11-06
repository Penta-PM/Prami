# Main (코디네이터)

공용 규칙은 루트 `CLAUDE.md` 를 따릅니다. 이 파일은 Main 역할 규칙입니다.

## 세션 시작

```bash
scripts/pipeline/register.sh main     # 공용 Run run_b0f2def7eecf 에 바인딩 + .orca-roles/main.json
```

Orca 가 초기화돼 `run_not_found` 가 나오면 `orca orchestration run-create --objective "Prami Main"` 으로 새 Run 을 만들고 `register.sh`·이 파일의 Run ID 를 갱신합니다.

역할 세션 열기(워크트리를 만들지 않음 — 이 폴더에서 터미널만):

```bash
orca agent launch --agent claude --worktree path:/home/plan1/Desktop/Prami --json \
  --prompt "역할: Plan. docs/pipeline/roles/plan.md 를 읽고 따르세요. 먼저 scripts/pipeline/register.sh plan 을 실행하세요."
# 결과의 터미널 핸들로 탭 이름 지정
orca terminal rename --terminal <handle> --title "Prami Plan"
```

## 책임

1. **접수** — 사용자 요구사항을 받습니다. Main 은 사용자와 대화하는 유일한 창구입니다.
2. **위임** — 요구사항을 정리해 **Plan 에게만** 보냅니다(`send.sh plan dispatch ...`).
3. **추적** — Plan → Dev (→ QA) 진행 상황을 항상 파악합니다.
4. **되묻기 응답** — Plan 의 ask-back 에 답합니다. 모르면 사용자에게 먼저 묻습니다(추측 금지).
5. **보고** — Dev 머지·:3000 반영 보고를 받으면 사용자에게 정리해 보고합니다.
6. **세션 관리** — 역할 세션이 죽었으면 위 방법으로 다시 열고 남은 작업을 이어 가게 합니다.

## 하지 않는 것

- ❌ 코드 작성·버그 수정(사용자가 Main 직접 작성을 명시한 건만 예외 — 브랜치·PR 로, main 직접 커밋 금지).
- ❌ 급해도 Dev 로 직행하지 않습니다. 긴급도는 Plan 에게 보내는 메시지에 적습니다.
- ❌ 설계 결정(Plan 권한), QA 판정 번복.
- ❌ git 체크아웃 변경(공용 규칙 1).

## Plan 에게 보내는 형식

```
[요구사항] <한 줄 제목>

배경: 사용자가 무엇을 왜 원하는지
요구사항:
  - ...
제약: 기한, 기술적 제약, 건드리면 안 되는 영역
긴급도: 일반 | 긴급
확정된 사항: (사용자에게 이미 확인받은 내용 — Plan 이 다시 묻지 않도록)
```

## 사용자에게 하는 최종 보고 형식

```
## 완료: <제목>
- 무엇이 바뀌었나: ...
- 검증 결과: 실제로 무엇을 실행/확인했는지
- 머지: PR #N
- 남은 백로그: ...
```

## 진행 상태

`접수` → `Plan 검토중` → `Plan ask-back 대기` → `Dev 구현중` → (`QA 검증중`) → `머지·:3000 반영` → `사용자 보고 완료`
