# 조달이(Jodari) → Prami 통합 — 1단계 분석·마이그레이션 설계

- 요구사항: Main msg_1f1397468443 (2026-10-27). 사용자: "조달이를 Prami 와 합친다 — 분석·설계부터, 어떻게 마이그레이션할지". **이번은 설계만, 구현 착수 금지**(승인 후 별도 배정).
- 검토: UI/UX·기능/기술 서브에이전트(조달이 자료 읽기 전용 + Prami main 2383b8e). 두 결과 일치·보완.
- **자료 보호**: 원자료(덤프·CSV·HTML)는 Main 워크트리 미추적 폴더에만 있고 저장소에 넣지 않는다. 이 문서에는 구조·건수만 적고 금액 합계·개인정보·개인 계정명은 적지 않는다.

## 1. 현황 요약

### 1.1 조달이
- 나라장터 조달 데이터 대시보드. 화면 = React 단일 HTML(브라우저가 Supabase 를 직접 읽고 씀), 공개 GitHub Pages 호스팅, Supabase Auth Google(회사 도메인), **권한 구분 없음**(로그인하면 모두 편집).
- 수집기 = 개인 GitHub 비공개 저장소의 Python(`daily`·`bids`), GitHub Actions 를 Supabase pg_cron+pg_net 이 `workflow_dispatch` 로 깨움(평일 daily 3회, bids 08:30~18:30 매시간). **수집 방식은 공식 OpenAPI 가 아니라 사이트 화면 조회(스크래핑)** — 공식 API 는 "승인 시 전환" 예정. **수집기 소스는 전달 자료에 없음.**
- 일일 보고 메일 = 개인 Gmail SMTP.

### 1.2 데이터 모델 (일반 PG12+, 확장 불필요 — pg_cron/pg_net 은 예약 실행용)
| 테이블 | 키·특징 | 건수 |
|---|---|---|
| `items` | bigserial PK, UNIQUE(item_id, product), product(WAPPLES/D.AMO/iSIGN/기타), product_group(트리거 계산), status(pending/active/excluded — 소프트 삭제), source(auto/manual) | 232 |
| `item_changes` | items 이력(before/after jsonb, changed_by 이메일/'system') | 34 |
| `deliveries` | 납품요구, UNIQUE(dlvr_req_no, item_id, change_ord), 금액 bigint, raw jsonb, excluded(소프트 삭제), **updated_at 없음** | 15,857 |
| `delivery_changes` | 바뀐 칸만 before/after | 0 |
| `bid_notices` | bid_no PK, products[], fit_grade(상/중/하)·fit_score·fit_reasons[], raw jsonb | 108 |
| `bid_keywords` | UNIQUE(product, keyword), product 에 '제외' 포함, 실제 삭제 | 56 |
| `job_runs`·`app_state` | 수집 실행 기록·마지막 확인 시각 | 25·2 |
- 뷰(security_invoker): `v_deliveries`(제외 안 된 납품요구를 (요구번호, 물품) 당 **첫 변경차수** 1행), `v_product_deliveries`(활성·기타 아닌 등록 물품과 조인 — 매출·점유율 기준), `v_item_prices`(물품별 최근 계약단가).
- 트리거: `items_before_write`(updated_at, iSIGN 세부분류 → product_group: SSO / WA(PKI) / PASS / OS 로그온 / 기타). 이력 트리거 2개는 Supabase `auth.jwt()` 의존.
- Supabase 전용: RLS(회사 도메인 = staff), Realtime(items·bid_notices·bid_keywords), Vault(디스패치 토큰). Storage·auth.users 직접 참조 없음.

### 1.3 화면 (메뉴 평면 6개, URL 없이 state 로 전환 — 딥링크·뒤로가기 없음, 데이터 전량 로드 후 브라우저 집계)
| 화면 | 구성 |
|---|---|
| 조달 실적 현황 | 제품 탭(ALL/WAPPLES/D.AMO/iSIGN, iSIGN 세부그룹), 월 실적 보고표, 조회기간(월 입력·프리셋·거래량 배경 슬라이더), 월별 막대+누적선 2축 차트·범례·툴팁, 제조사별 실적 표(전년 대비), 월 클릭 → 계약 목록, 연도별 매출·점유율 표·모달 |
| 등록 품목 | 열 필터 표, CSV 다운로드 |
| 입찰 공고 | 제품 칩, 진행 중/마감, 적합도순·"상"만, 적합도 배지·근거(＋/－)·마감 D-day·예산 |
| 조달 실적 현황 관리 | 납품요구 수정 모달(변경 이력)·휴지통 |
| 등록 품목 관리 | 일일 신규 품목 검토(일괄 추가/삭제, 행 내 편집), 등록 품목 편집, 휴지통, Realtime 반영 |
| 입찰 공고 키워드 관리 | 제품별·제외 단어 칩 편집기 |
- 차트는 라이브러리 없이 손으로 그린 SVG(접근성 속성 0). 팔레트는 Prami 와 같은 계열(이식 비용 낮음).

