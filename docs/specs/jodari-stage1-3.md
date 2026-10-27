# 조달이 통합 — 단계 1~3 구현 스펙 (DB 3 PR → 조회 화면 5 PR → 관리 화면 3 PR)

- 근거: `jodari-integration.md`(설계), 사용자 결정 D-1~D-11 전부 Plan 권고 수용(Main msg_0603502264e5, 2026-10-27). 착수 승인 범위 = 단계 1~3. 단계 0·4 이후는 별도 승인.
- 모드: QA 생략(Dev 게이트 + 머지 head SHA `ci:run` 녹색 → 셀프머지 → 머지마다 Main·Plan 보고). Dev 워크트리에서 :3000 실시간.
- **데이터 원칙(최우선)**: 조달이 원본(덤프·CSV·HTML 의 데이터·이메일)은 저장소·PR·커밋·테스트 fixture 에 넣지 않는다. 원본 폴더(Main 워크트리 `jodari/`)는 **읽기만**(구조 참고). fixture·시드는 합성. LAN 개발 DB 에는 **스키마만**(실데이터 미적재 — D-7). 실데이터 적재·컷오버는 단계 4(별도 승인).
- 결정 반영: D-1 조회 = USER·ADMIN, 편집 = ADMIN / D-2 관리자 메뉴 "조달 관리" 1개 + 탭 3 / D-3 표 = 백만원, KPI·툴팁 = 억·만 / D-8 조달 이력 표 + audit_logs / D-9 첫 변경차수(`v_deliveries` 현행).

## 공통 규칙
- 네임스페이스: Postgres 스키마 `procurement`(Drizzle `pgSchema`), 원래 테이블 이름 유지. TS 이름 `procurementItems`·`procurementDeliveries` 등(Prami `items` 와 구분).
- 격리: `src/server/procurement/**`·`src/features/procurement/**`·`src/app/(app)/procurement/**`·`src/app/(app)/admin/procurement/**` 밖에서 procurement 스키마 import 금지(ESLint, 원가 격리 패턴). 채팅·검색 등 기존 경로에 조달 데이터 노출 없음.
- 권한: `procurement.read`(USER·ADMIN), `procurement.write`(ADMIN). 권한 그룹 "조달".
- 금액(D-3): 표 = 백만원(소수 1자리, 단위 머리글에 표기), KPI·툴팁·요약 = 억·만(예 "12억 3,400만"). 숫자 `tabular-nums`. 공용 포맷터 `lib/procurement/format.ts`.
- 다크 테마 없음, 기존 토큰만(자사 강조색은 새 토큰 `--accent-ours` 1개 신설 — UI-4).
- 각 화면 머리에 **마지막 수집 시각**(`app_state`/`job_runs` 기준, 없으면 "수집 기록 없음").

---

## 단계 1 — DB (PR 3개)

### DB-1: 0012 procurement 스키마 (마이그레이션 번호는 머지 순서에 맞춰)
- 테이블 8개(원본 DDL 의 컬럼·타입·제약·인덱스 그대로): `items`, `item_changes`, `deliveries`, `delivery_changes`, `bid_notices`, `bid_keywords`, `job_runs`, `app_state`. CHECK 제약·UNIQUE·FK(ON DELETE SET NULL) 동일. `raw jsonb` 유지.
- 트리거 `items_before_write`(updated_at, iSIGN 세부분류 → product_group 규칙 원본과 동일) — 마이그레이션 SQL.
- 뷰 3개(`v_deliveries` 첫 변경차수 DISTINCT ON, `v_product_deliveries`, `v_item_prices`) — 마이그레이션 SQL 에 **컬럼 명시**, 코드는 `pgView(...).existing()`.
- Supabase 전용(RLS·`auth.jwt` 이력 트리거·Realtime·Vault·pg_cron) **이식하지 않음**.
- 추가형만(§6). 머지 전 LAN DB 백업 → 적용 → 보고(스키마만, 데이터 0행).
- 테스트(PGlite): 트리거 product_group 매핑 전 분기, 뷰 DISTINCT ON(같은 요구번호·물품의 여러 차수 → 첫 차수), v_product_deliveries 조인 조건(active·기타 제외), v_item_prices(0 초과 최근 단가), UNIQUE·CHECK 위반.

### DB-2: 권한 + 조회 계층 + 격리
- `permissions.ts` 에 `procurement.read`·`procurement.write`, 역할 매핑(D-1), 권한 표 화면 반영.
- `src/server/procurement/queries.ts`: 화면별 조회(서버 집계·페이지네이션) — §단계 2 각 화면이 쓸 함수. 금액·건수 집계는 SQL 에서(브라우저 전량 로드 금지).
- ESLint 격리 규칙 + 격리 테스트.
- 테스트: 권한별 접근(USER read 허용·write 거부, 비로그인 거부), 격리 규칙 위반 탐지.

