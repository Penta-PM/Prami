# QA 기록 — PR #35 Motion 도입 PR-2 오버레이

- 대상: `feat/motion-pr2-overlays` @ `eb24dce` (base `origin/main` @ `079a1fa`)
- 판정 (2차, 2026-10-02, 01aba95): **통과 / 셀프머지 승인** — 부모 닫힘 close() 161~164ms·opacity 0·9프레임, 단위 1749·E2E 66/66(애니메이션 끔·켬)
- 판정 (1차, 2026-10-02): **반려 / CRITICAL 1건**
- 스펙: `docs/specs/motion-interactions.md` §6 PR-2, §9.1, §9.2 (포커스 복원은 퇴장 시작 후 250ms 이내)

## CRITICAL
1. 부모가 `open=false` 로 닫는 항상 마운트된 `<Modal open={bool}>` 은 퇴장 애니메이션 없이 사라진다
   - 대상: UsersTable 비활성화 확인, LlmCredentialCard, ImportPanel ReplaceConfirmModal 등
   - 측정: 퇴장 시작부터 `close()` 까지 1~22ms, 그 시점 opacity 0.33~1. 같은 모달에서 Esc·× 는 160ms 정상
   - 추정 원인: `modal.tsx:159-162` 에서 한 번 거치는 `'initial'` 상태 → exit 애니메이션 시작 콜백 누락 → `:110-112` 안전장치가 즉시 닫음

## 통과 항목 요약
- 사용자가 닫는 경로·Presence 경로·제출 성공 모두 퇴장 160ms. 포커스 복원 168~199ms. 퇴장 중 클릭 무반응
- 드로어 x 100%→0, 퇴장 시작 시 inert·포커스 처리 정상. 챗 패널·FAB 교대, 재오픈 시 기존 버블 애니메이션 없음
- typecheck·lint(0)·단위 1746·E2E 66/66 (애니메이션 끔/켬 모두). 변이 실험으로 테스트가 실제로 잡는지 확인. 데이터 중복 제출 0

## 백로그 (비블로킹)
1. §9.1 "항상 마운트 4곳" 목록이 코드와 다름 (GroupsManager·PartsManager 는 조건부, ReplaceConfirmModal 이 빠짐)
2. `notifiedRef` 가드를 지워도 실패하는 테스트가 없음
3. 드로어 포커스 이동이 같은 프레임인지 검증하는 테스트 없음
4. reduced-motion 전역 CSS 규칙이 `::backdrop` 을 덮지 않음
5. 챗 패널 열기·닫기 후 포커스가 body 로 감 (PR 전과 동일)
6. PolicyFormModal key 가 mode 문자열 — 열린 상태에서 mode 가 바뀌면 진입·퇴장이 겹칠 수 있음 (이론상)
7. 드로어 axe 위반은 main 마크업 그대로
8. (2차) 부모가 닫을 때 백드롭 페이드가 close() 시점에 잘림 — `data-closing` 이 패널 exit 보다 한 렌더 늦게 붙음
9. (2차) 퇴장 취소 시 백드롭이 0.944 → 1 로 끊겨서 복귀
10. (2차) `exitStartedRef` 초기화(settle·showModal)를 지켜 보는 테스트가 없음 (방어 코드, 모달이 멈추는 경로는 찾지 못함)