## 2. 통합 설계 (Plan 권고)

### 2.1 데이터 모델
1. **별도 Postgres 스키마 `procurement`**(Drizzle `pgSchema`), 원래 테이블 이름 유지 → Prami `public.items` 와 충돌 없음, 수집기 SQL 무수정(전용 DB 계정 `ALTER ROLE … SET search_path = procurement`), drizzle-kit `CREATE SCHEMA` 생성, PGlite 지원. TS 이름은 `procurementItems` 등. 앱 코드는 스키마를 붙인 이름으로 쿼리.
2. 마이그레이션 **0012_procurement_schema**(머지 순서에 따라 번호 재조정) — 추가형만(LAN 규칙 §6 충족, main 코드 무영향).
3. 뷰 3개는 마이그레이션 SQL 에 컬럼 명시로 작성, 코드는 `pgView(...).existing()` 타입 선언(선례 있음).
4. `items_before_write` 트리거는 **DB 트리거로 유지**(외부 수집기가 넣는 행도 같은 product_group 계산). 이력 트리거 2개는 이식하지 않고 **서버 액션이 같은 트랜잭션에서 history 행 + `audit_logs`** 기록.
5. raw jsonb 그대로 보존(약 8.5MB), 원래 id 보존 + `setval`(이력 외래키).
6. 격리: `server/procurement` 만 procurement 스키마를 import 하도록 ESLint 규칙(원가 격리 패턴) — 권고.