### DB-3: 이관·검증 스크립트 (합성 픽스처만)
- `scripts/procurement-import.ts`: 입력 = CSV 디렉터리(BOM·bool `t/f`·배열 `{..}` 처리) 또는 PG 접속 문자열(읽기 전용). 한 트랜잭션 COPY, 순서 items → item_changes → deliveries → delivery_changes → bid_notices → bid_keywords → job_runs → app_state. 대상이 비어 있지 않으면 거부, `--replace` 만 TRUNCATE 후 재적재, 끝에 `setval`. `--dry-run`(건수만).
- `data:verify` 확장: 테이블·뷰 건수, (status, product) 분포, 연도별 금액 합계(원본 대비 일치 — 비교 기준은 실행 시 원본에서 계산, 저장소에 값 없음), 최대 id·시퀀스, 정렬 해시. 출력은 건수·일치 여부만(금액 원문 출력 금지 옵션 기본).
- 합성 CSV 픽스처(테스트 디렉터리, 가짜 업체·품목명)로 단위·통합 테스트. **실데이터 적재는 하지 않음**(단계 4).

---

## 단계 2 — 조회 화면 (PR 5개, `procurement.read`)

### UI-1: IA·셸
- 사이드바 "조달" 섹션: `/procurement`(조달 실적 현황), `/procurement/items`(등록 품목), `/procurement/bids`(입찰 공고). 관리자 메뉴 "조달 관리" `/admin/procurement`(탭: 실적 관리·품목 관리·키워드 관리 — 단계 3, D-2). 권한 없는 메뉴 숨김·직접 접근 차단.
- 공용 `ProcurementHeader`(제목 + 마지막 수집 시각 + 데이터 기준 안내). 빈 라우트·로딩·오류 상태. 페이지 상태 기억(B-1) page_key 추가.

### UI-2: 등록 품목
- DataTable + 빠른 필터 바(서버 정렬·필터·페이지네이션): 등록일자·제품·세부분류·제조사·물품식별번호·품목명·계약단가(`v_item_prices`, 백만원). 고정 필드: 제품·세부분류·제조사. 계약단가 범위는 RangeSlider(로그).
- xlsx 다운로드(`write-excel-file`, 현재 필터 결과).

### UI-3: 입찰 공고
- 제품 칩(건수), 진행 중/마감 포함 토글, 적합도순 정렬, "상만" 토글 → 빠른 필터 바/Segmented.
- 표: 적합도 배지(**글자 + 색**, 점수 숫자 노출), 공고명(링크 + 외부 링크 아이콘 — 행 클릭으로 새 창 열지 않음), 근거 ＋/－ 목록(표에 펼침), 마감 D-day 배지(임박 `--accent-orange`), 예산·추정가(억·만). 마지막 확인 시각.

### UI-4: 차트 기반
- 조달이 SVG 차트를 TSX 로 이식(새 의존성 없음), Prami 토큰: 막대+누적선 2축 콤보, 연도별 선, 범례 토글·강조, 툴팁.
- 접근성: `role="img"` + 요약 문장, "표로 보기" 전환, 키보드로 월(데이터 점) 이동·툴팁, 색 외 구분(패턴/라벨).
- `RangeSlider` 월 모드(월 단위 snap, 선택적 배경 히스토그램 — 거래량).
- 토큰 `--accent-ours`(자사 강조, 대비 확인).

### UI-5: 조달 실적 현황
- 제품 탭(ALL/WAPPLES/D.AMO/iSIGN + iSIGN 세부그룹), 조회기간(월 슬라이더 + 프리셋), KPI 카드(억·만).
- 월 실적 보고표(기준월, 제조사별 상세 모달), 월별 콤보 차트 ↔ 제조사별 실적 표(전년 대비) 강조 연동, 월 클릭 → 그 달 계약 목록(서버 페이지네이션), 연도별 매출·점유율 표 + 더보기 모달.
- 집계는 서버(`v_product_deliveries` 기준, D-9 첫 차수). URL 에 탭·기간·선택 월.

## 단계 3 — 관리 화면 (PR 3개, `procurement.write`, `/admin/procurement` 탭)
공통: 쓰기는 서버 액션 + `requirePermission('procurement.write')` + 같은 트랜잭션에서 조달 이력 표(`item_changes`/`delivery_changes`, changed_by = 사용자 이메일) **와** `audit_logs`(action `procurement.*`, actorUserId) 기록(D-8). 확인은 Prami 확인 모달(`confirm/alert` 금지). 동시 편집: 저장 시 현재 값 재검증, 이미 처리된 항목은 "이미 처리됨" 안내 후 새로고침.

