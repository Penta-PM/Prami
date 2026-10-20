# QA 기록 — PR #58 LAN 개발 DB 마이그레이션 재발 방지 (T2)

- 판정: **통과 / 셀프머지 승인** (2026-10-20)
- 요청: Dev msg_0200641a7b89
- 스펙: origin/Plan docs/specs/migration-apply-lan.md §2 T2·§4
- 증거(로컬 scratchpad): qa58logs/{summary.txt,live-*.txt,startup-direct.log,poll-live.txt,mutation.txt,e2e.log,shots/}, scripts58/

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #58 — LAN 개발 DB 마이그레이션 재발 방지 (T2)

검증 SHA: 5c63b0b (5c63b0b3f7ff95ee536a8e027ed27d3634a9e600, base main 5b3fd6d)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · ci:run 녹색
(참고: #57 머지 5b3fd6d = 검증 0993dd1 diff 동일 — QA 확인)

## 검증한 내용 (실제 실행 기준)
라이브(next dev :3200, main 5b3fd6d :3250 대조):
  - DB는 실데이터 prami 읽기 전용 pg_dump 사본입니다. 변형 3종을 만들었습니다.
    · no9: cost_item_links 삭제 + 0009 기록 삭제
    · no89: 0008·0009 미적용
    · noprice: sales_prices 이름 변경
  - 원가 비중 실패 격리(no9):
    · ADMIN /admin/policies 200, 50행, 원가 비중 열 유지, 50칸 모두 '—'
    · 표 위 안내 '원가 비중을 계산하지 못했습니다. 관리자에게 문의하세요.'(원문 일치, role=status, 대비 5.44:1)
    · main은 같은 DB에서 500과 오류 화면
  - 서버 로그 pricing.cost_ratio_failed: error{name, message, code 42P01, stack, cause}, rows 50. DB 주소·계정·비밀값 0
  - USER /pricing 200, 안내·오류 없음(콘솔 0). USER /admin/policies는 /로 리다이렉트
  - 가격 행 조회 실패(noprice): PR·main 모두 500과 같은 오류 화면. 원가 비중 로그로 삼켜지지 않음
  - 정상 DB 회귀:
    · 안내·배너 없음
    · Wapples-1700 T1 24.2% / 18.0% = SQL 재계산
    · 표 출력이 main과 diff 0
  - 기동 배너(next dev):
    · no9 → drizzle/0009_cost_item_links.sql + 'pnpm db:migrate' 안내
    · no89 → 0008·0009, 빈 DB → 10개 전부
    · __drizzle_migrations 개수·md5와 테이블 수가 전후 동일(자동 적용 없음)
    · 모두 적용된 DB → 배너 없음
  - 배포 환경(VERCEL_ENV preview/production):
    · 배너 없음. db.schema_behind·fixture_accounts_present 로그가 main과 동일
    · /api/health 503 schema:'behind'와 schema_ahead warn이 main과 동일
    · prod 규칙이 테스트 env를 거부해 next start 대신 runStartupChecks를 PR·main 사본에서 직접 실행해 대조했습니다.
  - 알림 폴링: /api/notifications 강제 500 → 드롭다운 role=alert, 막기 해제 후 조작 없이 다음 60초 폴링에서 200 → '알림 2개 안 읽음'
  - verification.md §3: QA CLAUDE.md(QA 무머지·:3000 무접촉)·스펙 §2-1과 모순 없음
    · -U prami = 실제 POSTGRES_USER, pg_dump 명령 그대로 실행 가능
  - 라이트·다크 캡처 동일(다크 테마 없음). 증거: qa58logs/shots/
게이트(git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2642 passed (lines 96.42)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 5c63b0b, 새 DB qa58_e2e, 102/102 passed, 0 flaky, 8.7분
  - 변이 10건 중 8건 검출: 배포 환경 배너·자동 적용·오류 전파·USER 안내 2종·실패 없을 때 안내·로그 삭제·가격 행 실패 삼킴

## 수용 기준 대조 (§4 T2)
- [x] verification.md §3: drizzle/*.sql PR 머지 직후 백업 → main 기준 db:migrate → 적용 목록 확인 → 머지 보고 기록 — 문서 대조
- [x] 비배포 환경 + 스키마 뒤처짐 → 콘솔 배너(미적용 파일 목록 + pnpm db:migrate), 자동 적용 없음, DB 주소 없음 — 라이브 3종 DB
- [x] 배포 환경 무변경 — VERCEL_ENV 대조, health 503 동일
- [x] 원가 비중 실패 격리: 로그 + '—' + 원가 권한 사용자에게만 안내, 가격 행 실패는 기존 오류 — 라이브
- [x] 알림 500 뒤 다음 주기 회복 — 단위 + 라이브
- [x] Dev 게이트 기록 + QA E2E 전체 1회(102/102) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. [테스트 공백] 배너 'DB 주소 없음' 단위 검사가 /postgres:\/\// 하나뿐입니다.
   - 생존 변이: DATABASE_URL 출력, scheme 없는 user:pw@host:5432/db 출력
   - 주소를 넣은 env로 host·password·DATABASE_URL 값 부재를 단언하기를 권합니다. 라이브 출력에는 주소가 없었습니다.
2. pricing.cost_ratio_failed의 error.message에 drizzle SQL 원문 전체와 params(가격 행 id 50개)가 들어갑니다.
   - 비밀값·원가 금액은 없고, 기존 logger 직렬화 그대로입니다. cause.code/message만 남기면 충분합니다.
   - dev에서는 브라우저 콘솔·Next 'Issue'로도 전달됩니다(dev 한정).
3. verification.md는 배너가 'next dev 기동 시' 뜬다고 적었지만, 실제 조건은 '비배포 환경'이라 로컬 next start에서도 뜹니다. 문구 정리를 권합니다.
4. §3-4 확인을 '기록 행 수 = 저널 수'뿐 아니라 최신 created_at = 저널 마지막 when으로도 대조하면 더 확실합니다.
5. T1(LAN DB 복구)은 판정 범위 밖입니다. 다만 읽기 전용 덤프에서 prami 마이그레이션 기록 10건이 저널과 일치했습니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
