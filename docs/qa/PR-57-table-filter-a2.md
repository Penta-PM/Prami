# QA 기록 — PR #57 표 열 필터 A-2

- 1차 판정: **반려 / CRITICAL** (2026-10-19)
- 요청: Dev msg_6c47f2cfe47b
- 스펙: origin/Plan docs/specs/table-column-filter.md §2.3–2.5·§4·§5 A-2·§7
- 증거(로컬 scratchpad): fe57shots/, scripts/fe57*.mjs, be57logs/{summary.txt,e2e.log,fuzz/,live.json,mut/mut-summary.txt,perf-*.json,nul-main.txt}

## Dev에 보낸 반려서

```
[반려 / CRITICAL] PR #57 — 표 열 필터 A-2 (서버 3표 + A-1 QA 백로그 3건)

검증 SHA: 852ee8d (852ee8df83c46bcdd82ad4a39d8903da0e32499d, base main dd35d8c)

## CRITICAL (반드시 수정)
1. '단가 유형' 필터에서 실제 단가 유형 16종 중 쉼표가 든 5종을 고를 수 없습니다. 이 값들로는 걸러 낼 방법이 아예 없습니다.
   재현:
     1) ADMIN으로 /admin/policies(또는 /pricing)를 엽니다.
     2) ＋ 필터 → 단가 유형을 엽니다.
     3) 체크박스가 10종 + '— (없음)'뿐입니다.
   빠진 값(실데이터 사본 기준, 1,655 / 5,885행 = 28%):
     · Standby,DR 780
     · 업그레이드(H/W Standby,DR) 469
     · 업그레이드(S/W Standby,DR) 330
     · 코어증설(Standby,DR) 56
     · DBMS변경(Standby,DR) 20
   URL 우회도 안 됩니다: ?f.priceType.in=Standby%2CDR는 조용히 무시되고 전체 행이 나옵니다.
   기대: 스펙 §7 Q3 (B) — '가격 단가 유형은 DB distinct 값으로 다중 선택(enum) … 16종을 손으로 치지 않게.'
   실제:
     - src/features/pricing/column-filters.ts priceTypeOptions가 `!value.includes(',')`로 쉼표 값을 뺍니다.
     - 이유는 in의 URL 값이 쉼표 구분이라서입니다(§2.1 형식).
     - 코드 주석에만 있고 PR 본문에는 이 제약이 없습니다.
   비고: URL 코덱(§2.1 '쉼표 구분')과 Q3 B(DB 값 전부)가 충돌합니다. 방식 선택은 Dev/Plan 몫입니다.
     · 예: in 값 이스케이프(%2C 이중 인코딩·백슬래시), 옵션을 인덱스/키로 인코딩, 반복 키 f.priceType.in=a&f.priceType.in=b
     · 감사 '행위'는 Q1 A로 '쉼표 금지'가 명시돼 있어 해당 없음
     · 고치면 회귀 표·E2E에 'Standby,DR' 선택 → SQL과 같은 행(780)을 고정해 주세요.
   증거: fe57shots/probe-pricetype.png, fe57probe.mjs(priceTypeOpts), be57logs/live.json

## 확인은 했으나 통과
Frontend/라이브 (실제 Chromium, 실데이터 사본 qa57fe: 가격 5,885·원가 491(USD 4 추가)·감사 63 + 시드 123, main :3250 대조):
  - 필터 결과 = 독립 SQL(전 페이지 행 id·순서·DOM 행 수·'총 N건'):
    · 가격 28/28 케이스(최대 118쪽), 원가 12/12, 감사 25/25
    · 분류·q·family·기간·시작일·탭·정렬 조합 포함, 열 필터가 없으면 main과 동일
  - 단가 유형(쉼표 외): '— (없음)' = 빈 값 11행, 목록 밖 값 무시
  - 판매가 범위: 통화 0·2개면 잠김('통화를 먼저 선택하세요'), 1개면 동작
  - 가격 변동: 필터 전 전체 기준 SQL과 일치(609/128/78)
  - USER /pricing:
    · 필터 7개, 원가 관련 없음, SQL 14/14 일치
    · f.costRatio·f.unitCost는 200이고 행이 줄지 않음(개수 차이로 새지 않음)
    · 원가 전용 금액 0
    · 관리 페이지 307, 감사 CSV 403
  - 원가:
    · 탭 + q + 기간 + 열 필터 + 정렬 + page 상태에서 '필터 초기화' → ?family=WAPPLES만 남음(탭 유지)
    · 탭 전환 시 열 필터 유지
  - 감사:
    · 옛 폼 제거
    · KST 경계: 23:59:59.999 포함, 다음 날 00:00 제외
    · 옛 ?action=X 동작, 다중은 action=a,b. 20개는 적용, 21개는 무시
    · UI로 받은 CSV = 표, 필터 5세트 행 단위 일치(10/48/6/123/0)
    · 주입 파라미터·잘못된 날짜·따옴표 actor → 200, 해당 조건만 버림
    · 행위 43개 목록만 스크롤(max-h 240). 320/768/1024/1440에서 적용 버튼이 화면 안에 있음
  - 필터 초기화(열 필터 + q + major + sort + page, 가격 family 해제·원가 탭 유지)
  - 빈 상태 2종 문구, 빈 상태 [필터 초기화] 뒤 '＋ 필터' 포커스
  - A-1 백로그 3건 해소:
    · 비활성 '열 초기화' 클릭 시 팝오버 닫힘
    · 포커스가 body·트리거에 있어도 Esc로 닫힘. 견적 모달 안 첫 Esc는 팝오버만, 두 번째 Esc가 모달
    · '비활성'·'거부' Pill 5.04:1, inactive 필터 상태 axe 0
  - 키보드만(감사): Tab ×17 → Enter → 결과 → Space ×2 → 적용 → 칩 × → '＋ 필터', 포커스 링 2px
  - page 제거·sort/dir 맨 뒤
  - axe 새 위반 0, 4폭 페이지 넘침 0, 콘솔·하이드레이션 0
  - main 회귀:
    · 11개 URL에서 표 텍스트 동일(정렬·2·3쪽 포함)
    · 픽셀 11표 중 8표 0, 감사 3표는 헤더 점·red-600 Pill만 다름
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2624 passed (lines 96.36)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 852ee8d, 새 DB qa57be_e2e, 101/101 passed, 0 flaky, 10.5분
  - table-filter-server.spec --repeat-each=3: 9/9
  - SQL 안전:
    · 모든 사용자 값은 바인딩. 열 식은 고정 맵에서만, 연산자는 >=/<= 고정
    · has = strpos(lower(x collate "C")): %·_·\는 문자 그대로(실측)
  - 퍼징(실데이터 2만 세트 + 엣지 DB 1만 세트, 주입·와일드카드·유니코드·__proto__·f.costRatio·한도 초과 포함):
    · 문법 오류 0, NUL 외 오류 0
    · 서버 ↔ A-1 클라이언트 술어: 실데이터 불일치 0. 비ASCII 대소문자는 양쪽 모두 ASCII만(스펙대로)
  - count = rows = CSV:
    · 감사 export 7,000세트 일치, CSV 라우트 670세트 불일치 0, 라이브 11건
    · CSV href에 필터 포함
  - 성능(실데이터 5.9k): 필터 72~78ms(가격 변동), main 대비 무변화
  - 변이 32건 중 26건 검출:
    · SQL 직접 삽입 3종·ILIKE·COLLATE·count/rows WHERE 불일치·CSV 필터 무시
    · 화이트리스트·costRatio·혼합 통화·없음·옛 action·KST·to 경계
    · pointerdown·document Esc·Pill red-500·초기화 포커스
  - 기존 테스트 변경: 단언 약화 0(감사 폼 테스트는 칩/URL 단언으로 교체, AC-02는 옛 URL로 별칭 확인)

## 백로그 (비블로킹)
1. 텍스트 필터에 NUL(%00)이 들어가면 HTTP 500입니다(Postgres invalid byte sequence 0x00).
   - main에도 ?q=a%00b, 감사 actor·action, 원가 q로 이미 있는 문제입니다.
   - 이 PR로 진입점이 늘었습니다. 입력 단계에서 \0 제거·거부를 권합니다.
2. 단가 유형이 U+3000·U+2003·U+FEFF로만 된 값이면 클라이언트는 '없음'으로, 서버는 값으로 분류합니다(#32·#46 백로그와 같은 계열, 실데이터 영향 0).
3. 유효숫자 약 16자리를 넘는 숫자 경계는 서버(정확한 numeric)와 클라이언트(float)가 다르게 비교합니다.
   - 예: f.priceChange.gte=5.00000000000000001 → 1468 vs 1500
4. 53k 행에서 가격 변동 필터가 1.07~1.24s입니다(count도 윈도를 조인). 실데이터 규모에서는 영향이 없습니다(#55 성능 백로그와 같은 원인).
5. 감사 별칭 키가 중복되면(action=a&action=b) 화면은 첫 값, CSV는 마지막 값을 씁니다(main 동일, UI로는 생기지 않음).
6. f.priceType.in=ASP,NOPE는 조건 전체를 버립니다(§2.1-4 '그 조건만 버림'에 부합).
7. 서버 표는 적용마다 history 1개가 추가됩니다(router.push, 기존 정렬·페이지와 동일). 스펙의 replace 규칙은 클라이언트 표 대상입니다.
8. 테스트 공백: has/eq 빈 값 가드(변이 c3), 모달 안 document Esc 전파 차단(c3·j3, jsdom 한계), 목록 스크롤(CSS, E2E만)
9. getCostRowsAction은 f.*를 무시합니다(UI 미사용).
10. 노란 '오류' Pill 1.89:1(main 동일), reduced-motion에서 팝오버 opacity 페이드(A-1 원형)

재검증 요청 시 이 메시지에 회신해 주세요.
재검증 범위:
- 단가 유형 코덱 변경분: 단위·퍼징·라이브 SQL 대조
- E2E 전체 1회(새 SHA)
```

