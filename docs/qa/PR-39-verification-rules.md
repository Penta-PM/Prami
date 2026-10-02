# QA 기록 — PR #39 공용 검증 규칙 docs/pipeline/verification.md (CI 사용량 절감 PR-B)

- 대상: `docs/verification-rules` @ `737a27b` (base `origin/main` @ `2bfe988` = #37)
- 판정 (2026-10-02): **통과 / 셀프머지 승인** — 검증 SHA: 737a27b
- 스펙: `docs/specs/ci-usage-reduction.md` §3, §5 PR-B

## 확인
- 스펙 §3.1~3.5 항목이 문서 §1~5 에 빠짐없이 들어감. §3 에 문서 전용 PR 의 머지 조건 ② 해석(Plan 결정)이 명시됨. §6 운영 제약 포함
- CI run 37003140056: head 737a27b, 성공, 로그 "CI 판정: 문서 전용: secret scan만", e2e skipped
- prettier·check:secrets 통과
- Dev 브랜치 CLAUDE.md(origin/Dev 603f1d1) "검증 규칙" 절: 절대경로 참조 + 체크리스트 + 머지 전 3조건
- QA 브랜치 CLAUDE.md: 참조·체크리스트·승인서 SHA 2줄 추가 (이 기록 직전 커밋)
- E2E 전체 1회는 생략: 변경 파일이 문서 1개이고 실행 코드에 영향이 없음

## 백로그 (비블로킹)
1. 문서 §0 의 판정 값 목록에 PR #37 에서 추가된 "다른 라벨 추가: 경량" 이 없음
2. 원문 절대경로(`/home/plan1/Desktop/Prami/docs/pipeline/verification.md`)는 머지 후 Main 워크트리가 main 을 받아야 생김 (확인 시점 Main 워크트리는 ae16940)
3. 문서 전용 PR 에 "QA E2E 전체 1회" 를 적용하는지 문서에 명시되지 않음 — Plan 이 문구로 정해 두길 권장
