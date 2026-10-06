# 스펙: #30 우측 하단 챗봇 플로팅 버튼(FAB) 제거

- 요구사항: Main `msg_9e266d9f36a6` · 되묻기 답변: `msg_1aac0ca2c3c0` (A, 사용자 확인 완료) · 2026-10-06
- 상태: 확정 → Dev 배정. **Motion PR-4보다 먼저 머지한다.**

## 동작 정의
- FAB(`ChatDock.tsx:21-41`, `aria-label="챗봇 열기"`)를 삭제한다. 챗봇은 헤더의 `챗봇` 버튼(`ChatLauncher`)으로만 연다.
  - 헤더 버튼은 FAB와 같은 `toggle()`을 쓰고 모바일에서도 보인다.
- 패널 위치는 그대로 둔다(`fixed top-0 right-0`, 폭 400px, 모바일 100vw).
- **Escape 키로 패널을 닫는다** (Main 결정 A). 패널 안에 포커스가 있을 때, 또는 패널이 열려 있을 때 document 레벨에서 처리한다. 모달이 열려 있으면 모달의 Escape가 우선한다.
- **× 또는 Escape로 닫으면 포커스를 헤더 `챗봇` 버튼으로 되돌린다.** 지금은 body로 빠진다.
- 헤더 버튼의 `aria-pressed`와 접근성 이름 `챗봇`은 유지한다. E2E가 exact로 매칭한다.

## 기술 결정
- `ChatDock`은 이름과 export를 유지하고 `<ChatPanel />`만 렌더한다. 이 파일에서만 쓰던 import(`m`, `Presence`, `PRESS_CLASSES`, `cn`, `scaleIn`, `VARIANT_KEYS` 중 미사용분)는 정리한다.
  - `scaleIn` 토큰 자체는 다른 곳에서 쓰므로 지우지 않는다.
- `ChatContext`, `ChatPanel` 레이아웃, `(app)/layout.tsx` 구조는 바꾸지 않는다. Motion PR-4가 `ChatPanel.tsx`를 수정하므로 Escape와 포커스 복원은 최소 변경으로 넣는다.
  - 포커스 복원 대상은 헤더 버튼 ref를 context로 공유하는 방식이든 `document.querySelector`든 Dev가 고른다. 어느 쪽이든 단위 테스트로 고정한다.
- 주석 `ChatContext.tsx:5`, `ChatDock.tsx:14`와 `README.md:298`의 FAB 언급을 정정한다.
- Motion 스펙(`motion-interactions.md`)의 FAB 관련 기준은 Plan이 정정한다(§9.5).

## 비범위
- 패널 위치·크기 변경.
- 챗봇 키보드 단축키 신설.
- 헤더 버튼 디자인 변경.

## 수용 기준
- [ ] 앱 전 화면(대시보드·가격·원가·감사·계산기·관리자·404)에서 `button[name="챗봇 열기"]`가 0개이고, 우하단에 고정된 요소가 없다.
- [ ] 헤더 `챗봇` 버튼이 1280px과 375px 폭 모두에서 패널을 연다. 다시 열면 기존 메시지가 유지되고, `aria-pressed`가 true/false로 바뀐다.
- [ ] Escape로 패널이 닫힌다. 모달이 열린 상태에서 Escape를 누르면 모달만 닫힌다.
- [ ] × 또는 Escape로 닫은 뒤 `document.activeElement`가 헤더 `챗봇` 버튼이다.
- [ ] 가려짐 해소: 가격·원가·감사 목록을 맨 아래로 스크롤한 뒤 오른쪽 끝 '다음' 링크, 가져오기 패널의 우하단 액션 버튼, 계산기 `CartPanel` 하단 버튼을 실제로 클릭할 수 있다(1280×720 기준, trial 없이).
- [ ] 단위 테스트 3개(`panel.test.tsx:57`, `panel-llm.test.tsx:57`, `panel-stream.test.tsx:53`)가 헤더 버튼으로 진입하도록 바뀌었다. `panel.test.tsx`에 'FAB 부재' 회귀 단언, Escape 닫기, 포커스 복원 테스트가 추가됐다.
- [ ] reduced-motion에서 패널이 즉시 열리고 닫힌다.
- [ ] Dev 게이트 기록(`docs/pipeline/verification.md` §3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3).
- [ ] PR 본문에 `Closes #30`.

## 태스크
1. [FE] FAB 제거, ChatDock 축소, Escape 닫기, 포커스 복원, 주석·README 정정, 단위 테스트.
