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

# 3) 로컬 PostgreSQL 16 기동 (Neon 프로젝트 준비 전 개발·QA용)
docker compose up -d

# 4) 마이그레이션 (drizzle/*.sql) · 시드 (픽스처 ADMIN·USER, 공지 샘플, 감사 로그 user.seed)
pnpm db:migrate
pnpm seed

# 5) 개발 서버
pnpm dev            # http://localhost:3000
```

`/` 에 접속하면 디자인 셸(왼쪽 사이드바 + 상단 헤더)과 자리표시자 홈 화면이 렌더됩니다.
사이드바 하단의 `« 접기` 버튼으로 접기/펼치기를 확인할 수 있습니다.

Docker 컨테이너의 사용자/비밀번호/DB 이름은 `prami`/`prami`/`prami` 이 기본값이며 `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` 셸 변수로 바꿀 수 있습니다(포트를 바꾸면
`DATABASE_URL` 도 맞춥니다). 컨테이너 이름은 프로젝트명에서 파생된 `prami-postgres-1` 이고, 데이터는 볼륨
`prami-postgres-data` 에 남으며 `docker compose down -v` 로 삭제합니다.

`DB_DRIVER` 를 비우면 PGlite(인프로세스, `memory://`)로 동작하므로 Docker 없이도 단위 테스트가 가능합니다.
`pnpm db:migrate` 와 `pnpm seed` 는 `.env.local` → `.env` 순서로 환경을 읽습니다(Next 와 동일 규칙).

### 스크립트

| 명령                    | 설명                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | 개발 서버                                                                                                        |
| `pnpm build`            | 프로덕션 빌드 (빌드 전 `src/env.ts` 가 환경변수를 검증)                                                          |
| `pnpm start`            | 빌드 결과 실행                                                                                                   |
| `pnpm lint`             | ESLint                                                                                                           |
| `pnpm typecheck`        | `tsc --noEmit`                                                                                                   |
| `pnpm format:check`     | Prettier 검사 (`pnpm format` 으로 수정)                                                                          |
| `pnpm test`             | Vitest 단위 테스트 (DB 테스트는 PGlite `memory://`)                                                              |
| `pnpm test:coverage`    | 단위 테스트 + 커버리지(임계 80%)                                                                                 |
| `pnpm test:integration` | 실제 Postgres 통합 테스트 — `DB_DRIVER=pg` + `DATABASE_URL` 필요, 없으면 스킵                                    |
| `pnpm db:generate`      | 스키마(`src/db/schema`) 변경을 `drizzle/*.sql` 마이그레이션으로 생성                                             |
| `pnpm db:migrate`       | `DB_DRIVER` 에 맞는 드라이버로 마이그레이션 적용                                                                 |
| `pnpm seed`             | 픽스처 ADMIN·USER, 공지 샘플, 감사 로그 `user.seed` 기록 (재실행 안전)                                           |
| `pnpm test:e2e`         | Playwright E2E — 먼저 `pnpm build`, 최초 1회 `pnpm exec playwright install chromium`. 포트 3100(`E2E_PORT`) 사용 |
| `pnpm check`            | lint + typecheck + format:check + test 일괄                                                                      |

CI(`.github/workflows/ci.yml`)는 PR 마다 lint → typecheck → format → 단위(커버리지, PGlite) → build,
이어서 PostgreSQL 16 service container 에서 `db:migrate` → `seed` → 통합 테스트, 그리고 Playwright 스모크를
실행합니다.

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
├─ app/
│  ├─ layout.tsx           # <html lang="ko">, Pretendard 폰트, 메타데이터
│  ├─ globals.css          # Tailwind + 디자인 토큰 (아래 참고)
│  └─ (app)/               # 앱 셸 그룹: layout.tsx(사이드바+헤더) + 라우트별 자리표시자 page.tsx
├─ features/shell/         # Sidebar, Header, nav.ts(메뉴 정의), icons.tsx, pages.ts
├─ components/ui/          # 버튼·필·세그먼트·카드·입력·모달·드로어·테이블 프리미티브
└─ lib/cn.ts               # 클래스 병합 유틸
tests/
├─ unit/                   # Vitest (토큰 대조, 셸, UI, env, nav, db/: PGlite 스키마 스냅샷·시드)
├─ integration/            # 실제 Postgres (DB_DRIVER=pg) 스키마·시드 검증
├─ e2e/                    # Playwright 스모크 (셸 렌더·접기·토큰 런타임 값)
├─ fixtures/               # 디자인 토큰 원본 4파일, sales_prices 20컬럼 스냅샷
└─ helpers/  setup.ts
```

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
