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
#                 AUTH_TEST_MODE=true              # Google OAuth 클라이언트 없이 로컬 로그인
#                 AUTH_TEST_PASSWORD=<임의 문자열>
#                 ADMIN_EMAILS=fixture-admin@pentasecurity.com

# 3) 로컬 PostgreSQL 16 기동 (Neon 프로젝트 준비 전 개발·QA용)
docker compose up -d

# 4) 마이그레이션 (drizzle/*.sql) · 시드 (픽스처 ADMIN·USER, 공지 샘플, 감사 로그 user.seed)
pnpm db:migrate
pnpm seed

# 5) 개발 서버
pnpm dev            # http://localhost:3000
```

모든 화면은 로그인이 필요합니다(비로그인은 `/login` 으로 이동). `AUTH_TEST_MODE=true` 이면 로그인 화면의
**테스트 모드** 폼에서 픽스처 계정(`fixture-admin@pentasecurity.com` = ADMIN, `fixture-user@pentasecurity.com`
= USER)과 `AUTH_TEST_PASSWORD` 로 로그인합니다. Google 로그인 버튼은 `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
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

### 스크립트

| 명령                    | 설명                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | 개발 서버                                                                                                                                                               |
| `pnpm build`            | 프로덕션 빌드 (빌드 전 `src/env.ts` 가 환경변수를 검증)                                                                                                                 |
| `pnpm start`            | 빌드 결과 실행                                                                                                                                                          |
| `pnpm lint`             | ESLint                                                                                                                                                                  |
| `pnpm typecheck`        | `tsc --noEmit`                                                                                                                                                          |
| `pnpm format:check`     | Prettier 검사 (`pnpm format` 으로 수정)                                                                                                                                 |
| `pnpm test`             | Vitest 단위 테스트 (DB 테스트는 PGlite `memory://`)                                                                                                                     |
| `pnpm test:coverage`    | 단위 테스트 + 커버리지(임계 80%)                                                                                                                                        |
| `pnpm test:integration` | 실제 Postgres 통합 테스트 — `DB_DRIVER=pg` + `DATABASE_URL` 필요, 없으면 스킵                                                                                           |
| `pnpm db:generate`      | 스키마(`src/db/schema`) 변경을 `drizzle/*.sql` 마이그레이션으로 생성                                                                                                    |
| `pnpm db:migrate`       | `DB_DRIVER` 에 맞는 드라이버로 마이그레이션 적용                                                                                                                        |
| `pnpm seed`             | 픽스처 ADMIN·USER, 공지 샘플, 감사 로그 `user.seed` 기록 (재실행 안전)                                                                                                  |
| `pnpm test:e2e`         | Playwright E2E — `next dev`(포트 3100, `.next-e2e`) + Postgres `prami_e2e` DB(`E2E_DATABASE_URL`)에 자동 migrate·seed. 최초 1회 `pnpm exec playwright install chromium` |
| `pnpm fixtures`         | 임포트 테스트 픽스처 생성 — 원본 `병합_가격_raw.xlsx`(`SOURCE_XLSX`)에서 200행 + 오류·품목조회 합성 파일 → `tests/fixtures/imports/`                                    |
| `pnpm import:source`    | 판매단가 엑셀을 업로드·적용 경로 그대로 반영(기본: 원본 `병합_가격_raw.xlsx`, 인자로 경로 지정). 로컬·QA 데이터 준비용                                                  |
| `pnpm check`            | lint + typecheck + format:check + test 일괄                                                                                                                             |

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

1. 업로드(`POST /api/imports/{sales|items|costs|parts}`, multipart `file`, .xlsx ≤ 10MB): 시트 선택(판매단가는 `RAW` 우선)
   → 상위 5행에서 헤더 감지(이름 정확 일치, 누락이면 배치 `failed`) → 행별 검증 → 스테이징(`stg_*`) + 미리보기 20행 + 오류 목록.
   같은 파일 재업로드는 409 와 기존 배치 안내.
2. 적용(`applyPolicyAction`): 한 트랜잭션에서 품목 마스터 반영 → 수동 행 충돌 처리(ERP 우선) → ERP 행 전량 교체(적용시작일
   그대로) → 누락 품번 stub → 계열(품번·단가유형·단가구분·화폐·거래처코드)별 최신·종료일·운영상태 재계산(폐기 = 미사용)
   → 불변식 I-1·I-2·행수 검증 → run·배치 상태·감사 `policy.apply`. 실패하면 전부 되돌리고 run 은 `failed`.
3. 오류가 1건이라도 있는 배치는 적용할 수 없습니다. 품목조회 파일은 선택 사항입니다(없으면 모든 품번이 `미확인` stub).

ERP 품목조회 파일 포맷은 아직 미확정입니다. 실제 파일이 오면 `src/server/imports/schemas/items.ts` 의 헤더 상수와
`src/lib/constants/item-status.ts` 의 `ITEM_STATUS_MAP` 만 고칩니다. QA 는 `IMPORT_FAULT_INJECTION=<단계>`(개발·테스트 전용)로
적용 중 실패를 재현할 수 있습니다.

## 가격정책 조회 · 관리 (PR-4)

- `/pricing`(USER 이상)·`/admin/policies`(ADMIN)는 같은 컬럼 정의(`src/features/pricing/columns.ts`)와 필터를 쓴다.
  관리 표는 조회 표에 `적용시작일`·`운영 연도`·`관리`가 더해진다.
- 필터(대/중/소분류, `적용시작일 기준`/`적용기간 기준`, 연도 칩, 기간, 검색, 페이지)는 모두 URL 검색 파라미터라
  새로고침·공유해도 유지된다. 품목조회 파일이 적용되기 전에는 대분류 = 제품군이고 중/소분류는 비활성이다.
- 행을 누르면 원본 20컬럼과 같은 계열 이력을 보여 주는 `행 상세` 드로어가 열린다.
- 관리 화면의 `+ 등록`·수정·복사·삭제는 변경 사유가 필수이며, 저장 시 해당 계열만 다시 계산하고 불변식(I-1·I-2)을
  확인한 뒤 감사 로그(`price_policy.create|update|delete`, 원본 20컬럼 스냅샷)를 남긴다. 폐기 품목은 운영중이 될 수 없다.

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

| 키                                      | 규칙                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `DB_DRIVER`                             | `neon` \| `pg` \| `pglite` (미설정 시 `pglite`)                      |
| `DATABASE_URL`                          | `pg`/`neon` 이면 필수, URL 형식                                      |
| `PGLITE_DATA_DIR`                       | PGlite 데이터 위치 (테스트 `memory://`)                              |
| `AUTH_SECRET`                           | 32자 이상 (PR-2 부터 필수)                                           |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth 클라이언트                                              |
| `AUTH_TEST_MODE` / `AUTH_TEST_PASSWORD` | 테스트 로그인. `true` 이면 비밀번호 필수, **production 에서는 거부** |
| `ALLOWED_EMAIL_DOMAINS`                 | 쉼표 구분 도메인 목록 (미설정 시 `pentasecurity.com`)                |
| `ADMIN_EMAILS`                          | 쉼표 구분 이메일 목록, 최초 로그인 시 ADMIN 부트스트랩               |
| `AUTH_AUTO_PROVISION`                   | 미등록 사용자 USER 자동 생성 (미설정 시 `true`)                      |