### UI-6: 실적 관리
- 납품요구 표(서버 페이지네이션·빠른 필터), 편집(Drawer 또는 Modal — 전 필드, 변경 이력 최근 10건), 제외(휴지통, `excluded=true`)·복원, 휴지통 탭. audit `procurement.delivery.{update,exclude,restore}`.

### UI-7: 품목 관리
- 일일 신규 품목(status=pending) 검토 카드: 선택 추가(active)·일괄 추가·선택 제외, 행 내 제품·세부분류 편집. 등록 품목 표: 체크박스 일괄 변경, 단건 추가(source=manual), 행 편집, 휴지통(status=excluded, 삭제자 = 이력의 exclude 기록)·복원. audit `procurement.item.{add,edit,exclude,include,review}`.

### UI-8: 키워드 관리
- 제품별·"제외" 그룹 칩 편집기(추가 입력·× 삭제 확인), 마지막 확인 시각. audit `procurement.keyword.{add,delete}`.

## 수용 기준 (공통 + PR별 핵심)
- [ ] 저장소·PR·fixture 에 조달이 원본 데이터·이메일 0(리뷰 체크리스트 + 합성 fixture 만).
- [ ] DB-1: 0012 추가형, LAN 에 스키마만 적용·보고, PGlite 트리거·뷰 테스트 통과, 기존 테스트 무회귀.
- [ ] DB-2: USER 는 조회만, ADMIN 은 쓰기, 비로그인 거부. 격리 규칙 위반 0.
- [ ] DB-3: 합성 CSV → 이관 → 검증 전부 일치, 비어 있지 않은 대상 거부, `--replace`·`--dry-run`·`setval` 동작. 실데이터 적재 없음.
- [ ] UI-1: 메뉴·권한 가드·수집 시각 헤더, 페이지 상태 기억.
- [ ] UI-2~5: 서버 집계·페이지네이션(브라우저 전량 로드 없음), URL 딥링크·뒤로가기, 금액 표기 규칙(D-3), 차트 접근성(role·요약·표로 보기·키보드), 적합도 글자+색, 외부 링크는 아이콘·링크로만, 320px 가로 스크롤 없음(표는 표 안에서만 스크롤).
- [ ] UI-6~8: 모든 쓰기가 권한 검사 + 조달 이력 + audit 같은 트랜잭션, 확인 모달, 동시 편집 "이미 처리됨", 휴지통 복원.
- [ ] 각 PR: Dev 게이트(§3.1) + 머지 head SHA `ci:run` 녹색(§3.3) — QA 생략 모드. 마이그레이션 PR 은 머지 전 LAN 적용 보고.

## 순서
DB-1 → DB-2 → DB-3(DB-2 와 병렬 가능) → UI-1 → UI-2·UI-3·UI-4(병렬 가능) → UI-5(UI-4 후) → UI-6·UI-7·UI-8(UI-1·DB-2 후, 병렬 가능). 진행 중 판단이 스펙 밖이면 Plan 에 되묻기(기본안 제시).

## 진행 기록·판단
- 2026-10-27 DB-1 0012 LAN 적용(스키마만, Dev msg_cabf04b724a4). 확인 3건:
  1. `v_item_prices` 의 `dlvr_req_date DESC`(NULLS FIRST) — **원본 1:1 유지**(이관 후 조달이와 같은 결과로 대조하기 위해, 그리고 LAN 에 적용한 마이그레이션 파일은 수정 금지). 단계 4 컷오버 검증 때 날짜 없는 양수 단가 행이 실제로 있는지 확인하고, 있으면 새 마이그레이션으로 `NULLS LAST` 보정(백로그).
  2. 뷰 컬럼 명시 — 스펙대로(컬럼 추가 시 뷰도 새 마이그레이션으로 갱신).
  3. 업무 문구 COMMENT 미이식·제약 이름 기본 규칙 — 수용.
- 2026-10-27 DB-2·DB-3 판단 12건(Dev msg_9a6b4105ac4f): 2·3·4·5·6·7·9·10·11·12 수용.
  - 1 보정: 자사 판별 문자열은 하드코딩 대신 **설정 상수 목록**(`lib/procurement/our-company.ts` — 공백 제거 후 포함 비교, 한글·영문 표기 함께, 예 "펜타시큐리티"·"PENTASECURITY"). 판별 결과는 단위 테스트(합성 제조사명)로 고정.
  - 8: 월 실적 보고표 열·KPI 카드 구성은 **조달이 원본 화면 구성을 따른다**(원본 HTML 의 `MonthlyPerformanceReport`·`HeroStat` 등 — 구조·라벨만 참고, 데이터·값 반입 금지). 원본에 없는 Dev 안 항목은 넣지 않음. UI-5 에서 맞춤.
  - 10: 적재 시 트리거 비활성은 대상 테이블 소유자 권한 필요 — 이관 런북(단계 4)에 전제 조건으로 명시.
