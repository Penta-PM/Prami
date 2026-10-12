# QA 기록 — PR #42 CI 사용량 절감 PR-C (단위 테스트 가속 + 재시도 flake 제거)

- 대상: `ci/unit-accel` @ `4d35c7c` (base `origin/main` @ `bf31cde`)
- 판정 (2026-10-12): **조건부 통과 / 셀프머지 승인** — 검증 SHA: 4d35c7c
  - 조건 1: flaky 2건(xai-adapter·llm-diagnostics-r2)을 타임아웃 여유 확대로 고친 것이 "가짜 타이머나 명시적 대기" 기준을 충족하는지 Plan 확인 (아니면 CRITICAL)
  - 조건 2: 4d35c7c ci:run 녹색 + quality job 시간이 PR-A 이후 기준선(680/696/584s)보다 짧을 것

## 실측 요약
- PGlite 템플릿 복원 DB 와 예전 마이그레이션 DB 의 카탈로그 전 항목 동일(테이블 23·컬럼 285·인덱스 50·제약 241·함수 117 등). 격리·갱신·동시 실행 확인
- 단위 1791 통과(294s, main 347s), coverage lines 95.66 · 80% 기준 유지
- flaky 대상 4개 파일 20회 반복(10회 CPU 부하) 0 실패
- E2E 전체 1회 66/66

## 백로그 (비블로킹)
1. VITEST_MAX_WORKERS 값 검증 없음
2. SIGKILL 시 /tmp 에 템플릿 파일(약 42MB) 잔존
3. QA 브랜치 .gitignore 가 빌드 산출물을 덮지 않음
