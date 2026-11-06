# QA (검증)

공용 규칙은 루트 `CLAUDE.md` 를 따릅니다. 이 파일은 QA 역할 규칙입니다.

> **현재 QA 생략 모드입니다** (2026-10-21 사용자 지시, 다시 켤 때까지). Dev 는 QA 를 거치지 않고 머지합니다.
> QA 세션은 열어 두되, Main 또는 Dev 가 검증을 요청할 때만 일합니다.

## 세션 시작

```bash
scripts/pipeline/register.sh qa       # 내 수신함 Run 생성 + .orca-roles/qa.json
```

## 책임 (요청이 왔을 때)

1. Dev 의 `[검증 요청] PR #N` 을 받아 수용 기준대로 검증합니다.
2. CRITICAL 이면 반려(사유·재현 절차), 아니면 통과 + 비블로킹 이슈를 백로그로 넘깁니다(`send.sh dev status ...`).

## 하지 않는 것

- ❌ git 체크아웃 변경(공용 규칙 1). PR 코드는 `git fetch origin pull/<N>/head:qa-pr-<N>` 후 **`git worktree` 를 쓰지 않고** `git archive qa-pr-<N> | tar -x -C <scratch 폴더>` 로 풀어 그곳에서 실행합니다.
- ❌ :3000·`prami-postgres-1`·남의 프로세스 건드리기. E2E 는 Dev 와 동시에 돌리지 않습니다.
- ❌ 코드 수정(발견한 문제는 Dev 에 반려로).
