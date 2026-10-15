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

## 2차 (재검증 2df0560) — **통과 / 셀프머지 승인** (2026-10-15)

- 요청: Dev msg_34f9eae698da
- 증거: fe52bshots/, scripts/fe52b*.mjs, be52blogs/{summary.txt,e2e-full.log,notif-r3.log,qs-r3.log,diag.log,networkidle-probe.log}

```
[통과 / 셀프머지 승인] PR #52 — #31 PR-2 알림 UI (Closes #31) 재검증

검증 SHA: 2df0560 (2df0560ea895c17b32b2439b313fa722e13df585, base main 2df55d9)
  ※ 45aabce 위에 커밋 1개, rebase 없음
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ #50이 먼저 머지돼 rebase하면, 규칙 §3.3대로 다음을 기록해 주세요(파일 겹침 없음).
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · rebase 후 ci:run 녹색

## 1차 CRITICAL 해소 확인
1. 중요 배지 axe 대비 — 해소
   - 드롭다운 '중요' 배지가 rgb(196,0,24)(red-600) 11px/600입니다.
   - 대비(브라우저 실제 합성 배경을 canvas로 측정, axe 수치와 일치): 미읽음(보라 틴트) 4.72:1, 읽음 5.04:1
   - [role=dialog][aria-label=알림] axe color-contrast 위반 0 / incomplete 0
     · 4건 목록, 20건 목록, hover, 키보드 focus 상태 모두
     · WCAG 2.0/2.1 A·AA 전체 태그도 0
   - 새 E2E(열린 드롭다운 + 미읽음·중요 axe)는 이번 E2E 전체에서 통과했습니다.
   - /notices의 공용 배지는 여전히 3.73:1(red-500)입니다. Plan 결정대로 #31 PR-3 대상이고, 이 PR은 건드리지 않습니다.
2. notifications.spec:139 flaky — 해소
   - 같은 명령 notifications.spec.ts --repeat-each=3(새 DB): 45aabce는 3회 중 2회 실패 → 2df0560은 27/27 통과
   - quote-share.spec.ts --repeat-each=3(새 DB): 6/6 통과. main의 :77 간헐 실패도 같은 헬퍼 수정 대상입니다.
   - signOutLocally 실측(진단 사본, 원복 확인):
     · networkidle 대기 0~617ms, 로그아웃 전체 최대 638ms. 15초 상한에 걸린 적 없음, 60초 폴링도 막지 않음
     · createNotice 직후 호출에서 진행 중이던 GET /admin/notices?_rsc가 대기 중에 끝났습니다.
     · 쿠키 삭제 뒤 1.5초 동안 쿠키가 다시 생기지 않았습니다.

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, next dev :3200, 애니메이션 켬, 새 DB qa52bfe):
  - 1차 전 시나리오를 다시 돌려 1차 결과와 대조했습니다. 기능 값은 전부 동일합니다.
    · 배지 0·1·99·99+(100/150)와 aria-label, Esc·바깥 클릭 시 종으로 포커스 복귀
    · 항목 클릭: 읽음 → 이동(/notices·/pricing·/settings) → 배지 감소
    · 모두 읽음: DB 26→0, 버튼 disabled
    · 빈·로딩·오류(500/503/중단) 상태와 다시 시도
    · 폴링: 60.7s 간격, hidden 0, visible·focus 때 즉시
    · 챗↔드롭다운 공존 프레임 0(일반·reduced)
    · 320/1440 넘침 0
    · 콘솔: 하이드레이션·페이지 에러 0
  - 라이트·다크 에뮬 양쪽으로 돌렸습니다. 다크 테마가 없어 둘 다 흰 배경으로 동일합니다.
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2220 passed (lines 96.26)
  - secrets·build·prerender·trace PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 2df0560, 새 DB qa52b_e2e, 82/82 passed, 0 flaky, 6.0분(다른 E2E와 겹치지 않게 순차)
  - 1차에서 확인된 나머지(HTTP Next-Action IDOR 안전, 폴링·모달 우선·반응형·변이 18/21)는 diff 범위 밖이라 그대로 유효합니다.

## 수용 기준 대조 (PR-2)
- [x] 종 배지(SSR 없음·99+·aria-hidden 숫자·중요 배지 계열 색) — FE
- [x] 드롭다운(비모달 dialog·최근 20·클릭 = 읽음 → 이동 → 닫기·모두 읽음·로딩/빈/오류·다시 시도·키보드) — FE
- [x] 폴링 60초·visible·focus·열 때 즉시·hidden 정지 — FE fake clock 실측, 단위 변이
- [x] 챗 패널과 동시 표시 없음(양방향 퇴장 대기, 재클릭 취소, aria-pressed 즉시) — rAF 공존 프레임 0
- [x] 읽음 액션 IDOR — HTTP Next-Action 재전송으로 타인 행 무변화(1차)
- [x] 375/320 가로 스크롤 0, 1280 종 기준 오른쪽 정렬, reduced-motion 이동 없음, axe 색 대비 통과 — FE(이번 수정으로 대비 충족)
- [x] Dev 게이트 기록 + QA E2E 전체 1회(82/82) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. networkidle 대기가 결정적 해결은 아닙니다.
   - Playwright 1.63의 networkidle은 페이지 로드마다 한 번 도달하면 고정됩니다(coreBundle 확인).
   - 실측: 같은 페이지에서 3초 fetch가 진행 중인데도 2ms 만에 반환했습니다.
   - 액션 전에 페이지가 이미 idle이면 진행 중인 _rsc를 기다리지 않을 수 있습니다. 지금 흐름에서는 동작합니다.
   - 결정적 대안: 액션 뒤 _rsc 응답을 page.waitForResponse로 기다리거나, 짧은 대기 후 쿠키를 한 번 더 삭제합니다. 헬퍼 주석도 그 한계를 함께 적기를 권합니다.
2. 미읽음 행 배지 4.72:1은 기준(4.5)과의 여유가 작습니다. PR-3에서 공용 배지를 red-600으로 통일할 때 틴트를 바꾸면 다시 확인이 필요합니다.
3. Esc 직후 헤더 axe가 퇴장 페이드 중인 드롭다운 텍스트를 잡아 대비 노드 수가 흔들립니다(4~9 → 안정 후 0). 실제 대비 문제는 아니고, 측정 타이밍 문제입니다.
4. 1차 백로그 1·2·5는 PR 본문 정정으로 처리됐습니다. 세션 연장(6)·공용 배지는 #31 PR-3(Plan 결정)입니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행, Plan 순서 #50 → #52)
```

## 머지 후 SHA 대조 (QA 확인)
- main 6c564f6(squash, #52) 의 diff 가 검증 SHA 2df0560 의 PR diff(merge-base 2df55d9 기준)와 동일함을 QA 가 확인.
