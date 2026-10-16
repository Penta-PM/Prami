# QA 기록 — PR #54 #31 PR-3 (폴링 세션 미연장·공용 중요 배지·로그아웃 결정성)

- 판정: **통과 / 셀프머지 승인** (2026-10-16)
- 요청: Dev msg_bceb027cf853
- 근거: Plan 결정 msg_11c3d58840d1
- 증거(로컬 scratchpad): be54logs/{summary.txt,headers-prod.txt,headers-chunk.txt,expiry-pr-poll.log,mut-unit.txt,shots/}, fe54shots/, scripts/fe54*.mjs

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #54 — #31 PR-3 (알림 폴링 세션 미연장·공용 중요 배지 대비·E2E 로그아웃 결정성)

검증 SHA: 276d4b6 (276d4b6ed70131c0d57758b1f2c16175adb0b57a, base main 6c564f6)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · rebase 후 ci:run 녹색
  ※ src/proxy.ts 변경이라 QA가 전부 다시 돌렸습니다.

## 검증한 내용 (실제 실행 기준)
Backend/세션 (git archive 사본, 프로덕션 next build && next start, main 6c564f6 대조):
  - lint·typecheck·format·secrets·prerender·trace PASS
  - unit coverage 2400 passed (lines 96.28)
  - build PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 276d4b6, 새 DB qa54be_e2e, 84/84 passed, 5.7분
  - 안정성(각각 새 DB):
    · notifications.spec --repeat-each=3: 33/33
    · quote-share.spec --repeat-each=3: 6/6 (#53 때 head에서 간헐 실패하던 스펙)
  - 응답 헤더(실 Auth.js JWE 세션):
    · /api/notifications GET·?limit·HEAD·OPTIONS: 세션 Set-Cookie 없음
      - csrf·callback-url 쿠키 유지, 본문 정상, 미인증 401 무변화
      - main은 재발급(exp 연장)
    · /, /notices, ?_rsc, 서버 액션 POST, /api/chat/status: 재발급(+8h) = main과 동일
    · /api/notifications/ → 308(쿠키 없음). /api/notifications/x·/API/notifications는 404 재발급(main과 동일)
    · https(__Secure-): 알림만 제거, notices·chat/status는 재발급, __Host- csrf 유지
    · 큰 세션(조각 .0~.5, 일반·__Secure-): 알림은 모든 조각 제거, 나머지 경로는 모든 조각 재발급
    · 보안 헤더(CSP·HSTS 등)·리다이렉트: 7개 경로 × 로그인/익명에서 main과 동일(요청별 nonce 제외)
  - 만료 실측(PR·main 사본 모두 세션 maxAge 120초로 줄여 재빌드, 이후 원복):
    · PR, 탭을 띄워 둔 채 폴링만:
      - +62s·+122s 폴링은 200이고 쿠키 없음, +142s에 브라우저 쿠키 소멸
      - +182s 폴링 401, 마지막 토큰을 직접 보내도 401
      - +202s 내비 클릭 → 307 /login?callbackUrl=%2Fnotices(스크린샷)
    · main(대조): 폴링마다 exp가 연장돼 +202s에도 로그인 유지 → 이번 변경이 차이를 만듦
    · PR, 20초마다 이동: 이동마다 exp +120s 연장, +203s에도 200 → 일반 이동 연장 유지
  - 변이:
    · 단위: __Secure- 미제거·조각 미제거·전 경로 제거·제거 안 함·경로 접두 매칭·무관 쿠키 삭제 검출
    · E2E: proxy 호출 제거·전 경로 제거 검출
    · 생존 2건(^ 앵커, 조기 반환)은 동작이 같은 변이입니다.
  - signOutLocally 재시도 루프 진단(원복함): 10회 호출에서 쿠키 부활 0, 첫 300ms 확인 때 이미 비어 있었고 이후 3초도 0. 중앙값 918ms
Frontend (실제 Chromium 1440×900, next dev :3200 / main :3250, 애니메이션 켬, 새 DB qa54fe):
  - '중요' 배지 대비(canvas 합성 실측):
    · 공용 배지 5곳(/notices 목록·상세, /admin/notices, 홈, /search): 평상시 5.04:1(main 3.73), hover 4.72:1(main 3.49)
    · 드롭다운(미읽음·읽음·hover·focus): 4.72~5.04:1(main과 동일 — 기존 오버라이드 제거 후에도 같은 색)
  - axe color-contrast 배지 위반: PR은 6곳 모든 상태에서 0, main은 페이지마다 1
  - 픽셀 비교: 페이지당 약 48px, 전부 배지 17×9 영역의 빨간 픽셀입니다. 그 밖 0. 드롭다운 0px
  - 드롭다운 회귀:
    · 열기·Esc·바깥 클릭, 중요 미읽음 클릭 → 이동 + read_at, 모두 읽음 0
    · 폴링 59.0s에 새 행 표시
    · /api/notifications 21회 모두 200이고 세션 Set-Cookie 0(main은 18/18 있음)
  - 로그인 브라우징: /, /notices, 상세, /admin/notices, /search 모두 200, /login 이동 없음, 페이지 로드가 세션 갱신
  - 콘솔·하이드레이션 0. 다크 테마 없음(라이트만). 증거: fe54shots/

## 수용 기준 대조 (Plan msg_11c3d58840d1)
- [x] 폴링만 8h+ 지속 시 만료, 다음 조작 때 로그인 이동 — maxAge 120s 사본 실측(PR 만료 / main 유지 대조)
- [x] 폴링 응답에 세션 Set-Cookie 없음 — 프로덕션 헤더(일반·__Secure-·조각), E2E 헤더 단언
- [x] 일반 이동은 기존대로 연장 — 페이지·RSC·액션 재발급, 20초 이동 실측
- [x] 챗봇 상태 조회 슬라이딩 무변경 — /api/chat/status 재발급 = main
- [x] 공용 ImportantBadge red-600, /notices·공지 관리·드롭다운 axe 대비 위반 0 — 6곳 실측, 드롭다운 전용 오버라이드 제거
- [x] Dev 게이트 기록 + QA E2E 전체 1회(84/84) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. 세션이 무효일 때 /api/notifications가 쿠키 삭제 지시(Max-Age=0)까지 제거합니다(main은 보냄). 응답은 401이고 다음 페이지 로드에서 지워져 보안 영향은 없습니다.
2. 프로덕션의 Link 프리페치(?_rsc)도 세션을 재발급합니다. 링크 hover만으로 연장되고, 유휴 200초 동안에는 발생하지 않았습니다. 정책상 '사용자 조작'으로 보는지 Plan 참고.
3. E2E는 /api/chat/status 연장만 대조합니다. '페이지 이동 연장'은 단위 테스트와 QA 실측으로만 고정돼 있습니다.
4. signOutLocally는 첫 '비어 있음' 확인에서 반환합니다. 그 뒤 되살아나는 경우는 이론상 놓칠 수 있습니다(실측 0회, about:blank가 진행 중 요청을 끊음).
5. 홈 상품 카드 '가격 정책 보기 →' 링크 대비 4건(2.87~4.2:1)이 main과 같이 남아 있습니다. 범위 밖입니다.
6. NoticeRows.tsx 주석의 '흰 배경 5.05:1'은 실제로는 분홍 배지 배경 위 5.04:1입니다(문구만).

머지 진행하셔도 됩니다. (머지는 Dev가 수행, 다음 #53)
```
