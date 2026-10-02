# QA 기록 — PR #37 CI 사용량 절감 PR-A (ci.yml 라벨 게이트)

- 대상: `ci/usage-reduction` @ `8c79d71` (base `origin/main` @ `ae16940`)
- 판정 (2026-10-02): **통과 / 셀프머지 승인** — 검증 SHA: 911c72b (8c79d71 → 858eb23 → 911c72b 순으로 HEAD 변경, 매번 재확인 후 최종 SHA로 대체)
- 스펙: `docs/specs/ci-usage-reduction.md` §2 PR-A, §5 PR-A

## 검증 방법
- CI 를 새로 돌리지 않고, Dev 가 인용한 실측 run 6개를 gh API(jobs·timing)와 로그(`CI 판정:`)로 대조
- 로컬: workflows.test 80/80, lint 0, format·secrets 통과, actionlint 0, 보안 워크플로 3개 diff 0
- 판정 셸: ci.yml 의 gate run 블록을 그대로 추출해 머지 커밋 구조의 임시 저장소 11가지 경우에 실행

## 백로그 (비블로킹)
1. rename 탐지 때문에 코드 파일을 docs/qa 로 옮기는 PR 이 "문서 전용"으로 판정됨 → `--no-renames` 권장
2. ci:run 이 붙은 PR 에 다른 라벨을 붙이면 전체 실행(약 18분)이 한 번 더 돎 → heavy 조건에 이벤트 라벨 확인 추가 권장
3. 비 ASCII 파일명은 문서 전용으로 인정되지 않음 (quotePath, 보수적 방향)
4. README.md:103·:357 "CI `secret scan` 잡" 표현이 남아 있음
5. main push CI 가 없어져 머지 전 확인은 PR-B 규칙에 의존 — PR-B 조기 머지 권장

## 858eb23 재확인 (Plan §2-4 A안: docs/pipeline/** 생략 대상 추가)
- docs/pipeline 을 읽는 코드·테스트 0건. workflows.test 80/80(목록 고정 단언 포함), actionlint 0
- 판정 시뮬레이션 6가지 정상 (docs/pipelineX 같은 접두어 오인 없음)
- 858eb23 의 ci:run run 37000910910 은 확인 시점에 진행 중 — 머지 전 녹색 확인은 Dev 몫(규칙 3.3)

## 911c72b 재확인 (QA 백로그 1~4 반영)
- `--no-renames`, `core.quotePath=false`, 다른 라벨 이벤트는 "다른 라벨 추가: 경량", README 문구 수정
- workflows.test 81/81, actionlint 0. 시뮬레이션 11가지에서 백로그 1~3 해소 확인 (rename 우회 → 전체, 한글 docs/qa → 문서 전용, 다른 라벨 → 경량)
- 남은 백로그: PR-B 조기 머지(main push CI 없음), README 8행 깨진 링크(범위 밖)
