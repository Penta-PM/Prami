# Prami

펜타시큐리티 제품군(WAPPLES, D.AMO, iSIGN, iSIGN PKI, Cloudbric)의 판매단가·원가·파츠·견적 정보를
통합 관리하는 사내 플랫폼입니다. ERP 엑셀 내보내기를 임포트해 DB로 관리하고, 가격정책 조회·
견적/순매출 계산기·공지·감사 로그를 제공합니다.

- 개발 스펙: `PRAMI-001` (Plan 워크스페이스 `docs/specs/PRAMI-001-price-policy-platform.md`, r2)
- 운영 파이프라인 문서: [AGENTS.md](AGENTS.md), [docs/pipeline](docs/pipeline/README.md)

## 기술 스택

| 계층       | 선택                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| 프레임워크 | Next.js 16 (App Router, React 19, Server Components)                                       |
| 언어       | TypeScript 5                                                                               |
| 스타일     | Tailwind CSS 4 — 디자인 토큰을 `@theme` 로 등록                                            |
| DB         | PostgreSQL 16 — `DB_DRIVER` 로 분기: `pg`(로컬 Docker) · `pglite`(테스트) · `neon`(Vercel) |
| 인증       | Auth.js v5 Google 로그인 (도메인 제한, `ADMIN_EMAILS` 부트스트랩)                          |
| 검증       | zod (환경변수 `src/env.ts`, 이후 Server Action 입력)                                       |
| 테스트     | Vitest + Testing Library (단위), Playwright (E2E)                                          |
| 품질       | ESLint 9 (flat config, `eslint-config-next`), Prettier 3                                   |
| 패키지     | pnpm 10 (`packageManager` 필드로 고정)                                                     |

PR-0 은 앱 셸·디자인 시스템·품질 도구·환경변수 스키마, PR-1 은 Drizzle 스키마·마이그레이션·시드와
드라이버 분기(`src/db`)를 담습니다. 인증은 PR-2, 임포트 파이프라인은 PR-3 에서 추가됩니다.

## 로컬 실행

### 사전 요구

- Node.js 22.12 이상 (개발은 24 기준)
- pnpm 10 — `corepack enable` 또는 `npm i -g pnpm@10`
- Docker Desktop (로컬 PostgreSQL 16 컨테이너용)

### 절차

```bash
# 1) 의존성 설치
pnpm install

# 2) 환경변수 — 키 목록을 복사한 뒤 로컬 DB 값을 채웁니다
cp .env.example .env.local
#    .env.local:  DB_DRIVER=pg
#                 DATABASE_URL=postgres://prami:prami@localhost:5432/prami
#                 AUTH_SECRET=<openssl rand -base64 32 결과>
#                 AUTH_TEST_MODE=true              # Google OAuth 클라이언트 없이 로컬 로그인 (T-0, docs/deploy/local.md)
#                 AUTH_TEST_PASSWORD=<임의 문자열>
#                 ADMIN_EMAILS=<실제 관리자 회사 이메일>   # fixture 이메일을 쓰지 않는다 (PRAMI-003 U-7)

# 3) 로컬 PostgreSQL 16 기동 (Neon 프로젝트 준비 전 개발·QA용)
docker compose up -d

# 4) 마이그레이션 (drizzle/*.sql) → 실데이터 적재 (원본 엑셀 3종, 정식 임포트 경로 — 순서 고정) → 검증
pnpm db:migrate
pnpm import:source "<_inputs>/PRAMI-001/병합_가격_raw.xlsx" --kind sales
pnpm import:source "<_inputs>/PRAMI-003/WAPPLES 품목.xlsx" … "<_inputs>/PRAMI-003/cloudbric 품목.xlsx" --kind items
pnpm import:source "<_inputs>/PRAMI-001/원자재코드 정보_260825.xlsx" --kind costs
pnpm data:verify --fresh --target local
#    seed(픽스처 계정·공지 샘플)는 로컬 :3000 DB 에 쓰지 않는다 — PRAMI_ALLOW_SEED=1 인 CI·E2E·격리 DB 에서만 실행된다

# 5) 개발 서버
pnpm dev            # http://localhost:3000 (127.0.0.1 에만 바인드)
```

> **테스트 모드는 로컬 전용입니다.** `pnpm dev` 는 기본으로 `127.0.0.1` 에만 바인드합니다. LAN 에 열어야 한다면
> `pnpm dev -H 0.0.0.0` 처럼 **명시적으로** 지정하고, 그 전에 반드시 `AUTH_TEST_MODE` 를 끄세요 — 켜져 있으면 공용
> `AUTH_TEST_PASSWORD` 로 누구나 ADMIN 픽스처 계정에 로그인할 수 있습니다. 2차 방어로 테스트 로그인은 `AUTH_TEST_ALLOWED_HOSTS`
> (기본 `localhost,127.0.0.1`) 밖의 Host 에서 거부되고 감사 `auth.denied_test_mode` 가 남으며, `VERCEL_ENV` 가 있는 환경에서는
> 기동 자체가 거부됩니다. 테스트 모드가 켜지면 로그인 화면·헤더에 **TEST MODE** 배너가 보입니다.

모든 화면은 로그인이 필요합니다(비로그인은 `/login` 으로 이동). `AUTH_TEST_MODE=true` 이면 로그인 화면의
**테스트 모드** 폼에서 픽스처 계정(`fixture-admin@pentasecurity.com` = ADMIN, `fixture-user@pentasecurity.com`
= USER)과 `AUTH_TEST_PASSWORD` 로 로그인합니다. 비밀번호는 각자의 `.env.local` 에만 두고 PR·이슈·문서에 적지 않습니다. Google 로그인 버튼은 `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
(리다이렉트 URI `{origin}/api/auth/callback/google`)을 설정해야 활성화됩니다. `AUTH_TEST_MODE` 는 production
에서 기동이 거부됩니다.

로그인 후 `/` 에서 디자인 셸(왼쪽 사이드바 + 상단 헤더)이 렌더되고, ADMIN 에게만 관리자 메뉴가 보입니다.
사이드바 하단의 `« 접기` 버튼으로 접기/펼치기를 확인할 수 있습니다.

Docker 컨테이너의 사용자/비밀번호/DB 이름은 `prami`/`prami`/`prami` 이 기본값이며 `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` 셸 변수로 바꿀 수 있습니다(포트를 바꾸면
`DATABASE_URL` 도 맞춥니다). compose 프로젝트명이 `name: prami` 로 고정되어 있어 어느 체크아웃에서 실행해도 같은
컨테이너 `prami-postgres-1` 과 볼륨 `prami_prami-postgres-data` 를 공유합니다. 체크아웃별로 분리하려면
`COMPOSE_PROJECT_NAME=prami-qa POSTGRES_PORT=5433 docker compose up -d` 처럼 프로젝트명과 포트를 함께 바꿉니다.
데이터는 `docker compose down -v` 로 삭제합니다.

`DB_DRIVER` 를 비우면 PGlite(인프로세스, `memory://`)로 동작하므로 Docker 없이도 단위 테스트가 가능합니다.
앱을 PGlite 로 띄우면 첫 연결 때 마이그레이션이 자동 적용됩니다(인메모리는 재시작 시 초기화).
`pnpm db:migrate` 와 `pnpm seed` 는 `.env.local` → `.env` 순서로 환경을 읽습니다(Next 와 동일 규칙).
로컬 :3000 을 실데이터·실 Google 로그인으로 전환하는 절차(테스트 모드 제거 T-0~T-2, DB 재구성·복원)는 [`docs/deploy/local.md`](docs/deploy/local.md),
운영·preview 환경변수와 기동 검사는 [`docs/deploy/vercel.md`](docs/deploy/vercel.md) 에 있습니다.

### 스크립트

