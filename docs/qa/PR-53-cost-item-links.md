# QA 기록 — PR #53 원가 매핑 PR-1

- 판정: **통과 / 셀프머지 승인** (2026-10-15)
- 요청: Dev msg_5a8d37962cca
- 스펙: origin/Plan docs/specs/cost-ratio-price-change.md §2.1·§4·§5 태스크 1·2
- 증거(로컬 scratchpad): fe53shots/, scripts/fe53*.mjs, be53logs/{summary.txt,e2e*.log,mut/summary.txt,qa53-links.pg.test.ts,iso-lint.log,dryrun-real.log,real-suggestions.tsv}

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #53 — 원가 매핑 PR-1 (cost_item_links·모델명 휴리스틱 제안·/admin/costs/links)

검증 SHA: a5c007d (a5c007da5f116608235888bfba4ea83daed009e9, base main 2df55d9)
  ※ Dev 게이트 0d46303 = a5c007d 트리 동일(e85f153e). 다만 drizzle 변경이라 QA가 전부 다시 돌렸습니다.
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ #52 머지 후 rebase(배포 문서 0000~0009)하면, 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로 바뀐 것이 그 문서 줄뿐이라는 사실과 그 diff
    · rebase 후 head SHA의 ci:run 녹색
  ※ 배포 문서 외 코드 diff가 달라지면 재검증 대상입니다.
  ※ 머지 순서는 Plan 순서(#50 → #52 → #31 PR-3 → #53)를 따라 주세요.

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, next dev :3200 / main :3250):
  - DB: 실데이터 DB 'prami'를 pg_dump로 읽기 전용 복사해 0009까지 마이그레이션한 qa53fe(원본은 읽기만 함)
  - 후보:
    · 독립 SQL로 WAPPLES 172 + KMS 124 + iSIGN 146 = 442 = UI 행 수, 제품군 필터 수도 일치
    · SA·SC·파츠·Optional Package·S/W 업그레이드 34 제외, 폐기 품목 포함
  - 제안: 442개 독립 재계산과 UI 비교 불일치 0
    · 포트 변형·Standby·HA·DR·Rest API·DCC → 본체
    · S/W 업그레이드 11건 '제안 없음', RAID는 RAID 원가만, (중복) 자재 제외
    · 같은 모델 원가를 하나 더 넣으면 해당 4품목 제안이 사라짐(306→302)
  - 확정·직접 선택·해제:
    · DB 행 created_by/updated_by = admin, 감사 cost_link.upsert(after) / 직접 선택은 before·after / 해제는 cost_link.delete(before)
    · 같은 쌍 재확정은 '변경 없음 1건'이고 감사 없음
  - 일괄:
    · KMS 전체 선택 99건이 1요청에 저장됐고 제안과 불일치 0
    · 527건은 UI가 [500, 27]로 나눠 전부 저장
    · 501건 재전송은 VALIDATION '한 번에 500건까지'
  - 고아: 품목을 지운 링크 321건이 '품목 없음' 구역에 나옵니다. 자동 삭제 0, 해제 가능, '(원가표에 없음)' 표시
  - 원가 금액 노출 0: 실제 unit_cost 319종(콤마 포함)과 키 이름을 검색
    · HTML 900KB·RSC·모든 서버 액션 응답·선택 모달에서 0건
    · 같은 스캐너가 /admin/costs에서는 38건을 잡습니다(스캐너 유효).
  - 권한:
    · USER → 307 /, RSC에 자재 코드 없음, auth.access_denied 감사
    · 미인증 → 307 /login
    · USER·익명이 액션을 재전송해도 DB 무변화
    · 세션 중 USER로 강등돼도 DB 무변화
  - 입력 검증(ADMIN 재전송): 모르는 품목·자재·빈값·101자·타입 오류·빈 목록·같은 품목에 자재 2개 → VALIDATION, DB·감사 무변화
  - /admin/costs 회귀: '원가 매핑' pill만 추가(4.93:1)됐고 기존 대비 위반은 main 7 → PR 6
  - 접근성:
    · 매핑 화면·모달 axe 0
    · Tab 순서 정상·focus-visible, Space 체크·Enter 확정, 모달 Esc 후 트리거 복귀
    · 텍스트 대비 최저 4.62:1
  - 반응형 320/768/1024/1440: 페이지 넘침 0(표는 내부 스크롤). 빈·대기·오류 상태 확인
  - 콘솔·하이드레이션 0. 다크 테마 없음(라이트만). 증거: fe53shots/
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2236 passed (lines 96.10)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA a5c007d, 새 DB qa53be_e2e, 76 passed / 1 failed, 9.3분 (아래 E2E 참고)
  - 새 스펙 cost-links.spec.ts --repeat-each=3: 12/12. 실행 후 '(E2E)' 원가 0행, cost_item_links 0행
  - 마이그레이션:
    · 0009 = schema(item_code PK, material_code NOT NULL·FK 없음, created/updated_by → users SET NULL, items FK 없음 — 설계대로)
    · drizzle-kit check·generate 차이 없음, 저널 10개
    · 업그레이드 경로: main 9개 + seed + 픽스처 → head 10. 행 수와 items·sales·costs·audit md5가 동일
    · 테스트 변경은 9→10, 0008→0009뿐이고 약화된 단언 0
  - 원가 격리:
    · 위반 파일을 넣으면 ESLint 11건 검출(스키마 import·schema.costItemLinks·db.query·raw SQL 3형태·server/cost 동적 import)
    · 대조 문자열은 미검출
    · 새 규칙 5개를 각각 빼면 isolation.test가 실패
  - 실 PG 서버 로직(QA 작성 테스트 6/6):
    · 후보·제외·제안 규칙
    · 감사 insert를 트리거로 실패시키면 upsert 배치 전체 롤백(앞 항목·감사 포함), delete·update도 롤백
    · 가격 유형이 다르거나 삭제된 원가 → VALIDATION, 500건 저장 / 501건 거부
    · 권한: 세션 없음 UNAUTHENTICATED, USER FORBIDDEN(행 무변화), 세션 중 강등 FORBIDDEN
  - dry-run: 실데이터 사본을 default_transaction_read_only=on으로 두고 실행(CREATE 실패 확인)
    · exit 0, 개수만 출력
    · PR 본문 442/301/306/235/11/41/84, 자재 157과 일치
    · pg_stat insert/update/delete와 감사 무변화
  - 변이: 대부분 검출. 생존 2건은 아래 백로그입니다(QA 실 PG 테스트는 검출).