## 2차 (재검증 0993dd1) — **통과 / 셀프머지 승인** (2026-10-19)

- 요청: Dev msg_d8b2c978d688 (Plan 결정 msg_fc29f653f863, §2.2 개정)
- 증거: be57blogs/{summary.txt,e2e.log,codec*.json,live-*.log,fuzz/,mut/,shots/}

```
[통과 / 셀프머지 승인] PR #57 — 표 열 필터 A-2 재검증 (in 값 백슬래시 이스케이프 코덱)

검증 SHA: 0993dd1 (0993dd1c81d59ebdaaaffb2909cdba1a2b5525ef, base main dd35d8c — 852ee8d 위 커밋 1개, rebase 없음)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · ci:run 녹색

## 1차 CRITICAL 해소 확인 (단가 유형 쉼표 값 5종)
라이브(next dev :3200, 실데이터 prami pg_dump 사본 5,885행)에서 16종을 하나씩 UI로 선택했습니다.
  · URL·칩·새로고침 후 건수·전 페이지 행 순서를 SQL(price_type = ANY)과 대조했습니다.
  · ADMIN(/admin/policies)·USER(/pricing) 각 27/27 일치합니다.
  - 쉼표 5종:
    · DBMS변경(Standby,DR) 20 / 업그레이드(H/W Standby,DR) 469 / 코어증설(Standby,DR) 56 / Standby,DR 780 / 업그레이드(S/W Standby,DR) 330
    · 5종 동시 선택 1,655(34쪽)
    · 조합 Standby,DR+ASP+없음 1,165 / DBMS변경(Standby,DR)+DBMS변경 165
  - 나머지 11종 + '— (없음)' 11도 전부 일치합니다.
  - URL은 %5C%2C이고, 칩은 '단가 유형: Standby,DR'(원래 값)입니다.
  - 수동 URL:
    · 이스케이프 단일 780·혼합 441
    · 옛 ASP,Cloud 726
    · 옛 Standby%2CDR은 목록 밖 두 값이라 조건을 버림(5,885)
    · 형식 오류(끝 \·\\,·Stand\by)는 그 조건만 버림(다른 조건 유지), 모두 200

## 검증한 내용 (실제 실행 기준)
  - lint·typecheck·format PASS
  - unit coverage 2632 passed
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 0993dd1, 새 DB qa57b_e2e, 102/102 passed, 0 flaky, 5.9분(Standby,DR 신규 테스트 포함)
  - 반복: table-filter-server.spec --repeat-each=3 12/12, table-filter.spec(A-1 클라이언트 표, 같은 코덱) 4/4
  - 코덱 퍼징(2 시드 × 6만 목록 = 12만, ,·\·\,·\\·\x·끝 \·유니코드·%·빈 문자열·100/101자·20/21개·중복):
    · 실패 0. decode(encode(x)) == x이고, §2.2로 따로 작성한 참조 디코더와 일치
    · URLSearchParams 왕복(%5C%2C·%5C%5C)
    · 형식 오류 2.6만 건은 그 조건만 버림
    · 한도는 언이스케이프 후에 셈(100자·20개 경계 약 9천 건이 이 차이로만 통과)
    · 백슬래시 없는 입력: 852ee8d 파서·직렬화와 12만 건 전부 동일(기존 URL 호환)
    · Object.prototype 무변화
    · 감사 action 별칭은 쉼표를 구분자로 유지(스펙대로)
  - 서버 ↔ 클라이언트 술어(쉼표·백슬래시 값 주입 생성기, 70% 이스케이프·20% 원형·10% 형식 오류):
    · 실데이터 2만 세트 불일치 0
    · 엣지 1만 세트(C,\,D·Back\slash·tail\·,·\ 값 시드)에서 쉼표·백슬래시 관련 불일치 0
    · 엣지 불일치 60건은 1차 백로그 2(U+3000 계열 공백 단가 유형)뿐
  - 1차 퍼징 재실행: 새 오류·불일치 없음. 알려진 백로그(공백 계열·NUL 500·16자리 초과)만 남음
  - 변이 9/9 검출:
    · 언이스케이프 안 함, 쉼표만 이스케이프
    · 길이·개수 한도를 언이스케이프 전에 셈, 형식 오류 시 전체 버림
    · priceTypeOptions 쉼표 제외 복원, \x 관대 처리
    · 직렬화가 쉼표 값을 건너뜀, 옛 split(',')
  - 1차에서 통과한 나머지(필터 SQL = 독립 SQL, 권한·원가 비노출, 감사 CSV, 필터 초기화 범위, A-1 백로그 3건)는 diff 범위 밖이라 그대로 유효합니다.

## 수용 기준 대조 (A-2)
- [x] 서버 3표 열 필터: 바인딩 SQL, count·rows·CSV 같은 WHERE, 화이트리스트 밖 키 무시 — 1차 퍼징 3만·라이브, 이번 재퍼징
- [x] 단가 유형 DB distinct 다중 선택 16종(Q3 B), 목록 밖 무시 — 16종 라이브 SQL 일치
- [x] in 코덱(§2.2 개정): 이스케이프·형식 오류는 그 조건만·언이스케이프 후 한도·기존 URL 호환·칩 원래 값 — 퍼징 12만
- [x] 필터 초기화 범위, 빈 상태 2종, 감사 폼 흡수·옛 ?action 호환, A-1 백로그 3건 — 1차 라이브
- [x] Dev 게이트 기록 + QA E2E 전체 1회(102/102) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. 1차 백로그 1~10은 그대로입니다. 특히 NUL(%00) 500(main 공통)과 53k 행 가격 변동 필터 1s 초과를 먼저 보기를 권합니다.
2. 5종 조합 34쪽에서 dev 하이드레이션 경고가 1회 나왔습니다. 퍼징과 같은 머신 부하 중이었고, 같은 URL 3회·다른 쪽 2회 재로드에서 0회라 재현되지 않았습니다.
3. 감사 action 값 안에 쉼표가 있으면 분리됩니다(스펙 의도, 실데이터 0행).

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```

## 머지 후 SHA 대조 (QA 확인)
- main 5b3fd6d(squash, #57) 의 diff 가 검증 SHA 0993dd1(dd35d8c 기준)와 동일.