| 명령                      | 설명                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                | 개발 서버 (`127.0.0.1` 바인드, LAN 노출은 `-H 0.0.0.0` 명시 + 테스트 모드 끄기)                                                                                                                                                  |
| `pnpm check:secrets`      | 추적 파일 비밀값 검사 (원격 DB 자격 증명·`AUTH_SECRET=` 값·OAuth 시크릿·LLM 벤더 키·KEK 값, CI `secret scan` 잡, AC-96·211)                                                                                                      |
| `pnpm build`              | 프로덕션 빌드 (빌드 전 `src/env.ts` 가 환경변수를 검증)                                                                                                                                                                          |
| `pnpm start`              | 빌드 결과 실행                                                                                                                                                                                                                   |
| `pnpm lint`               | ESLint                                                                                                                                                                                                                           |
| `pnpm typecheck`          | `tsc --noEmit`                                                                                                                                                                                                                   |
| `pnpm format:check`       | Prettier 검사 (`pnpm format` 으로 수정)                                                                                                                                                                                          |
| `pnpm test`               | Vitest 단위 테스트 (DB 테스트는 PGlite `memory://`)                                                                                                                                                                              |
| `pnpm test:coverage`      | 단위 테스트 + 커버리지(임계 80%)                                                                                                                                                                                                 |
| `pnpm test:integration`   | 실제 Postgres 통합 테스트 — `DB_DRIVER=pg` + `DATABASE_URL` 필요, 없으면 스킵                                                                                                                                                    |
| `pnpm db:generate`        | 스키마(`src/db/schema`) 변경을 `drizzle/*.sql` 마이그레이션으로 생성                                                                                                                                                             |
| `pnpm db:migrate`         | `DB_DRIVER` 에 맞는 드라이버로 마이그레이션 적용                                                                                                                                                                                 |
| `pnpm seed`               | 픽스처 ADMIN·USER, 공지 샘플, 감사 로그 `user.seed` 기록 (재실행 안전). **CI·E2E·격리 DB 전용** — 로컬 호스트 + `PRAMI_ALLOW_SEED=1` 일 때만, 원격 DB 는 거부                                                                    |
| `pnpm test:e2e`           | Playwright E2E — `next dev`(포트 3100, `.next-e2e`) + Postgres `prami_e2e` DB(`E2E_DATABASE_URL`)에 자동 migrate·seed. 최초 1회 `pnpm exec playwright install chromium`                                                          |
| `pnpm fixtures`           | 임포트 테스트 픽스처 생성 — 원본 `병합_가격_raw.xlsx`(`SOURCE_XLSX`)에서 200행 + 오류·품목조회 합성 파일 → `tests/fixtures/imports/`, 품목조회 5파일(`PRAMI_INPUTS_DIR`) 축소본 → `tests/fixtures/items/`(개인정보 컬럼 가짜 값) |
| `pnpm import:source`      | 엑셀을 업로드·적용 경로 그대로 반영(정식 임포트 경로). **파일 경로 필수**. `--kind sales`(기본) · `costs` · `items`(품목조회 1~5개 → 현재 판매단가 재사용 적용, `--merge merge\|replace`). 원격 DB 는 `--target-host` 필수       |
| `pnpm data:verify`        | 데이터 자동 검증(읽기 전용) — `--fresh`(클린 설치 직후), `--stage schema`, `--target local\|preview\|production`(+`--target-host`). docs/deploy/local.md                                                                         |
| `pnpm parts:draft`        | 파츠 매핑 초안 xlsx(`--out <저장소 밖>`, DB 변경 0) — 관리자 검수 후 `/admin/parts` 엑셀 등록                                                                                                                                    |
| `pnpm check:trace`        | `DB_DRIVER=neon pnpm build` 뒤 함수 트레이스(proxy·instrumentation 포함)에 PGlite 가 없는지 검사                                                                                                                                 |
| `pnpm credentials:rewrap` | LLM 키 DEK 를 활성 KEK 로 다시 감싼다 (KEK 회전, PRAMI-002). `--yes` 없으면 대상·건수만 출력                                                                                                                                     |
| `pnpm check`              | lint + typecheck + format:check + test 일괄                                                                                                                                                                                      |

CI(`.github/workflows/ci.yml`)는 PR 마다 lint → typecheck → format → 단위(커버리지, PGlite) → build,
이어서 PostgreSQL 16 service container 에서 `db:migrate` → `seed` → 통합 테스트, 그리고 같은 service container 와
`AUTH_TEST_MODE` 로 Playwright E2E(로그인·권한·감사 로그)를 실행합니다.

E2E 를 로컬에서 처음 돌릴 때는 E2E 전용 DB 를 한 번 만듭니다:
`docker exec prami-postgres-1 psql -U prami -d prami -c "create database prami_e2e"`.

## 디렉터리

```
docker-compose.yml         # 로컬 PostgreSQL 16 (Neon 준비 전 개발·QA용)
drizzle.config.ts  drizzle/ # drizzle-kit 설정, 마이그레이션 SQL + 스냅샷 (세 드라이버 공통)
.env.example               # §4.9.2 키 전부, 값 없음
scripts/                   # migrate.ts, seed.ts (tsx 로 실행, .env.local 로드)
src/
├─ env.ts                  # zod 환경변수 검증 (next.config.ts 가 import → 빌드 시 실패 조기 감지)
├─ db/
│  ├─ index.ts             # createDb()/getDb(): DB_DRIVER 분기 (neon-http · node-postgres · pglite)
│  ├─ tx.ts                # withTransaction(): pg/pglite 네이티브, neon 은 WebSocket 클라이언트
│  ├─ migrate.ts  seed.ts  # 마이그레이션 적용, 픽스처 시드 (한 트랜잭션)
│  └─ schema/              # 테이블별 Drizzle 스키마 (§4.3), enums, relations
├─ proxy.ts                # 1차 방어 (Next 16 의 middleware): 비로그인 → /login, /admin/* 비ADMIN → / + 감사 denied
├─ instrumentation.ts      # 기동 시 ADMIN_EMAILS·ADMIN 0명 경고
├─ app/
│  ├─ layout.tsx           # <html lang="ko">, Pretendard 폰트, 메타데이터
│  ├─ globals.css          # Tailwind + 디자인 토큰 (아래 참고)
│  ├─ login/               # Google 로그인 버튼 + (AUTH_TEST_MODE) 테스트 계정 로그인
│  ├─ api/auth/[...nextauth], api/audit/export.csv
│  └─ (app)/               # 앱 셸 그룹 (세션 필수): admin/users(사용자·권한), admin/audit(감사 로그), 나머지 자리표시자
├─ server/                 # 서버 전용
│  ├─ auth/                # auth.ts(Auth.js v5, JWT), callbacks.ts(로그인 판정), rbac.ts(requirePermission), providers.ts
│  ├─ audit/               # log.ts(writeAudit), queries.ts(필터·페이지)
│  ├─ users/               # 사용자 사전 등록·수정·비활성화 (감사 로그 동반)
│  └─ imports/             # 엑셀 임포트: parse-xlsx·header-detect·schemas(sales 20/items/costs 12/parts), upload, apply-policy(§4.4 1~6단계), series, invariants
├─ features/               # shell/, auth/, users/, audit/ 화면 컴포넌트 + Server Actions
├─ components/ui/          # 버튼·필·세그먼트·카드·입력·선택·모달·드로어·테이블 프리미티브
└─ lib/                    # cn.ts, result.ts(봉투), constants/permissions.ts(PERMISSIONS), audit-format.ts
tests/
├─ unit/                   # Vitest (토큰 대조, 셸, UI, env, nav, db/: PGlite 스키마 스냅샷·시드)
├─ integration/            # 실제 Postgres (DB_DRIVER=pg) 스키마·시드 검증
├─ e2e/                    # Playwright: 로그인·권한·감사 로그(auth.spec) + 셸 스모크
├─ fixtures/               # 디자인 토큰 원본 4파일, sales_prices 20컬럼 스냅샷
└─ helpers/  setup.ts
```