- 2026-10-27 UI-1 #79(beb0535) 머지. 확인 2건(Dev msg_44aa9a75cd5a):
  - 헤더 "데이터 기준 안내" 문구(`features/procurement/copy.ts`) — Dev 초안 수용(사실과 일치: 첫 변경차수·제외 실적 제외·0 초과 최근 단가·키워드 해당 공고). 사용자가 원하는 문구가 있으면 Main 경유로 교체(상수 한 파일).
  - **마감일 없는 공고 = 원본 규칙 따름**: 게시 후 14일(KST)까지 진행 중, 이후 마감으로 취급(DB-2 판단 4 개정 — 원본 화면 동작과 같게). D-day 는 빈칸 유지.
  - 로컬 E2E 를 부하로 못 돌리고 `ci:run` E2E 전체로 갈음 — 수용. 다만 테스트를 여러 서브에이전트가 동시에 돌려 기동 시간 초과가 나지 않게 E2E 는 한 번에 하나씩.
- 2026-10-27 사용자 확인(Main msg_11fefe24b4a6): 안내 문구 초안 그대로, 마감일 없는 공고 2주 규칙 — Plan 결정과 같음, #80(af26162)에 이미 반영(목록·칩 건수·배지 한 식, 13·14·15일째 경계 테스트).
- 2026-10-27 UI-5(#83)·UI-8 판단(Dev msg_1eb81dd83784):
  - UI-5: 1(KPI 4카드 = 원본 주석 구성, 기간 필터 뒤)·8(월 계약 목록 최신순 — Prami 표 관례)·9(강조 제조사 URL) 수용, 나머지 PR 본문 판단 수용.
  - UI-5 3 목표 점유율: 설정 상수 `OUR_TARGET_SHARE`(비어 있으면 "—") 수용. 값은 업무 목표라 Main 경유로 사용자 확인(비블로킹) — 받으면 상수만 채움.
  - UI-8: 키워드 이력 표가 없어 audit_logs 만 — 수용(D-8 은 이력 표가 있는 대상에 적용). 50자 상한·제어/보이지 않는 문자 거부·그룹이 다르면 같은 낱말 허용·일정 문구 제거 수용.
  - UI-8 **보정**: 같은 그룹 안 중복 검사는 공백 정리 후 **영문 대소문자 무시**(WAF·waf 를 같은 키워드로 거부 — 수집 키워드로서 의미가 같고 목록 혼동 방지). DB UNIQUE 는 원본 그대로, 앱 검증에서 처리 + 단위 테스트.
- 2026-10-27 UI-7 판단(Dev msg_68afe02efb16): 1(신규 검토 대상 = pending + active 이면서 reviewed=false — 원본 동작)·2·3·4·5(확인 모달은 삭제·일괄 변경·일괄 추가만, 나머지 즉시 저장 — 원본)·7·동시 편집(FOR UPDATE + updated_at·상태 재확인, 하나라도 다르면 전부 롤백 "이미 처리됨") 수용.
  - 6 **보정**: `/admin/procurement` 의 **탭·필터·정렬·페이지를 URL 에** 둔다(`?tab=items&…` — 다른 서버 표와 같은 방식, RSC 가 searchParams 로 로드). 뒤로가기·링크 공유·페이지 상태 기억(B-1 page_key) 대상. 검토 카드 300행 상한 + "외 N건" 은 수용. UI-6·UI-8 탭도 같은 규칙.
- 2026-10-27 UI-6 판단(Dev msg_75d5655e1167): 1(관리 목록 = deliveries 원본 행 전부, 미등록 표시)·2(이력 없던 시절 제외 행의 삭제 시각·삭제자 "—")·3(데이터에 없는 enum 조건 무시 — 공용 동작)·5(저장도 바뀐 필드 목록 확인 모달 — 금액 데이터 편집이라 수용)·동시 편집·중복 안내 수용.
  - 4 **보정**: 수요기관 텍스트 필터의 "같음"은 다른 표와 같은 의미(공백 정리 후 정확 일치, ASCII 대소문자 무시)로 — "포함"과 다르게 동작해야 함(공용 연산자 의미 일관). 단위 테스트.
