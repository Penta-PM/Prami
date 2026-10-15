# QA 기록 — PR #51 #31 PR-1 알림 서버

- 판정: **통과 / 셀프머지 승인** (2026-10-15)
- 요청: Dev msg_cb5c4ffaf25b
- 스펙: origin/Plan docs/specs/issue-31-notifications.md §2·§4·§6·§7 PR-1, 구현 중 판단 Q2·Q3
- 증거(로컬 scratchpad): fe51logs/, scripts/fe51*.mjs·idor51.mts, be51logs/{summary.txt,e2e.log,atomic.log,atom-pglog.txt,explain.txt,upgrade*.txt,mut/summary.txt,qa51-atomic.pg.test.ts}

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #51 — #31 PR-1 알림 서버 (Part of #31)

검증 SHA: 6a7128c (6a7128c1b7a21fa419ee68310d5f9c5376e4a21e, base main 8e7569f)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ #50(파일 겹침 없음)이 먼저 머지돼 rebase하면, 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · rebase 후 head SHA의 ci:run 녹색

## 검증한 내용 (실제 실행 기준)
라이브 (next dev :3200, 실 Postgres qa51fe·qa51fresh·qa51up, main 8e7569f :3250 대조):
  - 사용자 6명으로 확인했습니다: 행위자 admin, ADMIN 1, USER 3, 비활성 1.
  - notice.created (/admin/notices UI 등록):
    · 활성 비행위자 4명에게 각 1행, 행위자·비활성 0
    · API href /notices/{uuid}, no-store
    · 기존 공지 소급 0
    · 수정(제목·중요 해제) 8→8
    · 삭제 시 행 4→0, API에서 사라짐
  - policy.applied (/admin/policies UI sales-200 적용):
    · 4명에게 각 1행
    · 행 전체가 {"title":"가격정책이 갱신되었습니다","body":"반영 200건",…}이고 금액이 없습니다.
    · href /pricing
    · 강제 실패 적용 시 run=failed, 알림 무변화
    · Q2: import:source 스크립트 적용 3회(run_by null) → 0행
  - user.role_changed:
    · USER→ADMIN, ADMIN→USER 각각 대상 1명에게만 1행, href /settings
    · 부서만 수정 13→13, 비활성화 14→14, 비활성 대상 역할 변경 14→14
  - 원자성 (실 PG, notifications에 CHECK(false) NOT VALID를 임시로 걸고 UI·서버 함수로 실행):
    · 공지 등록: notices·audit·알림 모두 롤백
    · 역할 변경: 역할 유지, audit 무변화
    · 정책 적용: '기존 데이터는 변경되지 않았습니다', sales_prices 무변화
    · pg log_statement=all 로그: 원 행위·audit와 같은 BEGIN/COMMIT 안에서 INSERT…SELECT 1문장
    · 수신자 0명(행위자만 활성)이어도 정상 커밋, 에러 없음
  - GET /api/notifications:
    · 미인증·위조 쿠키 → 401 JSON(기존 /api/chat/status와 같음)
    · 200 응답은 전부 cache-control: no-store, POST 405
    · limit: 빈값 20 / 0·-1 1 / 51·1e3·1e20 50 / abc 20 / 2.9 2 (clampLimit 설계대로 클램프)
    · 31일 전 행 제외, 29일 전 행 포함. 정렬은 created_at desc, id desc
    · 응답은 본인 행만이고, 키는 id,type,title,body,href,createdAt,read,important뿐입니다(actor·user id 없음).
    · 모르는 type, ref '../../evil', null ref는 목록·개수 모두에서 제외
    · 미읽음 수가 SQL과 일치(63)
  - IDOR (DB 함수 수준, 실 PG):
    · C가 B의 행을 markRead → 0행, B read_at 유지
    · C markAllRead → C만 4행 바뀌고 B는 3→3
    · 잘못된 uuid·SQL 주입 문자열은 zod가 거부
  - 권한: notification.self = USER·ADMIN(역할이 이 둘뿐). 비활성 사용자는 로그인 실패, API 401. 조회·읽음 감사 0
  - 화면 회귀: 7개 페이지 스크린샷을 main과 픽셀 비교했습니다.
    · 헤더 동일
    · /admin/users RBAC 표에 '내 알림' 행만 추가(의도)
    · 콘솔 에러 0, /api/notifications 요청 0, 가로 넘침 0
    · 라이트만 확인(다크 테마 없음)
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2184 passed (lines 96.21)
  - secrets·build·prerender·trace PASS
  - integration 31 passed (qa51be_int, notifications.pg·clean-install 포함)
  - E2E 전체 1회: SHA 6a7128c, 새 DB qa51be_e2e, 73/73 passed, 5.6분
  - 마이그레이션:
    · 0008 SQL = schema(10열, link 없음, user FK cascade / actor FK set null)
    · 인덱스 (user_id, created_at desc)와 부분 unread, title≤200·body≤500 CHECK(실패 insert로 확인)
    · drizzle-kit check·generate 모두 차이 없음
    · 저널 9개
  - 업그레이드 경로: main 8개 마이그레이션 + seed + 임포트 → head migrate 9
    · 전 테이블 행 수 동일, items·audit_logs md5 동일
    · 재실행은 no-op
  - data:verify:
    · --stage schema 9|9 PASS
    · --fresh는 notifications 0행 PASS, 1행 넣으면 FAIL(살아 있는 검사)
    · local 32 PASS / 1 SKIP(Q3)
  - EXPLAIN(5만 행): 목록·미읽음 수·전체 읽음 모두 인덱스 사용(0.3–0.8ms)
  - 변이 18건 중 15건 검출:
    · 검출: 행위자 포함·비활성 포함·markRead/markAll user_id 제거(IDOR)·30일 제거·수정 시 알림·실패 시 알림·공지 커밋 후 insert·정책 본문 금액·삭제 정리 제거·역할 외 필드 알림·href·스크립트 알림·삭제 공지 필터·limit 상한
    · 생존 3건은 아래 백로그에 적었습니다.
  - 테스트 변경: health/data-verify/clean-install은 0007→0008·8→9만, users-ui는 단언 1개 추가. 약화된 단언 0