## 가격정책 임포트 (PR-3)

`/admin/policies`(ADMIN) 상단에서 **판매단가 파일**·**품목상태 파일**을 각각 `신규 업로드` 또는 `기존 파일 재사용`으로
고른 뒤 `가격정책 적용`을 누릅니다.

1. 업로드(`POST /api/imports/{sales|items|costs|parts}`, multipart `file`, .xlsx ≤ 10MB — 품목조회는 `files[]` 1~5개·합계 25MB): 시트 선택(판매단가는 `RAW` 우선)
   → 상위 5행에서 헤더 감지(이름 정확 일치, 누락이면 배치 `failed`) → 행별 검증 → 스테이징(`stg_*`) + 미리보기 20행 + 오류 목록.
   같은 파일 재업로드는 409 와 기존 배치 안내.
2. 적용(`applyPolicyAction`): 한 트랜잭션에서 품목 마스터 반영 → 수동 행 충돌 처리(ERP 우선) → ERP 행 전량 교체(적용시작일
   그대로) → 누락 품번 stub → 계열(품번·단가유형·단가구분·화폐·거래처코드)별 최신·종료일·운영상태 재계산(폐기 = 미사용)
   → 불변식 I-1·I-2·행수 검증 → run·배치 상태·감사 `policy.apply`. 실패하면 전부 되돌리고 run 은 `failed`.
3. 오류가 1건이라도 있는 배치는 적용할 수 없습니다. 품목조회 파일은 선택 사항입니다(없으면 모든 품번이 `미확인` stub).

QA 는 `IMPORT_FAULT_INJECTION=<단계>`(개발·테스트 전용)로 적용 중 실패를 재현할 수 있습니다.

### 품목 마스터 (PRAMI-003 PR-1)

- 원본: ERP 품목조회 5파일(제품군별, 1행 제목 `품목조회` + 2행 헤더 **39컬럼**). 헤더 상수·처리 구분(정규 9 · raw 27 · 제외 3)은
  `src/server/imports/schemas/items.ts`. 개인정보 컬럼(등록자·최종수정자·관리자)은 **값을 읽지도 저장하지도 않는다**(raw·스테이징·로그·감사·
  오류 리포트 모두). 비고는 raw 에 두고 가격 상세 드로어에서 **ADMIN 에게만** 보인다. 정의에 없는 헤더는 경고 `extra_header` 만 내고 저장하지 않는다.
- 업로드: 관리 화면 "품목상태 파일"에서 1~5개 동시 선택(또는 병합 파일 1개) → 배치 1개(`import_batches.source_files`).
  검증 코드: 오류 `duplicate_item_code`(파일 간 포함)·`duplicate_file`·`missing_required_header`·행 오류 `unknown_major`·`unmapped_status`,
  경고 `mixed_major_in_file`·`missing_families`·`sales_items_not_covered`·`missing_header`·`extra_header`, 정보 `excluded_columns_dropped`.
- 대분류 정규화 `ERP_MAJOR_TO_FAMILY`(`src/lib/constants/product-family.ts`): `D'Amo`→`D.AMO`, `iSIGN+`→`iSIGN`, `iSIGN+ PKI`→`iSIGN PKI`.
  화면·필터·챗봇은 정규화 값만 쓰고 원문은 상세 드로어 "ERP 대분류". 정합 I-10(판매단가 제품군 = 품목 대분류) 위반은 적용 통계 경고.
- 품목 상태 = 임시·폐기·사용(그 외 행 오류). 종류 = 규칙표 K0~K7 + 품번 예외표(`src/lib/constants/item-kind-rules.ts`) — **품명으로 판정하지 않는다**.
  저장값(`items.item_kind`·`item_kind_rule`)만 읽고, 마스터에 없는(stub) 품번은 `기타`(계산기 STEP3).
- 제품군 병합: 이번 배치에 직전 품목의 제품군이 빠지면 "누락 제품군 유지(병합, 기본)" / "전량 교체" 중 선택해야 적용된다(전량 교체는 사라질 품번 수 확인 모달).
  적용 통계에 `itemMerge`·I-10·파츠 매핑 종류 불일치(매핑은 유지)·예외표 미존재 품번이 남는다.
- 분류 드롭다운 = 판매단가가 있는 품목의 실데이터 대·중·소분류(홈 카드 진입 시 그 카드의 대분류만).
- 로컬 반영: `pnpm db:migrate`(0005) → `pnpm import:source --kind items "<WAPPLES 품목.xlsx>" … "<cloudbric 품목.xlsx>"`.

## 가격정책 조회 · 관리 (PR-4)

- `/pricing`(USER 이상)·`/admin/policies`(ADMIN)는 같은 컬럼 정의(`src/features/pricing/columns.ts`)와 필터를 쓴다.
  관리 표는 조회 표에 `적용시작일`·`운영 연도`·`관리`가 더해진다.
- 필터(대/중/소분류, `적용시작일 기준`/`적용기간 기준`, 연도 칩, 기간, 검색, 페이지)는 모두 URL 검색 파라미터라
  새로고침·공유해도 유지된다. 품목조회 파일이 적용되기 전에는 대분류 = 제품군이고 중/소분류는 비활성이다.
  옵션은 판매단가가 있는 품목의 분류만(PRAMI-003 §4.2.5).
- 행을 누르면 원본 20컬럼과 같은 계열 이력을 보여 주는 `행 상세` 드로어가 열린다.
- 관리 화면의 `+ 등록`·수정·복사·삭제는 변경 사유가 필수이며, 저장 시 해당 계열만 다시 계산하고 불변식(I-1·I-2)을
  확인한 뒤 감사 로그(`price_policy.create|update|delete`, 원본 20컬럼 스냅샷)를 남긴다. 폐기 품목은 운영중이 될 수 없다.

## 원가 관리 (PR-5)

- `/admin/costs`(ADMIN 전용) 상단에서 **원가 파일**(구매단가등록 12컬럼)을 `신규 업로드`/`기존 파일 재사용`으로 고른 뒤
  `원가 적용`을 누릅니다. 적용(`applyCostImportAction`)은 한 트랜잭션에서 수동 행 충돌 처리(ERP 우선) → ERP 행 전량 교체 →
  계열(자재번호·단가유형·단가구분·화폐)별 최신·종료일·운영상태 재계산 → 불변식 I-2·행수 검증 → 감사 `cost_import.apply`.
- 제품군은 자재번호 접두로 파생합니다(`W1`=WAPPLES, `W2`=D.AMO, `W4`=iSIGN, 그 외 `기타`; `src/lib/constants/material-family.ts`).
  라인업 칩은 매핑이 확정될 때까지 숨깁니다.
- 원본 엑셀은 1:1 로 보존합니다(스펙 r4 §4.3.4·§4.4.7). 같은 계열·같은 적용시작일 행이 여러 개여도 모두 적재하고
  원본 행 번호를 `source_row` 에 기록하며, 최신 판정·종료일은 `적용시작일 desc, source_row desc`(원본 뒤 행 우선)로
  결정적입니다. 같은 날짜의 앞 행은 종료일 = 자기 시작일(기간 0일, 표에는 `없음`). 미리보기·적용 결과에
  `같은 날짜 중복` 그룹 전체와 값이 다른 그룹을 따로 보여 주지만 오류가 아니라 적용은 됩니다.
  수동 등록(`+ 등록`)·수정은 같은 계열·같은 적용시작일(ERP 행 포함)을 앱 검사로 막습니다(`fieldErrors.effectiveFrom`).
