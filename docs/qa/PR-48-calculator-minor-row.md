# QA 기록 — PR #48 계산기 STEP 2 소분류 줄 미표시

- 판정: **통과 / 셀프머지 승인** (2026-10-15)
- 요청: Dev msg_15bc3b8be8ec (재부팅 재전송, 원 msg_83735b330c55)
- 스펙: origin/Plan docs/specs/calculator-minor-row.md §2·§4
- 증거(로컬 scratchpad): fe48shots/, scripts/fe48*.mjs, edge48.sql, be48logs/{summary.txt,e2e.log,int.log,live-evidence.txt,mut-*}

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #48 — 계산기 STEP 2 소분류 줄 미표시

검증 SHA: 4e8bb97 (4e8bb974a77df52544406a297b2f620fac24dba4, base main 1c7205e)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ 그사이 #47이 머지돼 main이 478450e입니다. rebase하면 규칙 §3.3대로 아래 두 가지를 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · git range-diff(또는 diff 비교) 결과 diff가 같다는 것
  ※ ci:run은 rebase 후 head SHA로 녹색이어야 합니다.

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, USER로 /calculator):
  - 실행: next dev :3200, 새 DB qa48fe
    · migrate·seed 후 sales-200·items-v1(마스터)·costs-dup을 임포트했습니다(E2E 전역 설정과 같은 절차).
    · main 1c7205e는 :3250에서 같은 절차로 띄워 대조했습니다.
  - 1 중분류 칩 → role=group "소분류" 줄
    · WAPPLES 중분류 8개 모두 DB `SELECT DISTINCT category_mid, category_minor`와 정확히 일치합니다.
    · 예: Wapples Product → [H/W Appliance, NIC, SSL/TLS Acceleator Options, S/W 업그레이드]
  - 2 중분류 전환(H/W Appliance 선택 상태 → Wapples-CC): 소분류 교체, aria-pressed 전부 false, 품목은 CC 3건(DB 일치)
  - 3 같은 중분류 재클릭 → 줄 사라짐 / 제품군 D.AMO로 변경 → 줄 사라짐
  - 4 소분류 칩: aria-pressed=true, STEP 3이 16→10건으로 좁혀짐(DB 일치)
    · 서버 액션 페이로드 {"family":"WAPPLES","priceType":"정상판매","mid":"Wapples Product","minor":"H/W Appliance"}
  - 5 엣지 행을 DB에 직접 넣었습니다.
    · ''·'   '만 / NULL만 있는 중분류 → 줄 없음
    · 혼합(A·' ') → [QA-소A]만
    · 이름 없는 칩·콘솔 에러 0
  - 6 첫 로드: 중분류·소분류 미선택, 소분류 줄 없음
  - 7 Motion: 첫 로드 무애니메이션(전 프레임 opacity 1·transform none)
    · 탭 전환 fadeUp ≈160–179ms(main 150–177), reduced-motion도 main과 동일
  - 8 원가 필드: HTML 54KB·RSC 24.7KB·서버 액션 응답 40건에서 unit_cost/unitCost/material_code/원가 키 0건
  - 접근성:
    · Tab으로 소분류 칩 도달, Enter 선택 / Space 해제, focus-visible 윤곽선
    · 대비: 미선택 4.93:1, 선택 16.13:1
    · axe: 소분류 줄 0건, 페이지 전체는 main과 같은 1건(아래 백로그)
  - 반응형 320/768/1024/1440: 가로 넘침 없음(칩 3/2/2/1줄로 줄바꿈)
  - 라이트: 다크 테마 없음(dark: 0건). 스크린샷 fe48shots/
  - main 대조: 소분류 줄이 전혀 안 나오는 버그를 재현했습니다(main-10-bug-no-minor-row.png)
  - 콘솔·하이드레이션 경고 0
