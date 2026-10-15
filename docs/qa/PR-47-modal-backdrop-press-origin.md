# QA 기록 — PR #47 공용 모달 백드롭 오인 닫힘 (Q-M1 = A)

- 판정: **통과 / 셀프머지 승인** (2026-10-15)
- 요청: Dev msg_0bbb222f8b1d (재부팅 재전송, 원 msg_2164e4046cad)
- 스펙: origin/Plan docs/specs/modal-backdrop-press-origin.md §2·§4
- 증거(로컬 scratchpad): fe47/shots/*.png·*-results.json, scripts/fe47.mjs, be47logs/{summary.txt,e2e.log,coverage2.log,int.log,e2emut.txt}

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #47 — 공용 모달 백드롭 오인 닫힘 (Q-M1 = A)

검증 SHA: 683c2c6 (683c2c675a2940c5bd3af38b9490eeb215dbea5f, base main 1c7205e)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA 여야 합니다. #48·#49 중 하나가 먼저 머지돼 rebase하면, rebase만 했다는 사실과 diff가 같은지를 기록해 주세요.

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, page.mouse·touchscreen·keyboard 실좌표):
  - 실행: next dev :3200, 새 DB qa47fe(migrate·seed·E2E 픽스처 임포트). main 1c7205e는 :3250에서 같은 절차로 띄워 대조했습니다.
  - 측정 방법: HTMLDialogElement.prototype.close를 감싸고 close 이벤트를 세었습니다. 백드롭 좌표 (8,8)은 DIALOG 자신입니다.
  - 1a 제목 입력 텍스트를 드래그 선택해 백드롭에서 놓음: 열린 채, 값 유지, 선택 [0,12], 닫힘 0회 (main은 닫힘)
  - 1b 헤더를 눌러 백드롭에서 놓음: 열린 채, 0회 (main 닫힘)
  - 2 백드롭→백드롭: close() 1회, close 이벤트 1회. 더블클릭해도 1회
    · 퇴장: 191–250ms(main 202–213ms), opacity 1→0 10–13프레임
  - 3 (Q-M1=A) 백드롭에서 누르고 패널에서 놓음: 열린 채, 0회 (main 닫힘)
  - 4 안쪽 드래그로 막힌 직후 진짜 백드롭 클릭: 1회 닫힘, 포커스가 '+ 공지 등록'으로 돌아감
  - 5 Escape 207–212ms(main 199–207), × 250–295ms(main 252–263): 각 1회
  - 6 백드롭 우클릭·중클릭: 0회
  - 7 SavedQuotesModal 리사이즈 핸들을 백드롭까지 끌기(좌·우): 열린 채, 너비 116→60 / →600
    · 그 뒤 백드롭 클릭은 1회 닫힘
    · 래퍼 div 제거 후 레이아웃 박스는 main과 동일. 패널 [290,331,860,238]로 같고, 픽셀 차이는 데이터 텍스트뿐
  - 9개 다른 모달(사용자 추가·그룹·가격정책·원가 등록/수정/삭제·공지 삭제·LLM 키 삭제 확인·견적 공유)
    · 안쪽 드래그·백드롭→안쪽: 열린 채 / 백드롭 클릭: 1회 닫힘
    · main은 안쪽 드래그에서 전부 닫힘
  - Drawer(/pricing 행 상세): 오버레이 클릭 닫힘, 안쪽 드래그 비닫힘. main과 동일
  - 터치(390×844): 백드롭 탭 1회 닫힘, 패널 탭 비닫힘
  - 대화상자 자체 스크롤바(8px, 1024×400·320×568): 드래그·클릭 모두 닫히지 않음. main과 동일, Chromium 기준
    · 스펙 §3에서 '알려 달라'고 한 케이스는 재현되지 않았습니다
  - 라이트: 코드베이스에 다크 테마가 없습니다(dark: 0건, prefers-color-scheme 에뮬에서도 배경 흰색). 스크린샷 fe47/shots
  - 접근성: Tab 순서·포커스 복귀 main과 동일. axe 0 violations(공지 모달, SavedQuotesModal)
  - 반응형 320/768/1024/1440: 가로 넘침 없음
  - reduced-motion: 1회 닫힘(186–237ms, opacity 페이드. main과 동일)
  - 콘솔: 에러·하이드레이션 경고 0
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2125 passed, lines 95.99 (modal.tsx 98.82)
  - build·prerender·trace·secrets PASS
  - integration 30 passed (qa47be_int)
  - E2E 전체 1회: SHA 683c2c6, 새 DB qa47be_e2e, 69 passed / 0 failed / 0 flaky, 4.6분
  - 정적:
    · useIgnoreBackdropClickFromInside grep 0
    · modal.test.tsx +145/-0. 기존·Motion PR-2 테스트 무수정
    · modal.tsx 삭제 1줄(옛 onClick 조건)뿐. beginClose/finishClose/handleCancel 무변경
  - 변이 실험 7건 중 5건 검출:
    · Q-M1=B화(releasedInside 제거)·pressedInside 제거·버블 onPointerDown·showModal 전 초기화 제거·fromInside=false
    · 단위와 E2E 모두 잡음(버블 onPointerDown은 #32 리사이즈 E2E가 잡음)
  - 신규 E2E 스펙을 main에 돌리면 실패합니다(빈 통과 아님)
  - 엣지:
    · 중첩 Modal 안쪽 드래그 비닫힘(main은 닫힘)
    · 키보드형 click(detail 0)은 스펙 §2.4대로 dialog 자신이면 닫힘

## 수용 기준 대조
- [x] 텍스트 드래그 선택 → 백드롭에서 놓아도 열린 채·값 유지 — FE 1a, E2E modal-backdrop 1
- [x] 헤더 드래그 → 백드롭에서 놓아도 비닫힘·onClose 0 — FE 1b, 단위
- [x] SavedQuotesModal 리사이즈 핸들을 백드롭까지 → 비닫힘 — FE 7, E2E
- [x] 백드롭→백드롭: 퇴장 뒤 onClose 정확히 1회 — FE 2
- [x] 막힌 직후 진짜 백드롭 클릭은 닫힘 — FE 4, 단위
- [x] Escape·× 1회, 기존 테스트 무수정 통과 — FE 5, diff +145/-0, 단위 2125 통과
- [x] 우클릭·중클릭 비닫힘 — FE 6, 단위
- [x] useIgnoreBackdropClickFromInside grep 0
- [x] Drawer 동작 무변화 — FE 10, drawer.tsx diff 0
- [x] (Q-M1=A) 백드롭→패널 비닫힘 — FE 3, 단위, E2E
- [x] Dev 게이트 기록 + QA E2E 전체 1회(69/69) — 머지 head SHA의 ci:run 녹색은 머지 전에 Dev가 확인해 주세요

## 백로그 (비블로킹, 이번 머지 안 막음)
1. onClick 직후 플래그 초기화를 고정하는 테스트가 없습니다(변이 d 생존).
   - 실제 포인터 시퀀스는 pointerdown/up에서 플래그를 덮어쓰기 때문에 동작은 맞습니다.
   - 제안: pointerDown(내용)→click(dialog)→click(dialog)에서 두 번째 click이 닫히는지 보는 단위 테스트.
2. 중첩 Modal: 안쪽이 닫히면 React가 네이티브 close 이벤트를 바깥 <dialog onClose>까지 전파해 바깥 onClose도 1회 불립니다(바깥 dialog는 열린 채).
   - main도 같은 기존 동작이고, 현재 제품에는 중첩 사용이 없습니다.
   - 나중에 중첩을 도입하면 문제가 됩니다.
3. 안쪽 누름 → pointercancel 뒤, 포인터 이벤트 없는 click이 dialog 자신에 오면 남은 플래그 때문에 그 1회는 무시되고 다음 클릭에서 닫힙니다. 미미합니다.
4. E2E 리사이즈 회귀 테스트가 '열린 채'만 단언하고 열 너비 변화는 단언하지 않습니다.
5. reduced-motion에서도 닫힘이 약 200ms opacity 페이드입니다. main과 같고 범위 밖입니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
#48은 Frontend 통과, Backend·E2E 진행 중입니다. #49는 Frontend 통과, #48 E2E 다음 순서입니다.
```