- 필터(제품군 탭, `적용시작일 기준`/`적용기간 기준`, 연도 칩, 기간, 검색, 페이지)는 가격정책 화면과 같은 컴포넌트·SQL 조건을
  쓰며 모두 URL 검색 파라미터입니다. 수정·삭제는 변경 사유가 필수이고 감사 로그(`material_cost.update|delete`, 12컬럼 스냅샷)를 남깁니다.
- 원가 격리: `src/server/cost/**` 는 `src/features/costs/**`·`src/app/(app)/admin/costs/**` 에서만 import 할 수 있고(ESLint
  `no-restricted-imports` + 동적 `import()`/`require`/템플릿 리터럴 import·`db.query.materialCosts`·raw SQL `material_costs` 를 막는 `no-restricted-syntax`, 소스 스캔 테스트), 모든 서버 함수는 첫 인자로 `cost.read`/`cost.write` 권한 검사에서 발급된 `CostAccess` 토큰을 요구합니다.
  USER 는 페이지·Action 모두 §4.7.1 거부 판정(FORBIDDEN, DB 무변경, 감사 denied)을 받고 원가 값이 응답에 실리지 않습니다.
  순매출 계산기 서버 함수(`calculateNetSalesAction`)는 `cost.read` 가 없으면 원가 입력을 무시하고 `costLocked: true` 를 돌려줍니다.
- 로컬 데이터: `pnpm import:source --kind costs` (원본 487행 → 자재 157·계열 157·최신 157).

## 홈 · 공지 · 검색 (PR-9)

- `/`(HOME): 제품 바로가기 카드 4개(WAPPLES, D.AMO, iSIGN, Cloudbric → `/pricing?major=…`, `iSIGN PKI` 는 iSIGN 카드에
  포함되고 조회 화면 대분류에서만 구분 — Q-10)와 최근 공지 5건(`중요` 배지).
- `/notices`·`/notices/[id]`: 로그인 사용자 모두(`notice.read`). ADMIN 에게만 상세 하단에 수정/삭제가 보인다.
- `/admin/notices`(ADMIN, `notice.write`): `+ 공지 등록`·수정·삭제. Action `upsertNoticeAction`/`deleteNoticeAction` 은
  감사 로그 `notice.create|update|delete`(제목·작성자·중요·작성일·본문 길이 스냅샷)를 남기고, USER 호출은 §4.7.1 거부
  판정(FORBIDDEN, `notices` 무변경, 감사 denied). 삭제는 soft delete.
- 상단 검색 → `/search?q=`: 품목(판매단가의 품명·품번, 품번당 1건, 품목 마스터 상태 표시) + 공지(제목·본문) 결과 그룹.
  원가(material_costs)는 조인·반환하지 않는다.

## 파츠 관리 · 솔루션 그룹 (PR-6)

- `/admin/parts`(ADMIN, `parts.write`): 제품군 탭 → `수동 등록`(모델 선택 → 장착 가능한 파츠 다중 선택 → 저장) /
  `엑셀 등록`(`모델품번`, `파츠품번` 2컬럼 업로드 → 미리보기 → 적용). 저장은 모델 단위 **전체 교체**(기존 매핑이 있으면
  경고 후 덮어씀)이고 "등록된 매핑" 표는 모델별 한 행에 파츠 품명(품번) 목록으로 그룹화한다(사용자 요구 2, 예:
  Wapples-2700 (H2700) → N_51080). 파츠/본품 구분은 품목 마스터 적용 시 저장된 `item_kind`(규칙표 K0~K7)만 쓴다
  (PRAMI-003 — 품명 규칙 제거). 판매단가에만 있는 품번은 `items` stub(`source='stub'`, 종류 `기타`)으로 만들어 FK 를
  만족시킨다(§4.3.6). 감사 `part_mapping.save|delete`, `part_import.apply`.
- `/admin/groups`(ADMIN, `groups.write`): 제품군 탭, 카드(그룹명 + 항목 칩·현재 단가), 생성/수정 모달(제품군의 운영중
  정상판매 품목 체크), 삭제(soft). 항목 가격은 저장하지 않고 조회 시점의 최신 정상판매가를 보여 주며, 견적 계산기(PR-7)
  그룹 칩은 `listGroupChips` 를 그대로 쓴다. 감사 `solution_group.create|update|delete`.
- 홈 카드는 `/pricing?family=<제품군명>` 으로 들어가며 `PRODUCT_FAMILY_MAJORS` 로 대분류 집합으로 전개된다(iSIGN 카드 =
  iSIGN + iSIGN PKI, 대분류 드롭다운은 여전히 별도 값, 배지 "제품군: iSIGN (iSIGN PKI 포함)"). 통합 검색은 그룹당 20건 상한에 걸리면 "상위 20건" 을 표시하고 품명 NBSP 를 공백으로 정규화한다.

## 견적 · 순매출 계산기 (PR-7)

- `/calculator`(로그인 사용자 모두, `calculator.use`): `견적 계산기` / `순매출 계산기` 탭.
- 견적 계산기: 제품군 → 그룹 솔루션(PR-6 그룹 칩 → 하드웨어 선택 → 상세 제품 체크/수량 → 그룹 소계) → STEP1 단가유형
  (**DB `DISTINCT price_type`**, 배수 없음) → STEP2 대/중/소(마스터 전에는 대분류 = 제품군) → STEP3 품목(운영중 + 선택
  단가유형의 최신 행 가격)·수량 → STEP4 파츠(`part_mappings` 가 있으면 그 파츠만, 없으면 제품군 파츠 전체) → STEP5 결합형
  (마스터 `item_kind='결합형'`) → STEP6 할인율 슬라이더 ↔ 목표금액 역산 동기화 → 장바구니(`useReducer` + `sessionStorage`,
  통화가 섞이면 통화별 소계) → 견적 저장(`quotes` + 라인 가격 스냅샷, 번호 `Q-YYYY-NNNN` 연도별 시퀀스·재시도) →
  내 견적 목록(본인만, ADMIN 전체) · 담기(라인 복원) · 삭제(soft) → 견적서 출력 · 견적 공유(PR-8, 아래).
- 금액 규칙은 `src/lib/pricing/quote.ts` 순수 함수: `preDiscount = (본품 + Σ파츠 + Σ결합형) × 수량`,
  `lineTotal = floor((preDiscount − 할인) / 1000) × 1000`, 역산 `rate = clamp((1 − target/pre) × 100, 0, 100)` 소수 1자리.
- 순매출 계산기: `src/lib/pricing/margin.ts` — `정상 = 단가×수량`, `할인`, `실제 = 정상 − 할인`, `원가 = 단가×수량`(ADMIN 만),
  `순매출 = 실제 − 원가 − 기타`, `이익률 = 순매출/실제`. USER 는 원가 입력이 잠기고 서버(PR-5 `calculateNetSalesAction`)가
  응답에서 원가·이익률을 제외한다.
- 감사 `quote.save|delete`. 남의 견적 삭제는 §4.7.1 거부(FORBIDDEN, 무변경, 감사 denied).
- **서버 재가격화**(`src/server/quotes/reprice.ts`): 저장 시 클라이언트가 보낸 단가 스냅샷을 믿지 않고 품목·파츠·결합형·그룹 상세의
  단가를 DB 운영중 최신 행으로 다시 확정한다(본품 = 선택 단가유형, 파츠/결합형 = 선택 단가유형 → 정상판매 fallback, 그룹 = 정상판매).
  없는 품번·단가유형은 저장 거부(VALIDATION), 값이 다르면 서버 값으로 대체하고 응답 `adjustments` 로 알린다(화면 안내에 표시).
  품명도 DB 품명으로 대체하고(클라이언트 문구가 견적서에 실리지 않음), 그룹 상세의 없는 품번·없는 그룹 id 는 거부, 제목은 120자·`< >` 금지.

## 견적서 PDF · 공유 (PR-8)

