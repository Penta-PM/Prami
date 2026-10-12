# 공용 모달 — 내부에서 시작한 누름의 backdrop 오인 닫힘 수정

- 요구사항: Main msg_2d37985ba5eb (2026-10-12). 출처: #32 PR-2 중 Dev 발견 → Plan 백로그(msg_7f9d9c0b65bb) → 사용자 승인.
- 검토: UI/UX·기능/기술 서브에이전트(main 7592ca3 기준). 두 결과 일치.

## 1. 원인

`src/components/ui/modal.tsx:173-175` 의 `onClick` 이 `event.target === event.currentTarget` 이면 backdrop 클릭으로 보고
`beginClose('user')` 를 부른다. 브라우저는 click 을 pointerdown 대상과 pointerup 대상의 **공통 조상**으로 보내므로,
패널 안에서 눌러 backdrop 에서 놓으면(헤더 드래그·텍스트 선택·DataTable 리사이즈) click 대상이 `<dialog>` 자신이 되어 닫힌다.

- 영향: 공용 `Modal` 을 쓰는 모든 화면(약 20개 — NoticeForm·UserForm·GroupForm·PolicyForm·CostCreate/Edit·LlmCredentialCard·
  확인 모달·ShareModal·SavedQuotesModal 등).
- **해당 없음(범위 밖)**: Drawer(`drawer.tsx:130-158`, 오버레이와 패널이 형제라 공통 조상은 핸들러 없는 wrapper),
  ChatPanel(backdrop 없음), 모바일 Sidebar 오버레이(형제 `<button>`). 구조상 이미 안전하다.

## 2. 기술 결정 (Dev는 이 결정을 따른다)

1. 수정은 **공용 `modal.tsx` 한 곳**. `beginClose('user')` 로 모이는 닫기 경로·퇴장 상태 머신·cancel 가로채기(Motion PR-2)는 건드리지 않는다.
   바꾸는 것은 backdrop 판정 조건뿐이다.
2. 누름 기록은 `<dialog onPointerDownCapture>` 로 한다(캡처 단계 필수).
   - 근거: DataTable `startResize`(`DataTable.tsx:372-374`) 가 pointerdown 에서 `stopPropagation`+`preventDefault` 를 부른다.
     버블 단계 `onPointerDown` 은 도달하지 않고, 호환 mousedown 도 생기지 않는다.
   - window 전역 리스너는 쓰지 않는다(중첩·동시 모달 간섭).
3. 판정은 **제외 방식(deny-list)**: "pointerdown 이 dialog 의 자손에서 시작됐으면 그 click 은 backdrop 클릭이 아니다".
   - pointerdown 기록이 없는 click(합성 click, 보조기술, 기존 단위 테스트 `modal.test.tsx:56,87`)은 기존대로 backdrop 클릭으로 처리한다.
   - 플래그는 pointerdown 마다 덮어쓰고, click 처리 직후 비우고, `showModal()` 직전에 false 로 초기화한다.
   - **바깥에서 누르고 안에서 놓는 경우**는 §5 Q-M1 의 Main 답에 따른다. 답 전에는 이 결정(제외 방식)으로 구현을 시작해도 된다.
     Q-M1 이 A 로 확정되면 "pointerdown 대상이 dialog 자신이고 pointerup 대상도 dialog 자신일 때만 닫힘"으로 좁힌다
     (pointerup 도 `onPointerUpCapture` 로 기록).
4. 키보드: `detail===0` 분기는 두지 않는다(제외 방식이면 키보드 경로는 무변화).
5. 주석: top-layer 위에 portal 로 띄운 요소는 dialog 의 자손이 아니므로 기록이 빠진다는 점을 `modal.tsx` 문서 주석에 남긴다(현재 `createPortal` 0건).
6. **CartPanel 개별 조치 제거**: `useIgnoreBackdropClickFromInside`(`CartPanel.tsx:266-298`), 호출(315), 래퍼 div 의 ref(429)를
   **같은 PR 에서** 제거한다. 래퍼 div 는 레이아웃 영향이 없으면 함께 제거. #32 의 "리사이즈 후 닫히지 않음" 회귀는 E2E 로 유지한다.

## 3. 비범위

- Drawer·ChatPanel·Sidebar 동작 변경(회귀 확인만).
- 모달 시각 변경, 닫기 애니메이션 변경. 다크 테마(코드베이스에 없음).
- 스크롤바 드래그 좌표 판정 보강 — Dev 가 E2E/실측에서 dialog 스크롤바 클릭으로 닫히는 것을 확인하면 Plan 에 되물을 것.

## 4. 수용 기준

- [ ] 공용 Modal 의 텍스트 입력에서 글자를 드래그 선택하다 backdrop 위에서 놓으면 모달이 열린 채이고 입력값이 유지된다(E2E: `mouse.down` 패널 안 → `mouse.move` 대화상자 밖 → `mouse.up`).
- [ ] 모달 헤더를 누른 채 backdrop 으로 끌어 놓아도 닫히지 않고 `onClose` 0회(단위: `pointerDown(내용)` → `click(dialog)`).
- [ ] SavedQuotesModal(CartPanel)에서 DataTable 열 리사이즈 핸들을 backdrop 까지 끌어 놓아도 닫히지 않는다(#32 회귀, E2E).
- [ ] backdrop 을 누르고 backdrop 에서 놓으면 퇴장 애니메이션 뒤 닫히고 `onClose` 정확히 1회.
- [ ] 안에서 시작한 드래그로 닫힘이 막힌 직후의 진짜 backdrop 클릭은 정상적으로 닫힌다(플래그 초기화, 단위).
- [ ] Escape·× 버튼은 기존대로 퇴장 애니메이션 뒤 닫히고 `onClose` 1회. 기존 `modal.test.tsx`·Motion PR-2 테스트 무수정 통과.
- [ ] backdrop 우클릭·중클릭으로 닫히지 않는다(현행 유지).
- [ ] `useIgnoreBackdropClickFromInside` 가 코드에서 사라진다(grep 0건).
- [ ] Drawer 오버레이 클릭 닫힘·패널 안 드래그 비닫힘 동작 무변화.
- [ ] (Q-M1 = A 일 때만) backdrop 에서 누르고 패널 안에서 놓으면 닫히지 않는다. (Q-M1 = B 면 이 경우 닫힘 — 현행 유지)
- [ ] Dev 게이트 기록(`docs/pipeline/verification.md` §3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3)

## 5. Main 되묻기

- **Q-M1** 바깥(backdrop)에서 누르고 패널 안에서 놓는 경우. 현재는 닫힘.
  - A: 누름·놓음이 모두 backdrop 일 때만 닫힘(Radix 등 관행, 오닫힘 더 적음) — **Plan 의견**
  - B: 현행 유지(요구 문구 그대로, 변경 최소)

## 6. 태스크

1. [FE] `modal.tsx` — `pressedInsideRef`·`onPointerDownCapture`·onClick 조건·`showModal` 시 초기화·문서 주석.
2. [FE] `CartPanel.tsx` — 개별 훅 제거.
3. [TEST] `tests/unit/motion/modal.test.tsx` — 신규 3건(안→밖 비닫힘 / 밖→밖 닫힘 / 막힌 직후 진짜 클릭 닫힘).
4. [E2E] 공용 모달 드래그 시나리오 + CartPanel 리사이즈 회귀 + backdrop·Escape·× 닫힘.

의존: 2·3·4 → 1. PR 1개.
