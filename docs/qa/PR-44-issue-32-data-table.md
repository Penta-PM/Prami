# QA 기록 — PR #44 #32 PR-1 공용 data-table + UsersTable 파일럿

- 대상: `feat/issue-32-data-table` @ `17d19b4` (base `origin/main` @ `3e07fdc`)
- 판정 (1차, 2026-10-12): **반려 / CRITICAL 1건**
- 스펙: `docs/specs/issue-32-table-sort-resize-reorder.md` §2·§4·§5·§7·§9

## CRITICAL
1. /admin/users 기본 상태 axe `aria-required-attr`(critical) 7건 신규 — 포커스 가능한 `role="separator"` 핸들에 `aria-valuenow` 없음 (`DataTable.tsx:536`, 기본 auto 레이아웃에서 width undefined). main 0건

## 통과 항목 요약
- 정렬(§2 규칙 독립 대조 일치), 재배치(16행×7셀 일치, 고정 열, 3/6px 임계), 리사이즈(0px 차이, 60/600 정지), 키보드·라이브 영역, 열 초기화, Esc 처리, 저장·손상값·메모리 폴백·사용자 분리, 하이드레이션 0, 다른 표 회귀 없음
- typecheck·lint 0, 단위 2005, 변이 7/10 검출, E2E 전체 1회 66/66

## 백로그 (비블로킹)
1. 저장 레이아웃 복원 전 약 0.75초 기본 레이아웃이 보임
2. 열 초기화 알림 문구가 §9 Q4 예시와 다름
3. 드래그 임계값 경계·컴포넌트 clamp 테스트 없음
4. number 정렬에 서식 문자열을 넘기면 NaN 으로 순서가 깨짐 (PR-2·3 전 처리 권장)
5. 앞 공백 이름 정렬이 화면상 어색함
6. 관리 열에도 리사이즈 핸들 존재 (스펙상 허용)