- `GET /api/quotes/[id]/pdf`(소유자 또는 ADMIN, 타인 403 + 감사 denied, 없는 id 404): `@react-pdf/renderer` 로 A4 견적서
  (로고 · 견적 번호 · 일자 · 품목/수량/단가/할인/금액 · 합계(통화 혼합이면 통화별 소계) · "가견적 · 계약가 아님").
  응답 헤더 `x-render-ms` 와 감사 `quote.pdf`(bytes·durationMs)에 렌더 시간을 남긴다. 레이아웃은 `src/server/quotes/pdf/QuotePdf.tsx`
  한 곳(회사 양식이 오면 여기만 교체, Q-05).
- 한글 폰트: `src/assets/fonts/NotoSansKR-{Regular,Bold}-subset.ttf` — Noto Sans KR(OFL 1.1, `src/assets/fonts/OFL.txt`) 가변 폰트를
  wght 400/700 으로 정적화한 뒤 KS X 1001 완성형 2,350자 + 라틴·기호로 서브셋(각 약 480KB). 외부 요청 없음.
  Vercel 서버리스에는 `next.config.ts` `outputFileTracingIncludes` 로 폰트·로고를 함께 배포한다(배포 검증은 PR-11).
- 견적 공유: `createQuoteShare` 가 `quote_shares` 에 32바이트 난수 토큰(hex 64자)을 만료 기본 30일(1~365)로 만든다 →
  `/share/quotes/[token]` 은 로그인 없이(proxy matcher 제외) 읽기 전용 견적서를 보여 주며 원가는 문서 모델에 없다.
  폐기는 `expires_at` 을 지금으로 당긴다(스키마 변경 없음) → 만료·폐기·견적 삭제·잘못된 토큰은 모두 404.
  공유 모달 목록은 살아 있는 링크만 보이고 만료·폐기 링크는 토글로 펼친다. 감사 `quote.share.create|revoke`
  (토큰은 감사에 남기지 않음). 소유자·ADMIN 만 생성·목록·폐기(타인은 FORBIDDEN + 감사 denied).
- 화면: 견적을 저장하거나 목록에서 담으면 그 견적이 "출력·공유 대상"이 되어 `견적서 출력`(PDF 새 탭)·`견적 공유`(링크 목록·새 링크·복사·폐기 모달)가
  활성화된다. 전체보기 표의 행에도 PDF·공유가 있다.

## 가격정책 챗봇 (PR-10, 규칙 기반 MVP)

> PRAMI-002 PR-B 이후 이 규칙 엔진은 LangGraph 그래프의 `ruleAnswer` 노드(키 없음·킬스위치·벤더 일시 오류 폴백)로 그대로 쓰인다 — 아래 "챗봇 LangGraph" 절.

- 헤더 챗봇 버튼 · 우하단 플로팅 버튼 → 사이드 패널(`src/features/chat/`). 인사말·예시 질문 칩("Wapples-500 가격 알려줘", "작년보다 올랐어?",
  "견적 뽑아줘"), 제품 퀵칩(WAPPLES · D.AMO · iSIGN · Cloudbric), 모호할 때 후보 품목 칩, 견적 시작 링크. **대화는 저장하지 않는다**(감사도 없음).
- `POST /api/chat`(`chat.use` = 로그인 사용자, 비로그인 401): 본문 `{ message }` → 공백·제어 문자 정리·200자 제한(검색과 같은 규칙, ILIKE 는
  파라미터 바인딩 + 와일드카드 이스케이프) → 의도 분류(`src/server/chat/intent.ts`, 정규식·키워드, **LLM 호출 없음** Q-04b) → `sales_prices` 만 읽어
  템플릿 문장(`respond.ts`). 사용자당 분당 `RATE_LIMIT_PER_MIN`(기본 30, `src/server/rate-limit.ts`) 초과 → 429 `RATE_LIMITED` + `Retry-After`.
  200자를 넘으면 앞 200자만 쓰고 응답에 절단 안내를 붙인다.
- 의도(우선순위): ① **원가** — USER·ADMIN 모두 거부 문구, DB 접근 0회(AC-81; ADMIN 도 챗봇에서는 원가 미노출로 단순화) ② **연도 비교**(작년/전년/올랐/내렸) —
  최신 운영중 행 vs 같은 단가유형의 이전 적용시작일 행, 없으면 안내 ③ **견적 시작** — 품목이면 `/calculator?family=&item=`(계산기가 품목을 선택해 둠),
  제품군만이면 `/calculator?family=`, 없으면 제품 퀵칩 ④ **가격 조회**(품명·품번) — **토큰 경계 매칭**(r6: 부분 문자열 금지, `src/server/chat/match.ts`) 후 품번 정확 일치·후보 1개는 즉시 가격,
  2~3개는 한 문장에 각 가격 병기, 4개 이상은 품명 목록(최대 5), 0개는 도움말
  ⑤ 그 외 도움말 + 예시(AC-82). "SA-500"·"H500" 은 Wapples-500 별칭으로 넓혀 검색한다.
- 응답 봉투에 원가 키가 없다(AC-43) — `server/chat` 은 `server/cost` 를 import 하지 않으며(ESLint 차단) 원가 의도는 쿼리 자체를 만들지 않는다.

## 하드닝 · 배포 준비 (PR-11a)

배포 체크리스트·환경변수·Neon 전환 절차·§11.1 D-1~D-5 절차는 [`docs/deploy/vercel.md`](docs/deploy/vercel.md).

- **보안 헤더 (AC-91)**: `src/proxy.ts` 가 모든 문서·API 응답에 요청별 **CSP nonce** (`script-src 'self' 'nonce-…' 'strict-dynamic'`,
  인라인 스크립트는 Next 가 nonce 를 붙인 것만; `frame-ancestors 'none'`) 와 `x-request-id` 를 붙이고, `next.config.ts` 가 정적 자원까지
  `Strict-Transport-Security`·`X-Frame-Options: DENY`·`X-Content-Type-Options: nosniff`·`Referrer-Policy`·`Permissions-Policy` 를 붙인다.
  로그인·공유 페이지·PDF 포함. style 은 React `style` 속성 때문에 `'unsafe-inline'`, 개발 모드만 `'unsafe-eval'`·`ws:`.
  정적 프리렌더 HTML 에는 nonce 를 넣을 수 없어 루트 레이아웃이 `connection()` 으로 **모든 경로를 동적 렌더**한다(404 포함), 페이지 오류는
  `src/app/error.tsx`(동적). `pnpm check:prerender`(CI, 빌드 뒤)가 정적 페이지가 다시 생기면 실패한다(허용: Next 내부 `/_global-error`).
  클라이언트 zod 파싱은 `src/lib/zod-jitless.ts`(`z.config({ jitless: true })`)로 eval 탐지 없이 동작한다.
- **테스트 모드 하드닝 (AC-94 ①②③)**: 위 "로컬 실행" 상자 참고 (`src/server/auth/test-mode-guard.ts`, `src/env.ts`).
- **감사 IP (AC-93 구조)**: `TRUST_PROXY_HEADERS` = `none`(기본, 위조 가능한 헤더 미사용 → ip NULL) · `vercel`(x-vercel-forwarded-for →
  x-real-ip, **x-forwarded-for 는 쓰지 않음**) · `generic`(x-real-ip → XFF 오른쪽 끝). 이전의 "VERCEL=1 이면 자동 신뢰" 는 없앴다 —
  Vercel 에서도 명시해야 켜진다. 실제 Vercel 헤더 확인은 11b(D-5).