## E2E 실패 1건 판단 (비블로킹 — 기존 로그아웃 경쟁)
- quote-share.spec.ts:77이 head에서 전체 1회 실패했고, 규칙대로 --repeat-each=3을 돌리니 5/6 통과했습니다.
- main 2df55d9은 1회 2/2, 진단용 3회 6/6 통과했습니다.
- 그래도 이 PR 원인이 아니라고 판단한 근거:
  · PR이 quote-share 스펙·helpers·로그인·세션 코드를 건드리지 않습니다(바이트 동일).
  · 실패 지점이 #52에서 원인을 실측한 signOutLocally 경쟁과 같습니다(진행 중 _rsc 응답이 세션 쿠키를 다시 심음).
  · 같은 줄이 main 8e7569f에서도 재현됐습니다(#50 2차).
- 그래서 이 PR의 결함이 아니라 공용 헬퍼의 기존 flaky로 판단합니다.
  · #52(2df0560)가 헬퍼를 고쳤습니다(networkidle 대기 후 about:blank·쿠키 삭제).
  · rebase 후 머지 head의 ci:run 녹색으로 확인해 주세요. 거기서 다시 실패하면 QA에 알려 주세요.

## 수용 기준 대조 (PR-1 해당분)
- [x] 매핑 화면: 후보에 휴리스틱 제안이 보이고, 확정한 행만 저장된다 — FE 제안 442 재계산 일치, 목록 조회 시 저장 0(BE)
- [x] cost.write 없으면 수정 불가 — 서버 FORBIDDEN(실 액션, USER·강등), UI read-only 분기는 단위 테스트
  · 실제 역할 2개(USER/ADMIN)뿐이라 'cost.read만 있는 사용자'는 라이브로 만들 수 없습니다.
- [x] cost.read 없으면 화면 접근 불가 — USER 307, RSC 자재 코드 0, 접근 거부 감사
- [x] 변경 시 감사 로그 — upsert/delete before·after, 같은 트랜잭션(트리거 실패 시 롤백)
- [x] 원가 금액 미노출 — 319개 금액 0건, 클라이언트 타입·액션 반환에 금액 필드 없음, dry-run 개수만
- [x] 원가 격리 확장 — ESLint 11건 검출, isolation.test 규칙별 검출
- [x] 마이그레이션·schema·data-verify 회귀 — drizzle-kit, 업그레이드 경로, clean-install·health
- [x] Dev 게이트 기록 + QA E2E 전체 1회(위 판단 포함) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹, 이번 머지 안 막음)
1. [PR-2 전 권장] 후보 범위 밖 품목도 확정 액션으로 링크가 저장됩니다.
   - ADMIN이 액션을 조작해 재전송하면 됩니다. 예: 파츠 P1001050007, SA P2007020001
   - 저장된 링크는 표에도 '품목 없음'에도 안 보여 UI에서 보거나 지울 수 없습니다.
   - PR-2에서는 이 링크로 원가 비중이 계산됩니다.
   - 권한 우회는 아닙니다. 서버에서 후보 범위를 검사하거나, 범위 밖 링크 구역을 따로 두기를 권합니다.