## 수용 기준 대조 (PR-1 해당분)
- [x] 공지 fan-out, 행위자·비활성 제외 — 라이브 1, 변이 a·b
- [x] 소급 없음, 수정 무알림, 삭제 정리 — 라이브 1, 변이 e·j
- [x] policy.applied 금액 없음, 실패 무알림, 스크립트 적용 무알림(Q2) — 라이브 2, 변이 f·h·m
- [x] role_changed 대상만 — 라이브 3, 변이 k
- [x] 원자성 — PGlite 단위 + QA가 실 PG에서 3종 모두 롤백 확인
- [x] IDOR — DB 함수 수준 실측, 변이 c·c2 (HTTP 수준은 PR-2에서 재확인, 아래 참고)
- [x] href 3종, requiredPermission 표 고정 — 라이브 API, 변이 l
- [x] 30일 창 — 29/31일 경계 실측, 변이 d
- [x] schema / data-verify / neon-compat 회귀 — drizzle-kit, data:verify, clean-install, health.test
- [x] CSP·env·vercel.json diff 0
- [x] Dev 게이트 기록 + QA E2E 전체 1회(73/73) — 머지 head SHA의 ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹, 이번 머지 안 막음)
1. [PR-2 검증 메모] markNotificationReadAction / markAllNotificationsReadAction은 아직 어떤 클라이언트 컴포넌트도 import하지 않습니다.
   - 그래서 server-reference-manifest에 없고, HTTP로 호출할 수 없습니다.
   - IDOR는 DB 함수 수준에서만 확인했습니다. PR-2(종 UI)에서 HTTP Next-Action 수준 IDOR를 QA가 다시 확인합니다.
2. 원자성 테스트 공백:
   - 역할 변경·정책 적용 알림 insert를 트랜잭션 밖으로 옮겨도 PR 테스트가 통과합니다(변이 g2·g3 생존).
   - QA가 만든 실 PG 테스트는 둘 다 검출합니다(be51logs/qa51-atomic.pg.test.ts 참고 가능).
3. data-verify ZERO_TABLES에서 'notifications'를 빼도 테스트가 통과합니다(변이 i). 실검사는 동작합니다.
4. deleteForNotice가 (ref_type, ref_id)로 거르는데 인덱스가 없어 전체를 스캔합니다(5만 행에서 7ms). 정리 cron이 없어 테이블은 계속 커집니다.
5. docs/deploy/local.md 표기:
   - §5 리허설 표 중간에 '#31 이후 기대값' 인용문이 끼어 있어, 뒤 '| 복원 | …' 행이 인용문 텍스트로 렌더링됩니다.
   - §2 요약 표 --stage schema 행이 아직 '8행(0000~0007)'입니다.
6. 미읽음 수는 limit 밖 항목도 셉니다(73 vs 목록 50). 스펙대로이며, PR-2 배지(99+) 설계 때 참고하세요.
7. '변경 UI 없음'이라고 했지만 /admin/users RBAC 표에 '내 알림' 행이 추가됩니다(의도된 변경, users-ui.test 반영).

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
#50은 Plan 결정(Q-A·Q-B)을 기다리는 중입니다.
```