- **rate limit (AC-95)**: `src/server/rate-limit.ts` 단일 모듈, 키당 분당 `RATE_LIMIT_PER_MIN`(기본 30).

  | 대상                                                                          | 키     | 초과 시                              |
  | ----------------------------------------------------------------------------- | ------ | ------------------------------------ |
  | `POST /api/chat` · `POST /api/imports/*`                                      | 사용자 | 429 + `Retry-After` + `RATE_LIMITED` |
  | `/share/quotes/[token]` · `GET /api/quotes/[id]/pdf` · `/api/auth/callback/*` | IP     | 〃 (proxy)                           |
  | 테스트 Credentials 로그인                                                     | 이메일 | 로그인 화면 오류 문구                |

  **한계**: 프로세스 메모리 슬라이딩 윈도우라 Vercel 서버리스에서는 **인스턴스당 근사치**이고 콜드 스타트·재배포 때 초기화된다.
  IP 키는 감사 IP 와 같은 신뢰 헤더 정책을 쓴다: `vercel`/`generic` 모드면 신뢰 프록시가 준 IP, 기본 `none` 이면 클라이언트가 보낸
  `x-forwarded-for` 를 **무시**하고 경로 단위 공용 버킷(헤더 회전으로 우회 불가, 대신 그 경로 전체가 한도를 나눠 씀 — 운영은 `vercel` 전제).
  Next 16 proxy 는 소켓 주소를 주지 않는다. 공유 저장소(Upstash/Vercel KV) 전환은 후속.
  감사 로그는 남기지 않고 구조화 로그(`rate_limited`)만 남긴다.

- **서버리스 제약 (`maxDuration`)**:

  | 경로                                          | `maxDuration` | 로컬 측정 (Windows 11, Node 24, Docker Postgres 16)      |
  | --------------------------------------------- | ------------- | -------------------------------------------------------- |
  | `/admin/policies` Server Action (임포트 적용) | 60s           | 원본 5,885행 적용 491~541ms, 파싱 포함 CLI 전체 2.6~3.5s |
  | `/admin/costs` Server Action (원가 적용)      | 60s           | 487행 — 가격정책보다 작다                                |
  | `POST /api/imports/[kind]` (10MB 업로드·파싱) | 60s           | 위 파싱 포함                                             |
  | `GET /api/quotes/[id]/pdf`                    | 30s           | 첫 요청 95~138ms(폰트 로드), 이후 39~80ms, 약 97KB       |
  | `POST /api/chat`                              | 10s           | 규칙 기반 — DB 조회 수 회                                |

  Vercel Hobby 는 함수 상한이 더 짧을 수 있다(플랜별) — 11b 에서 실측.

- **로그**: `src/server/log.ts` — 한 줄 JSON(`level`·`event`·`time`·`requestId`…), 비밀 키 이름(password·secret·token·cookie·
  database_url…)과 값 속 URL userinfo·Bearer 토큰을 `[REDACTED]` 로 가린다. 예상 밖 오류는 `request.failed` 로 남고 응답 봉투에는
  `details.requestId` 만 준다. 외부 의존(pino)은 번들 크기 때문에 쓰지 않았다.
- **비밀값 검사 (AC-96)**: `pnpm check:secrets` (CI `secret scan` 잡). 로컬 docker 기본값(`prami:prami@localhost`)·가짜 비밀번호
  픽스처(`user:pw@…`)·빈 값·`$(…)`/`<…>` 자리표시자는 허용한다.

## 사용자 설정 · LLM 키 (PRAMI-002 PR-A)

스펙: PRAMI-002 §4.6~4.13. 챗봇 LLM 경로는 PR-B("챗봇 LangGraph" 절), 다중 벤더·스트리밍·OpenRouter OAuth 는 PR-C 절. 기본 벤더·모델은 챗봇이 자연어 질문에 쓴다.

- **화면 `/settings`** (헤더 "사용자 설정", 권한 `settings.self` = USER·ADMIN): ① 계정 연결 — 로그인 방식·이메일·마지막 로그인, Google 연결 여부는
  boolean 으로만(`google_sub` 값 미노출), "Google 계정으로 다시 로그인" ② LLM 연결 — Anthropic·OpenAI·Google Gemini·xAI (Grok) 카드(상태 필·마스킹 힌트
  `sk-ant-…WXYZ`·등록/교체/검증/삭제·콘솔 링크) ③ 챗봇 기본값 — **정상** 검증된 벤더와 그 벤더의 모델 상수(`src/server/llm/models.ts`)만, 이 키의 사용 가능 모델 밖은 "이 키로 사용 불가"(비활성), 레거시는 '레거시' 배지 ④ 요금·데이터 안내.
  저장된 키를 다시 보여주는 UI 는 없다(교체만). 입력은 password·autocomplete off, 제출 즉시 비운다.
- **본인만** (§4.7.1): 모든 조회·변경·검증은 세션 사용자 id 로만 스코프된다 — 입력에 userId 를 받지 않고(strict 스키마), ADMIN 도 남의 키를
  보거나 바꾸거나 검증할 수 없다. 관리자 화면·감사 CSV·사용자 목록에 LLM 연결 정보는 없다. 사용자 삭제 시 키·설정은 FK CASCADE 로 함께 삭제.
- **봉투 암호화** (`src/server/llm/credentials/`): 키마다 무작위 DEK(32B) 로 AES-256-GCM, DEK 는 `LLM_CREDENTIALS_KEKS` 의 활성 KEK 로 다시
  AES-256-GCM. IV 12B·태그 16B, AAD = `prami:llm-cred:v1|행id|userId|vendor|authType`(행 사이 복사 방지). 평문은 DB·로그·감사·응답·오류 어디에도
  남지 않는다 — 감사는 `settings.llm_credential.create|replace|delete|verify`·`settings.llm_default.update` 에 벤더·상태·KEK 버전만.
  삭제는 행을 즉시 지운다(백업 잔존은 `docs/deploy/vercel.md` §9).
- **스키마 접근 제한**: `user_llm_credentials` 는 `src/server/llm/credentials/**` 밖에서 import 하면 ESLint 오류(원가 규칙과 병합된 `no-restricted-imports`).
- **검증** (`src/server/llm/verify.ts`): 벤더 모델 목록 GET 1회(토큰 사용 없음), 호스트는 코드 상수·URL 에 키 없음·redirect 금지·10초 타임아웃.
  2xx 정상 / 401·Gemini 400 `API_KEY_INVALID` 키 무효 / 403 권한 부족 / 429 한도 초과 / 5xx·타임아웃 확인 실패. 저장 직후 자동 검증 1회. 저장(자동 검증)과 수동 검증을 합쳐
  사용자당 분당 `LLM_VERIFY_PER_MIN`(기본 5, AC-95 모듈 재사용). `LLM_VENDOR_MODE=fake`(로컬·테스트 전용, production/Vercel 거부)면
  `fake-valid-…`·`fake-invalid-…`·`fake-429-…` 등 접두로 결과를 흉내 낸다 — 단위·E2E 는 전부 fake, **실벤더 호출은 하지 않았다**.
- **모델 상수 · 사용 가능 모델 (r2)**: `src/server/llm/models.ts` 한 곳 — 출처 URL·확인일(2026-09-30) 주석. Anthropic 기본 `claude-opus-5-5`,
  선택지 `claude-sonnet-5-5`·`claude-haiku-4-5`(별칭, 날짜 접미사 금지), 레거시 `claude-opus-5`·`claude-sonnet-5`(선택 가능·배지), OpenAI
  `gpt-6.1-sol`(기본)·`gpt-6-luna`·`gpt-6-astra`, Gemini `gemini-3.8-flash`(기본)·`gemini-3.5-flash-lite`. 검증 때 목록 API(Anthropic `limit=1000`+`after_id`,
  Gemini `pageSize=1000`+`pageToken` 최대 5페이지) 응답 ID ∩ 상수를 `user_llm_credentials.available_models`(text[])에 저장한다(Gemini `models/` 접두·
  Anthropic 날짜 스냅샷 접미는 떼고 비교). 검증 전·목록 실패·비정상 판정이면 NULL(미확인 → 상수 전체 허용). `updateChatDefaults` 는 교집합 안의
  모델만 받는다. 저장된 기본 모델이 상수에서 사라지면 벤더 기본 모델로 대체해 보이고 안내한다. fake 접두 `fake-partial-`(기본 모델만)·
  `fake-paged-`(2페이지)·`fake-pagefail-`(다음 페이지 500)·`fake-nolist-`(목록 형식 아님).
