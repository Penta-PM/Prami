# QA 기록 — PR #41 #30 챗봇 플로팅 버튼 제거

- 대상: `feat/issue-30-fab-removal` @ `a7b12e8` (base `origin/main` @ `d40d59d`)
- 판정 (2026-10-06): **통과 / 셀프머지 승인** — 검증 SHA: a7b12e8
- 스펙: `docs/specs/issue-30-chat-fab-removal.md` (reduced-motion 기준은 Plan 결정 A로 정정: 이동 없이 열고 닫으면 충족, opacity fade 허용)

## 실측 요약
- FAB 0개(12개 경로), 우하단 고정 요소 0
- 헤더 버튼 1280·375 동작, 메시지 유지, aria-pressed 전환
- Escape 닫기, 모달 우선(1회 모달 → 2회 패널), ×·Escape 후 포커스가 헤더 버튼
- '다음' 링크 실제 클릭으로 2페이지 이동 — main 에서는 같은 위치를 FAB 가 덮음
- reduced-motion: x 이동 한 프레임, opacity fade 160~240ms
- 쉬고 있을 때 main 대비 차이는 FAB 영역뿐
- typecheck·lint 0, format 통과, 단위 1772, 변이 7/8 검출, E2E 전체 1회 66/66

## 백로그 (비블로킹)
1. Escape 핸들러의 `defaultPrevented` 확인을 지켜 보는 테스트 없음
2. IME 조합 중 Escape 가드 없음
3. 모바일 사이드바 + 챗 패널이 함께 열려 있으면 Escape 1회에 둘 다 닫힘
4. 패널이 덮는 요소(+ 등록, 375 에서 헤더 버튼)는 패널이 열린 동안 마우스로 못 누름 — 패널 위치 유지의 결과
5. 키보드로 연 뒤 Tab 이 패널 안으로 들어가지 않음
6. 같은 워크트리에서 dev 서버가 돌면 format:check 가 tsconfig.json 때문에 실패할 수 있음