Backend/테스트 (git archive 사본, 실 Postgres):
  - lint·typecheck·format PASS
  - unit coverage 2125 passed, lines 96.17
  - build·prerender·trace·secrets PASS
  - integration 30 passed (qa48be_int)
  - E2E 전체 1회: SHA 4e8bb97, 새 DB qa48be_e2e, 67/67 passed, 4.3분
    · main 66 + 신규 calculator.spec "STEP2: 중분류 → 소분류 → STEP3" 1건
  - 실 DB 종단 (qa48be_live, 실데이터 임포트 + 엣지 14행):
    · minorsByMid가 직접 SQL과 JSON으로 정확히 일치
    · '' / 공백 / NULL 제외
    · __proto__·constructor·특수문자 중분류도 안전(자기 키, 프로토타입 오염 없음)
    · 같은 중분류명이라도 제품군이 다르면 섞이지 않음
    · 모르는 제품군 → fallback
  - listQuoteItemsAction:
    · 미인증 → UNAUTHENTICATED
    · 소분류별 합 10+6 = 중분류 전체 16
    · 모르는 소분류·다른 중분류의 소분류·SQL 주입 문자열 → ok 0건, 예외 없음, 테이블 무변화
    · 101자·숫자 → VALIDATION
  - listQuoteCategoriesAction:
    · src·tests·docs·빌드 산출물에서 참조 0건
    · server-reference manifest에서도 사라졌습니다
  - 쿼리 수: listQuoteCategories 총 3회. minorsByMid는 DISTINCT 1회로 N+1이 없습니다
  - Motion 테스트: lists.test.tsx는 픽스처 필드명만 바뀌었고(minors → minorsByMid) 단언 변경은 0, 전부 통과
  - 변이 5건 전부 검출:
    · 빈 값 미제외 / 중분류 키 무시 / 전환 시 소분류 미해제 / minor 미전달 / 중분류 무관 표시
    · 전환 시 소분류 미해제·minor 미전달 2건은 E2E도 잡았습니다

## 수용 기준 대조
- [x] 소분류 ≥1인 중분류 → "소분류" 줄 + 그 중분류의 소분류 칩 — FE 1, 실 DB 일치
- [x] 다른 중분류로 바꾸면 소분류 교체·선택 해제 — FE 2, 변이 c
- [x] 같은 중분류 해제·제품군 변경 시 줄 사라짐 — FE 3
- [x] 소분류 aria-pressed=true + STEP 3 좁혀짐(minor 전달) — FE 4 페이로드, 변이 d
- [x] 소분류 없음·빈 값만 → 줄 없음·에러 없음·이름 없는 칩 없음 — FE 5, BE 엣지
- [x] 첫 로드 중분류·소분류 미선택, 줄 없음 — FE 6
- [x] 서버 단위: minorsByMid 정렬·타 중분류·빈 값 제외 — server.test + 변이 a·b, 실 DB 대조
- [x] UI 단위(hasMaster:true): 표시·전환·해제 — ui.test + 변이 c·d·e
- [x] E2E 중분류 → 소분류 → 품목 좁혀짐 1시나리오 — calculator.spec:88 통과
- [x] 탭 전환 fadeUp·첫 로드 무애니메이션 무변화 — FE 7 실측, Motion 테스트 통과
- [x] 클라이언트 페이로드 원가 필드 없음 — FE 8, 기존 검사 통과
- [x] Dev 게이트 기록 + QA E2E 전체 1회(67/67) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹, 이번 머지 안 막음)
1. [UX → Plan] Wapples Product의 NIC·SSL/TLS Acceleator Options 소분류는 전부 파츠(item_kind=파츠)입니다.
   - STEP 3은 파츠를 제외하므로 이 칩을 누르면 품목 목록이 항상 비어 보입니다.
   - 스펙(마스터 적용 품목, 중분류 목록과 같은 규칙)대로이긴 하지만, 빈 결과 칩을 노출할지는 Plan 판단이 필요합니다.
2. btrim이 ASCII 공백만 지웁니다.
   - 탭·NBSP만 있는 소분류는 빈 모양의 칩이 됩니다.
   - ' QA-sp '처럼 앞뒤 공백이 있으면 칩은 보이지만, 액션 zod .trim() 때문에 목록이 빕니다.
   - 임포트 경로는 JS trim으로 막고 있어 DB에 직접 써야만 생깁니다(#46 백로그 1과 같은 계열).
3. 카테고리 칩이 가격 유형·운영 상태로 좁혀지지 않습니다. 기존 중분류 목록과 같은 동작입니다.
4. 같은 제품군 안에서 대분류가 달라도 중분류명이 같으면 소분류가 합쳐집니다. 품목 필터도 대분류로 거르지 않아 일관되긴 합니다.
5. 페이지 axe color-contrast 1건(3노드): STEP 1 가격 유형 칩의 "37건" 힌트(11px, opacity-70). main에도 있는 기존 문제입니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
#49는 Frontend 통과, Backend·E2E 진행 중입니다.
```