- **KEK 회전**: `LLM_CREDENTIALS_KEKS="1:<base64 32B>,2:<base64 32B>"` + `LLM_CREDENTIALS_ACTIVE_KEK=2` 로 새 키 추가 → 새 등록은 v2,
  기존 행은 v1 로 계속 복호화 → `pnpm credentials:rewrap` 이 DEK 만 v2 로 다시 감싼다(감사 `system.kek_rewrap`) → 이후 v1 제거.
  rewrap 전에 옛 KEK 를 지우면 그 행은 "재등록 필요". KEK 가 없으면 화면은 동작하되 등록을 막고 안내한다(production 은
  `CHAT_LLM_ENABLED=true` 에 KEK 없으면 기동 거부).
- **로컬에서 보기**: `.env.local` 에 KEK 를 넣고 dev 서버를 재시작한다 (값은 저장소·문서에 적지 않는다):
  `node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"` → `LLM_CREDENTIALS_KEKS=<출력>`, `LLM_CREDENTIALS_ACTIVE_KEK=1`,
  실키 없이 화면을 보려면 `LLM_VENDOR_MODE=fake` + `fake-valid-` 로 시작하는 16자 이상 키.

## 챗봇 LangGraph (PRAMI-002 PR-B)

스펙: PRAMI-002 §4.2~4.5·§4.8.3·§4.9. `POST /api/chat` 은 `src/server/chat/graph/*` 의 LangGraph 그래프로 답한다(`maxDuration=60`, `runtime='nodejs'`).
패키지: `@langchain/langgraph` 1.4.18 · `@langchain/core` 1.2.13 · `@langchain/anthropic` 1.5.11 (+ `@anthropic-ai/sdk` 0.129.0 — 직접 호출 대안용, 현재 미사용).

```
prepare → precheck ─(원가 의도)→ costRefusal ─────────────────────────────┐
                   └→ resolveCredential ─ready→ agent ⇄ tools              │
                            │                  ├(401/403)→ setupGuide ─┐    │
                            │                  ├(429/5xx/timeout/404)→ ruleAnswer
                            ├disabled→ ruleAnswer                     │    ├→ compose → END
                            └missing/invalid/forbidden/unreadable→ setupGuide ─(폴백)→ ruleAnswer
```

- **기능(도구) 레지스트리** `src/server/chat/features/`: `price_lookup`·`price_compare_previous`·`quote_start`(읽기 전용, 권한별 노출 + 실행 시 재검사).
  새 기능은 `ChatFeature` 1개 + `registry.ts` 배열 1줄 — 그래프 코드는 그대로(AC-233). 도구 출력은 strict zod + 원가 키 검사를 통과한 값만 LLM 에 간다.
- **원가 차단**: 원가 도구 없음, 원가 의도는 LLM·DB 전에 거부(`precheck`), 출력 가드가 "원가 + 금액" 문장을 역할별 거부 문구로 교체, import 그래프 테스트.
- **키 격리**: 그래프 상태에 키·모델·DB 없음. 키는 `resolveCredential` 이 한 번 복호화해 만든 모델 팩토리 클로저 안에만 있다(요청마다 조회, 캐시 없음).
- **Anthropic 요청 제약**(`src/server/llm/models.ts` 플래그 → `vendors/anthropic-chat.ts`): `thinking` 미전송, `output_config.effort:'low'`(Haiku 제외),
  강제 `tool_choice` 없음 + 도구 `strict:true`, 서버측 폴백 `fallbacks:"default"` + `anthropic-beta: server-side-fallback-2026-07-01`(Haiku 제외),
  `stop_reason:'refusal'` 은 content 를 버리고 거부 안내. `maxTokens`=`CHAT_LLM_MAX_OUTPUT_TOKENS`, 재시도 1회, 타임아웃 `CHAT_LLM_TIMEOUT_MS`, 도구 상한 `CHAT_LLM_MAX_TOOL_CALLS`.
- **미등록·오류 안내**(`graph/messages.ts`): 패널 배너 + 첫 봇 메시지 + `/settings#llm` 링크, 결과 코드별 문구, 규칙 폴백(`CHAT_RULE_FALLBACK`), 킬스위치 `CHAT_LLM_ENABLED=false`.
  `GET /api/chat/status` 가 상태만(키·힌트 없음) 준다. 대화는 저장하지 않고, LLM 연결 상태에서만 최근 10턴을 텍스트로 보낸다.
- **fake 모드**(`LLM_VENDOR_MODE=fake`): 키 접두로 채팅 모델 동작을 고른다 — `fake-valid-`(도구 호출 → 요약), `fake-404-`·`fake-refusal-`(검증 정상, 채팅 오류),
  `fake-429-`·`fake-500-`·`fake-timeout-` 등. 실벤더 호출은 하지 않았다(키 없음).
- 다중 벤더·스트리밍·OpenRouter OAuth 는 아래 PR-C 절.

## 챗봇 다중 벤더 · 스트리밍 · OAuth (PRAMI-002 PR-C)

- **채팅 어댑터**(`src/server/llm/vendors/*-chat.ts`, 요청마다 새 인스턴스·재시도 1·타임아웃·강제 도구 선택 없음): Anthropic(`@langchain/anthropic`),
  OpenAI(`@langchain/openai` 1.6.0 — **Responses API**(`/v1/responses`, `reasoning.effort: low`, `store: false`, 도구 strict). GPT-6 계열은 Chat Completions 에서 함수 도구를 `reasoning_effort: none` 일 때만 받아 400 이 나던 문제를 PRAMI-003 에서 고침), Google Gemini(`@langchain/google-genai` 2.3.2 — 호출 signal 을 넘기려고
  스트리밍 경로 사용), OpenRouter(OpenAI 호환 API, baseURL `https://openrouter.ai/api/v1`). 모델 ID 는 `models.ts` 상수만.
- **벤더 추가** = 어댑터 1개 + `registry.ts` 1줄 + 모델 상수 — 설정 카드·검증(벤더별 상수 `host` 만 허용)·챗봇 경로가 레지스트리에서 파생한다.
- **SSE 스트리밍**(옵트인): `POST /api/chat` 에 `Accept: text/event-stream` → `event: token`(agent 텍스트) · `status`(도구 진행) ·
  `final`(가드·금지 키 검사를 거친 정본 ChatReply) · `done`. `Accept` 가 없으면 기존 JSON. 패널은 LLM 연결 상태에서 SSE 로 받아 점진 표시하고
  `final` 로 교체, 패널을 닫으면 요청을 중단(서버 → 그래프·모델 호출 signal). CSP 변경 없음(같은 출처 fetch).
  - `event: discard` `data: {"reason":"refusal"}` — 벤더 거부(stop_reason `refusal`)를 알았을 때 **이미 token 을 보냈으면** 1회.
    클라이언트는 즉시 말풍선 텍스트를 비우고 대화 히스토리에도 남기지 않는다(다음 턴에 재전송 없음). 이어서 `final` 이 거부 안내다.
    실 Anthropic 스트리밍은 stop_reason 이 텍스트 뒤 별도 청크로 오므로 거부 전에 끝난 문장은 전송될 수 있다(벤더 권고 = 부분 출력 폐기).
    그 문장도 문장 단위 출력 가드를 거친다. 완성 메시지로 온 거부는 token 0 · discard 없음.
