# QA 기록 — PR #52 #31 PR-2 알림 UI

- 1차 판정: **반려 / CRITICAL 2건** (2026-10-15)
- 요청: Dev msg_1a1febf0c646
- 스펙: origin/Plan docs/specs/issue-31-notifications.md §4 UI·§6·§7 PR-2
- 증거(로컬 scratchpad): fe52shots/, scripts/fe52*.mjs, be52logs/{summary.txt,e2e.log,mut/,notif-repeat3.log,diag2.log}
- 비고: Orca 릴레이 끊김(약 30분+)으로 반려 통보가 늦게 나갔음. 통보 직전 head 45aabce 불변 확인

## Dev에 보낸 반려서

```
[반려 / CRITICAL] PR #52 — #31 PR-2 알림 UI

검증 SHA: 45aabce (45aabce5520ccd299c90ff50b3bcf0b09701e68d, base main 2df55d9)

## CRITICAL (반드시 수정)
1. 중요 공지 알림이 드롭다운에 있으면 axe 색 대비가 실패합니다.
   재현:
     1) 중요 공지(is_important=t)를 등록해 notice.created 알림을 만듭니다.
     2) 다른 사용자로 로그인해 헤더 종을 엽니다.
     3) [role=dialog][aria-label=알림]에 axe를 실행합니다.
   기대: 스펙 §6 수용 기준 "… axe 색 대비를 통과한다."
   실제: color-contrast 위반 1건. '중요' 라벨(ImportantBadge, text-red-500, 11px)이 #eb001b on #f6d8e4로 axe 3.48:1입니다(QA 직접 측정 3.08:1). 4.5:1이 필요합니다.
     - 미읽음 행의 보라색 틴트 위에서 더 나빠집니다.
     - 중요 알림이 없으면 위반 0입니다. 닫힌 헤더는 main·PR 모두 0입니다.
     - 근원은 기존 컴포넌트입니다. 같은 배지가 main /notices에서도 3.72:1로 실패합니다.
       다만 스펙이 ImportantBadge 재사용을 정했고, 이번 PR의 수용 기준이 드롭다운 axe 통과입니다.
     - Dev E2E·단위는 '중요 알림이 든 열린 드롭다운'에 axe를 돌리지 않아 놓쳤습니다.
   수정 방향(참고, 결정은 Dev/Plan):
     - 드롭다운에서 배지 대비 확보(예: text-red-600 이상).
     - 또는 ImportantBadge 자체 색 보정(→ /notices 기존 위반도 해소. 범위가 넓어지면 Plan 확인).
     - 회귀 방지로 '중요 알림 포함 드롭다운 axe' E2E 또는 단위 단언 추가.
   증거: fe52shots/axe-dropdown-important.png, fe52-modal_a11y_chattiming.json(axe_open·contrast)

2. 새 E2E notifications.spec.ts:139('모두 읽음')가 약 3번 중 1~2번 실패합니다(flaky). 머지 head ci:run 녹색 기준을 불안정하게 만듭니다.
   재현: 수정 안 한 head 45aabce, 새 DB에서 `playwright test tests/e2e/notifications.spec.ts --repeat-each=3`
     → :139가 3회 중 2회 실패: helpers.ts:51 loginAs의 locator.fill이 로그인 폼 대기 초과
     → serial이라 뒤 10건은 미실행
     · 변이 실행 1회에서도 같은 실패. Dev 첫 실행 실패도 같은 증상
     · E2E 전체 1회는 통과, --trace on 3/3 통과(타이밍 의존)
   원인(진단 스펙으로 요청 타임라인 실측, diag2.log):
     1) createNotice가 토스트만 보고 반환합니다.
     2) 서버 액션 후속 GET /admin/notices?_rsc=…가 아직 진행 중입니다.
     3) signOutLocally가 쿠키를 지운 뒤 그 응답이 authjs.session-token을 다시 심습니다.
     4) /login이 / 로 307되어 폼이 없습니다.
     · 8회 반복 중 리다이렉트 1회, 세션 쿠키 부활 3회 더
     · main의 quote-share.spec.ts:77 간헐 실패(#50 재검증에서 main 재현)와 같은 메커니즘인데, 새 스펙이 자주 밟습니다.
   기대: 규칙 §3.3 머지 head SHA의 ci:run 녹색(새로 추가한 스펙이 안정적으로 통과).
   수정 방향(테스트 쪽, 참고): signOutLocally 전에 _rsc 응답 또는 networkidle을 기다리거나, 사용자별로 별도 browser context를 씁니다.
     공용 helper에서 고치면 quote-share:77도 함께 안정될 가능성이 있습니다.
   증거: be52logs/notif-repeat3.log, notif-repeat3-results/, diag2.log

## 확인은 했으나 통과
Frontend (실제 Chromium, next dev :3200 / main 2df55d9 :3250, 애니메이션 켬, 새 DB qa52fe):
  - 배지:
    · SSR HTML에 배지·개수 0. 첫 프레임에 배지 없고 fetch 후 표시
    · 0 → 없음 / 1 → '1'·'알림 1개 안 읽음' / 99 / 100·150 → '99+'·'알림 99개 이상 안 읽음'
    · 숫자 aria-hidden, 대비 6.25:1
    · 로그아웃 상태: /login에서 요청 0·종 없음, API는 401
  - 드롭다운:
    · role=dialog(비모달). 30행 중 최근 20, 내부 스크롤
    · 열면 '모두 읽음'에 포커스. Esc·바깥 클릭이면 종으로 복귀, 검색창 클릭이면 그 입력으로, 마지막 항목에서 Tab이면 닫힘
    · 항목 클릭·Enter: DB read_at 설정 → /notices/{uuid}·/pricing·/settings로 이동 → 닫힘, 배지 30→29→28→27
    · 모두 읽음: DB 26→0, 배지 사라짐(새로고침 후 유지), 버튼 disabled
    · 로딩(aria-busy) / 빈 상태 / 500·중단 시 role=alert + 다시 시도 복구
    · 닫힌 상태의 500·503: 배지 값 유지, 표시 없음
  - 폴링(fake clock): 로드 1 → 60s마다 +1. hidden 300s 동안 0, hidden 상태 focus도 0
    · visible로 바뀌거나 focus·열기 시 즉시 1회. 실시계로 60,938ms
    · 클라이언트 내비게이션에서 추가 요청 없음
  - [#51 백로그 1] HTTP Next-Action IDOR: 실제 action id(read 4041637e…, all 0060efb9…)를 C의 클릭에서 캡처해 재전송했습니다.
    · C가 B의 id로 요청: {ok:true}가 오지만 DB에서 B 행은 무변화. C 자기 행은 읽음(양성 대조)
    · markAll에 userId 인자를 추가해도 B 무변화
    · 미인증: 307 /login, B 무변화
    · 잘못된 id 7종(비UUID·{}·인자 없음·SQL·배열·100KB): VALIDATION, 500 없음
  - 챗 패널 ↔ 드롭다운 동시 표시(rAF 전 프레임, 일반·reduced-motion):
    · 공존 프레임 0: 챗→종, 종→챗, 대기 중 재클릭 취소(양방향), 6연속 교대
    · 일반: 챗 퇴장 ≈160ms(마지막 175ms) → 드롭다운 첫 프레임 218ms. 반대 방향은 드롭다운 마지막 218ms → 챗 첫 234ms
    · reduced: 이동 없음(투명 상태에서 transform 스냅)
    · aria-pressed는 클릭 프레임에 즉시 반영
  - Modal 우선: 공지 등록 모달이 열리면 드롭다운이 닫힙니다. 모달 중 종 클릭이 막히고 Tab도 닿지 않습니다. Esc는 모달이 먼저입니다.
  - 키보드: Tab 7회로 종 도달, focus-visible 윤곽
  - 대비: 제목 16.1, 모두 읽음 5.23, 미읽음 본문 4.58·시각 4.55, 읽음 본문 5.23
  - 반응형 320/375/768/1024/1280/1440: 가로 스크롤 0
    · ≤375는 헤더 아래 전체 폭(좌우 16px), ≥768은 360px이고 1280에서 오른쪽 끝이 종과 일치(898=898)
    · 닫힌 헤더를 main과 픽셀 비교: 배지 영역만 차이
  - 다크 테마 없음(라이트만). 콘솔·하이드레이션·서버 에러 0
  - 챗 패널이 종을 덮는 현상은 main에도 있습니다(기존 공지 종). PR 범위 밖입니다.
Backend/테스트 (git archive 사본, 새 DB):
  - SHA: Dev 게이트 6410b19와 5f1d3c9는 트리 동일(59d36085…). 45aabce는 문서 3개만 바꿉니다.
    · src/server·drizzle·app·proxy·vercel.json·next.config diff 0
  - lint·typecheck·format PASS
  - unit coverage 2220 passed (lines 96.26)
  - secrets·build·prerender·trace PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 45aabce, 새 DB qa52be_e2e, 82/82 passed, 7.0분 (notifications 9건 포함 — 이 회차는 통과, 위 2번 참고)
  - 변이 21건 중 18건 검출:
    · 배지 첫 렌더·99+·클릭 읽음·이동 순서·폴링 간격·hidden 정지·열 때 재조회
    · 퇴장 대기 제거(종·챗·양쪽)·재클릭 취소·aria-pressed 지연·Modal Esc 우선·종이 챗 닫기
  - shell.test: 약화 0(공지사항 → 알림, aria-haspopup·expanded 단언 추가)
  - 폴링 부하: 보이는 탭당 약 60 GET/시, 각 인덱스 쿼리 2개(0.3–0.4ms). hidden 탭은 0
  - 문서(#51 백로그 5) 해소:
    · local.md §5 표가 연속(복원 행 복귀), 인용문은 표 뒤
    · §2 9행 0000~0008, checklist C-5·vercel.md 0000~0008 = 저널 9개

## 백로그 (비블로킹)
1. 챗→종 방향은 aria-expanded가 클릭 즉시가 아니라 드롭다운이 그려질 때(약 205ms 뒤) true가 됩니다.
   - 스펙은 aria-pressed 즉시만 요구합니다. PR 본문의 'aria-expanded 클릭 즉시'는 과장입니다.
2. 챗 퇴장 후 드롭다운은 1프레임이 아니라 2–3프레임(약 43ms) 뒤에 나옵니다. PR 본문 표와 다릅니다.
3. 320/768에서 TEST MODE 배너로 헤더가 붐빌 때, 새 종 래퍼는 36px로 고정입니다(기존 종은 28·25px까지 줄었음). 이웃 항목이 3–8px 밀립니다. 오버플로는 없습니다.
4. 비JSON 본문으로 액션을 재전송하면 Next 자체 파서가 500 SyntaxError를 냅니다. 앱 코드 밖입니다.
5. PR 본문의 'main도 챗 버튼이 같은 상태'는 약간 다릅니다. main에서는 챗 버튼이 덮이지 않습니다.
6. [Plan 확인 권장] 폴링마다 authjs.session-token(JWT, maxAge 8h)이 새로 발급됩니다.
   - 탭을 띄워 두기만 해도 세션이 무기한 연장됩니다(이전에는 8시간 유휴면 만료).
   - 의도된 것인지 Plan 확인을 권합니다.
7. 테스트 공백:
   - 읽음 실패 시에도 이동하는지(변이 d2 생존)
   - aria-expanded 시점(변이 i2 생존)

재검증 요청 시 이 메시지에 회신해 주세요.
```