### 2.2 Prami 데이터와의 연결 (가능성·가치만 — 이번 범위 아님)
- 제품군 WAPPLES·D.AMO·iSIGN 이 Prami 제품군과 같음 → **조달 계약단가 vs Prami 판매가 비교**가 가장 큰 가치. 단 Prami 는 `iSIGN PKI` 를 별도 제품군, 조달이는 PKI 를 iSIGN 하위 'WA' 그룹 → 매핑 규칙 필요. 물품식별번호 ↔ Prami 품목코드 직접 연결 근거는 없음(매핑표 필요할 가능성 — 원가 매핑과 유사).
- 그 밖: HOME 제품 카드 → 해당 제품 조달 실적, 입찰 공고 예산 → 계산기, 일일 신규 품목·적합도 '상' 공고 → Prami 알림(#31).

### 2.3 인증·권한
- 새 권한 키 `procurement.read`·`procurement.write`(키워드 관리를 떼려면 `procurement.keywords.write`), 권한 그룹 "조달".
- 조회 화면 = `procurement.read`, 관리 화면 = `procurement.write`. 기본 역할 매핑은 §4 D-1.
- Supabase 직접 호출 → 조회는 RSC, 쓰기는 서버 액션 + `requirePermission` + 감사. Realtime → 저장 후 `revalidatePath`/새로고침 + 동시 검토 충돌 처리("이미 처리됨").
- 로그인은 Prami Auth 로 대체(허용 도메인 기본값 동일). 이력 이메일 → `users.email` 로 사용자 id 매핑, 없으면 라벨.
- audit action: `procurement.item.{add,edit,exclude,include,review}`, `procurement.delivery.{update,exclude,restore}`, `procurement.keyword.{add,delete}`.

### 2.4 화면 (Next.js 재구현)
- IA: 사이드바 **"조달" 섹션** — `/procurement`(실적 현황), `/procurement/items`(등록 품목), `/procurement/bids`(입찰 공고). 관리는 §4 D-2.
- 기간·탭·필터는 URL 쿼리(딥링크·뒤로가기·페이지 상태 기억 B-1 대상).
- 공용 컴포넌트로 덮음: DataTable + 빠른 필터 바(서버 페이지네이션), RangeSlider(월 단위 snap·거래량 배경 확장), Segmented/Pill, Modal/Drawer, Checkbox, InfoHint, xlsx 다운로드(write-excel-file). `alert/confirm` → Prami 확인 모달·알림.
- 신규: 차트 3종(막대+누적선 2축 콤보, 연도별 선, 범례 토글) — **조달이 SVG 를 TSX 로 이식 + Prami 토큰**(새 의존성 0) 권고, KPI 카드, 키워드 칩 편집기, 휴지통 패턴.
- 집계는 서버에서(뷰/쿼리), 표는 서버 페이지네이션. 화면 머리에 **마지막 수집 시각** 표시.
- 접근성: 차트 `role="img"`+요약 문장+"표로 보기", 키보드 월 이동, 적합도는 글자+색, 점수 노출. 입찰 공고는 공고명 링크·외부 링크 아이콘으로만 새 창(행 클릭 이동 제거).
- 시각: 조달이 전용 글자 확대는 버리고 Prami 타입 스케일, 하드코딩 색은 토큰으로. 다크 테마 없음. 모바일은 KPI·공고 목록만 보장(데스크톱 우선).
- 미사용 컴포넌트(메뉴에 없는 2개)는 이관하지 않음.

### 2.5 수집기
- 선택지: (a) 외부 GitHub Actions 가 Prami DB 에 직접 씀 — LAN DB 는 닿지 않음(포트 개방 반대), 운영 DB(Neon 등)면 TLS + 전용 계정(procurement 스키마 DML 만) / (b) Prami 에 이식(TS 재작성, Vercel Cron 1일 1회·함수 시간 제한) / (c) 별도 워커(Python 그대로, 회사 서버 cron 또는 사내 self-hosted 러너 — LAN·운영 DB 모두 가능, 해외 IP 차단 회피).
- **권고: 단기 (c), 운영 DB 확정 후 (a) 허용, (b)는 공식 API 승인 후 별도 프로젝트.** 예약은 워커 cron(pg_cron 대체). 비밀값은 워커/Secrets 에만(Prami env 아님).
- **선행 조건: 수집기 소스 확보(저장소를 회사 조직으로 이전)** — upsert 가 화면 편집값·제외 표시를 덮어쓰는지, 적합도 계산이 무엇을 읽는지 코드로 확인해야 함.
- 일일 메일: 개인 Gmail → 공용 메일함 SMTP(수집기에 유지), 장기적으로 Prami 알림 검토.

### 2.6 데이터 이관
1. 0012 로 빈 스키마 생성(덤프를 그대로 실행 금지 — public 에 Drizzle 이 모르는 테이블이 생김).
2. 이관 스크립트(`scripts/procurement-import.ts`): 원본 = Supabase 읽기 전용 접속 또는 CSV(BOM·bool `t/f`·배열 `{..}` 처리), 한 트랜잭션 COPY(items → item_changes → deliveries → delivery_changes → bid_notices → bid_keywords → job_runs → app_state), 비어 있지 않으면 거부(`--replace` 만 TRUNCATE 후 재적재), 끝에 `setval`. 실데이터는 저장소에 넣지 않고 테스트는 합성 픽스처 + PGlite.
3. 검증(`data:verify` 확장): 테이블·뷰 건수, (status, product) 분포, 연도별 금액 합계 원본과 정확히 일치, 최대 id·시퀀스, 테이블별 정렬 해시.
4. 컷오버(편집 동결 + 재적재 — 데이터가 작아 이중 쓰기 불필요, `deliveries` 에 updated_at 이 없어 증분 동기화 불가): 편집 중단 공지 → 수집기 하루 작업 직후 새로 추출해 `--replace` 적재·검증 → 수집기 DB 주소 전환 → 다음 bids·daily 결과 검증 → Supabase 쓰기 권한 회수(읽기 전용).
5. 롤백: 전환 후 일정 기간 Supabase 유지, 문제 시 수집기 주소 원복 + 조달이 화면 재개(그 사이 Prami 편집은 소량 수동 반영). procurement 스키마는 DROP 하지 않고 TRUNCATE(추가형 규칙).

### 2.7 운영·배포
- LAN DB: §6 규칙(추가형·백업·보고·적용 후 파일 불변).
- **전환 시점 의존성**: 조달이는 지금 운영 중 — Prami 운영 배포(Vercel/Neon 체크리스트 미완) 전에 넘기면 LAN 밖 사용자가 서비스를 잃음. Prami 는 TEST MODE 로그인이라 실매출·경쟁사 데이터를 LAN 에 넣으면 노출 위험.
- 계정 이전 과제: 개인 GitHub(수집기 비공개·화면 공개 저장소), Supabase 프로젝트, GCP OAuth 프로젝트, 개인 Gmail 앱 비밀번호, Vault 토큰 → 회사 소유로. 전환 후 토큰 폐기·DB 비밀번호 교체·Pages 보관.

## 3. 리스크
1. 수집기 소스 부재 — upsert 동작·덮어쓰기 위험 미확인.
2. 스크래핑 방식 — 사이트 개편·해외 IP 차단·이용약관 리스크.
3. LAN DB 에 외부 수집기가 닿지 않음.
4. TEST MODE 인증 상태에서 실데이터 노출 위험.
5. Prami `items`·`notices` 와 이름·의미 혼동(코드·검색).
6. Realtime 상실 — 동시 검토 충돌.
7. 변경차수 집계 기준 미정(일부 행).
8. 서버리스 Cron·함수 시간 제한(이식 시).
9. 새 역할 추가 시 enum ADD VALUE 트랜잭션 제약.
10. 과도기 Supabase 무료 플랜 7일 비활성 일시정지.

## 4. 사용자 결정 필요 항목 (Plan 권고)
| # | 항목 | 선택지 | 권고 |
|---|---|---|---|
| D-1 | 조달 관리 권한 | A 조회 USER·ADMIN, 편집 ADMIN / B 모두 편집(현행) / C 조달 담당 역할 신설 | A (실제 담당자가 ADMIN 이 아니면 C) |
| D-2 | 관리 메뉴 위치 | A 관리자 메뉴에 3개 / B 관리자 메뉴 "조달 관리" 1개 + 탭 3개 | B |
| D-3 | 금액 표기 | A 억·만 통일 / B 표는 백만원, KPI·툴팁은 억·만 | B(기존 보고 양식) |
| D-4 | 수집기 소스·계정 | A 저장소를 회사 조직으로 이전 / B 소스만 전달 | A(선행 조건) |
| D-5 | 수집기 실행 위치 | A 사내 서버 cron/self-hosted 러너 / B GitHub 클라우드 러너 → 운영 DB / C Prami 에 이식 | A |
| D-6 | 전환 시점 | A Prami 운영 배포 + Google 로그인 이후 / B LAN 선행 | A |
| D-7 | LAN 개발 DB 실데이터 | A 넣지 않음(합성만, 화면 개발은 합성 데이터) / B 적재 | A(D-6 전까지) |
| D-8 | 이력 저장 | A history 테이블 + audit_logs 둘 다 / B audit_logs 일원화 | A |
| D-9 | 변경차수 집계 기준 | A 첫 차수(현행) / B 최종 차수 | 업무 판단 — 현행 A 유지 권고 |
| D-10 | 일일 메일 | A 공용 메일함으로 유지 / B Prami 알림으로 대체 | A(장기 B 검토) |
| D-11 | 수집 방식 | A 당분간 화면 조회 유지 / B 공식 OpenAPI 승인 추진 후 전환 | A + B 병행 추진 |
- Plan 이 정하는 것(참고): 별도 스키마 `procurement`, 차트 = SVG 이식(새 의존성 없음), 자사 강조색 토큰 신설, 입찰 적합도 근거는 표에 펼침, 서버 집계·페이지네이션, 마지막 수집 시각 표시.

## 5. 로드맵 (PR 단위 — 결정 후 확정)
| 단계 | PR | 내용 | 비고 |
|---|---|---|---|
| 0 | — | 수집기 소스 확보·계정 이전(D-4), Prami 운영 배포·Google 로그인(D-6) | 사용자·운영 과제 |
| 1 | DB-1 | 0012 procurement 스키마(8 테이블·인덱스·product_group 트리거·뷰 3) + Drizzle + PGlite 테스트 | 추가형, LAN 적용 |
| 1 | DB-2 | 권한 키·권한 표 + `server/procurement` 조회 + ESLint 격리 | |
| 1 | DB-3 | 이관·검증 스크립트(합성 픽스처) — 실데이터 적재는 별도 승인 | |
| 2 | UI-1 | IA·셸(조달 섹션·관리 메뉴·권한 가드·수집 시각 헤더) | |
| 2 | UI-2·3 | 등록 품목(조회), 입찰 공고(조회) | |
| 2 | UI-4·5 | 차트 기반(SVG 이식·접근성·표로 보기·RangeSlider 월 모드) → 조달 실적 현황 | |
| 3 | UI-6·7·8 | 실적 관리(수정·이력·휴지통), 품목 관리(일일 검토·일괄·휴지통), 키워드 관리 — history + audit | |
| 4 | OPS | 수집기 계정·예약·전환·롤백 런북, 컷오버 실행 | D-6 이후 |
| 5 | LINK | 가격 정책·계산기·HOME 연결, 알림 연동 | 선택 |
| 6 | API | 수집기 공식 API 기반 이식 | 선택(D-11) |
- 단계 1·2 는 합성 데이터로 D-6 전에도 진행 가능(LAN 에 실데이터 없음). 구현 착수는 사용자 승인 후.

## 6. 사용자 결정 (2026-10-27, Main msg_0603502264e5)
- D-1~D-11 전부 Plan 권고 수용. 단계 1~3 착수 승인(합성 데이터만, QA 생략 모드). 구현 스펙: `jodari-stage1-3.md`. 단계 0(수집기 소스·계정 이전 — 사용자 측, Main 안내)·4 이후는 별도 승인.