2. 오제안 가능성: 'Wapples-4700 T2 (H4700 T2) RAID' → 'WAPPLES-4700 RAID'(T1 RAID일 가능성)
   - 세대 일치 검사를 RAID 원가 사이에서만 합니다.
   - 확정은 관리자가 하지만, '전체 선택' 일괄에 섞여 들어갈 수 있습니다. 실데이터 제안 전체는 be53logs/real-suggestions.tsv에 있습니다.
3. 같은 모델 원가가 2개라 제안이 없는 행의 사유가 '같은 모델 원가 없음'으로 나옵니다. '모호함'이 맞습니다.
4. iSIGN 'ISign+ PRO (500 T2)'·'ULT (2200 T1)' 형식을 파싱하지 못합니다('모델 못 읽음' 31건 일부).
5. 1440px에서 표가 1393px로 상자 1126px보다 넓어 '동작' 열이 화면 밖에 있습니다(pinned는 순서만, sticky 아님).
   - 아래쪽 행을 확정하면 성공 메시지가 표 위 화면 밖(약 22,000px 위)에 뜹니다.
6. 527건 일괄 확정 뒤 UI가 안정되기까지 약 64초 걸립니다(서버 액션 자체는 1.3s + 0.4s).
7. 테스트 공백(변이 생존):
   - 500건 상한: Dev의 501건 테스트는 없는 품목이라 품목 검사에서 먼저 거부됩니다.
   - item_kind='본품' 필터
   - 확정이 'S/W 업그레이드' 한글만 인식합니다('S/W Upgrade' 영문명은 미래 위험).
8. 감사 before 값을 행 잠금 없이 읽어, 동시 확정이면 before가 낡을 수 있습니다.
9. 소소한 것:
   - 320px 제품군 필터에서 'ISIGN'이 잘림
   - 선택 목록이 (중복) 자재부터 시작
   - E2E HTML 금액 검사가 '7654321.00' 문자열만 봄
   - data:verify --fresh가 cost_item_links를 보지 않음(PR 본문 인지)
10. main에도 있는 것: 빨간 오류 상자(bg-red-500/10 text-red-500) 3.87:1. 공용 '중요' 배지와 함께 #31 PR-3에서 보정할지 검토 권장

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