- **OpenRouter OAuth PKCE**(플래그 `LLM_OAUTH_OPENROUTER=true`, 기본 off): 설정 카드 [OpenRouter로 연결] → `/api/settings/oauth/openrouter/start`
  (code_verifier·state 를 AUTH_SECRET 파생 키로 암호화한 HttpOnly 쿠키 10분) → OpenRouter 인증 → `callback`(state·쿠키·세션 사용자 검증 →
  state 1회 소비(`oauth_flow_states`, SHA-256 해시만, 교환 전 원자적 소비 — 재사용·동시 콜백 거부, 마이그레이션 0004) →
  코드 교환 → 키를 봉투 암호화 `auth_type='oauth_pkce'`, 감사 `settings.oauth.connect`). 삭제 = 연결 해제(`settings.oauth.disconnect`).
  플래그를 끄면 남은 OpenRouter 자격 증명은 챗봇에서 쓰지 않고(안내 문구) 검증·기본값 지정도 막지만, 카드에서 삭제(파기)는 할 수 있다.
  플래그 off 면 두 라우트 404·카드 미표시. 로컬 `callback_url` 은 `NEXT_PUBLIC_APP_URL` 출처.
- **Anthropic 서버측 폴백**은 공식 지원 모델(Opus 5.5·Sonnet 5.5·Opus 5)에만 — 레거시 Sonnet 5·Haiku 4.5 에는 `fallbacks`·베타 헤더를 보내지 않는다.
- **출력 가드**: NFKC·제로폭 문자 제거 후 판정, 한글 수사·단위 금액·비율·텍스트 속 원가 키 JSON 도 교체. LLM 텍스트에만 적용(규칙 답은 결정적 템플릿). 판정용 사본에서 이번 요청 도구 결과의 품명·품번을 가려 품명 속 "cost"·"원가" 오탐을 막는다(원문 불변). SSE 토큰도 같은 판정을 문장 단위로 거친다. 가드는 2차 방어이고 1차 방어는 모델 컨텍스트에 원가 데이터가 없다는 것이다.
- 확장 가이드: [`docs/chat/extending.md`](docs/chat/extending.md) (7단계 + 예제 기능·테스트, 문서-코드 일치 테스트).
- **실벤더 스모크**(선택, CI 미실행): `pnpm smoke:llm` — 로컬 env `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`GOOGLE_API_KEY`(또는 `GEMINI_API_KEY`)·
  `OPENROUTER_API_KEY` 가 있는 벤더만 검증 호출 + "Wapples-500 가격" 1회, 없으면 skip. 벤더·모델·성공·토큰 수만 출력(키 미출력).

## DB 스키마 · 마이그레이션

- 스키마는 `src/db/schema/*.ts` 에 테이블별로 두고 `drizzle.config.ts` 가 `schema/index.ts` 를 읽습니다.
  `pnpm db:generate` 로 `drizzle/NNNN_*.sql` 을 생성해 **커밋**합니다. 첫 마이그레이션은 확장
  `citext`(users.email) · `pg_trgm`(품명 GIN 검색) · `pgcrypto` 를 먼저 만들고, `audit_logs` 에는 UPDATE/DELETE 를
  거부하는 append-only 트리거를 둡니다.
- `sales_prices` 는 엑셀 20컬럼을 이름·순서·타입 그대로 담고(§4.3.1), 파생값(`series_key` STORED 생성 컬럼,
  `effective_to`, `is_latest_in_series`, `operation_status`)은 별도 블록입니다.
  `tests/unit/db/schema.test.ts` 가 `information_schema.columns` 를 스냅샷과 대조합니다.
- 드라이버는 `DB_DRIVER` 하나로 바뀝니다: `pg`(로컬 Docker·QA·CI 통합) · `pglite`(테스트) · `neon`(Vercel).
  쿼리 코드는 `Db` 타입만 쓰고 드라이버 전용 API 를 부르지 않습니다. `neon` 경로는 Neon 프로젝트가 준비된 뒤
  같은 테스트로 검증합니다.

## 디자인 토큰

Claude Design 프로젝트의 토큰 4파일(`colors/typography/spacing/effects.css`)을 `src/app/globals.css` 에
**변수명·값을 그대로** 이식했습니다. `tests/unit/tokens.test.ts` 가 원본 픽스처와 대조해 85개 변수 전부의
이름·값 일치를 검증하고, E2E 가 브라우저 런타임에서 `--lime-500`, `--font-body` 등의 실제 값을 확인합니다.

배치 규칙 (Main 승인):

- 대부분의 토큰은 `@theme static` 에 둡니다. Tailwind 4 가 `:root` CSS 변수로 항상 방출하며,
  `--font-*`, `--radius-*`, `--shadow-*` 는 유틸리티(`font-body`, `rounded-lg`, `shadow-elevated`)로도 쓸 수 있습니다.
- `--text-*` 17개(색상 별칭 5 + 타이포 shorthand 12)는 Tailwind 의 font-size 네임스페이스(`--text-*`)와
  충돌해 잘못된 유틸리티를 만들기 때문에 `@theme` 밖의 `:root` 에 같은 이름·값으로 둡니다.
- 색상에는 `@theme inline` 으로 `--color-*` 별칭을 추가해 `bg-lime-500`, `text-ink-900`,
  `bg-surface-sidebar` 같은 유틸리티를 제공합니다. 값의 단일 출처는 원본 이름의 변수입니다.
- 토큰을 직접 참조할 때는 `bg-(--surface-muted)`, `shadow-(--hairline-subtle)`, `[font:var(--text-h2)]` 처럼 씁니다.

디자인 목업의 "보기 권한" 역할 토글은 제거했습니다. 관리자 메뉴 노출은 PR-2(인증·RBAC)에서 세션 역할로 결정합니다.

## 환경변수

`.env.example` 에 스펙 §4.9.2 의 키가 값 없이 나열되어 있습니다. 실제 값은 `.env.local` 에만 두고
커밋하지 않습니다. `src/env.ts` 가 기동/빌드 시 zod 로 검증하며, 빈 문자열은 미설정으로 취급합니다.

| 키                                      | 규칙                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DB_DRIVER`                             | `neon` \| `pg` \| `pglite` (미설정 시 `pglite`)                                            |
| `DATABASE_URL`                          | `pg`/`neon` 이면 필수, URL 형식                                                            |
| `PGLITE_DATA_DIR`                       | PGlite 데이터 위치 (테스트 `memory://`)                                                    |
| `AUTH_SECRET`                           | 32자 이상 (PR-2 부터 필수)                                                                 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth 클라이언트                                                                    |
| `AUTH_TEST_MODE` / `AUTH_TEST_PASSWORD` | 테스트 로그인. `true` 이면 비밀번호 필수, **production·`VERCEL_ENV` 정의 환경에서는 거부** |
| `AUTH_TEST_ALLOWED_HOSTS`               | 테스트 로그인을 받을 Host (기본 `localhost,127.0.0.1`)                                     |
| `AUTH_TEST_MODE_ALLOW_REMOTE`           | `VERCEL_ENV` 환경에서 테스트 모드 예외 허용 (기본 `false`, 비공개 배포 전용)               |
| `TRUST_PROXY_HEADERS`                   | 감사 IP 신뢰 모드 `none`(기본) \| `vercel` \| `generic`                                    |
| `RATE_LIMIT_PER_MIN`                    | 엔드포인트별 분당 상한 (기본 30, 테스트 1000)                                              |
| `ALLOWED_EMAIL_DOMAINS`                 | 쉼표 구분 도메인 목록 (미설정 시 `pentasecurity.com`)                                      |
| `ADMIN_EMAILS`                          | 쉼표 구분 이메일 목록, 최초 로그인 시 ADMIN 부트스트랩                                     |
| `AUTH_AUTO_PROVISION`                   | 미등록 사용자 USER 자동 생성 (미설정 시 `true`)                                            |
