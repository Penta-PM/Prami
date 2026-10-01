# Vercel 배포 설정 (PRAMI-003 PR-2)

PRAMI-001 PR-11a 문서를 PRAMI-003 스펙 §4.3(운영 하드닝)·§4.9(실데이터 운영 전환) 기준으로 전면 갱신했다.
실제 배포 수행(Vercel·Neon·Upstash·Google 클라이언트 연결, 체크리스트 C-1~C-18)은 **PR-5**, 워크플로·런북·체크리스트 문서는 **PR-4** 다.
로컬 실 Google 로그인 전환과 로컬 DB 재구성은 [`local.md`](local.md) 를 본다.

> **비밀값은 이 저장소에 두지 않는다.** 값은 Vercel 환경변수(Secret/Sensitive)와 GitHub Environment 시크릿에만 둔다.
> 이 문서는 자리표시자(`<…>`)만 쓴다. `pnpm check:secrets`(CI `secret scan`)가 원격 DB 자격 증명·`AUTH_SECRET`·Google OAuth·
> Neon 비밀번호·LLM 키·KEK·`UPSTASH_REDIS_REST_TOKEN` 값 대입을 추적 파일에서 찾으면 실패한다.

## 1. 대상 구성 (§4.3.1)

```
GitHub (main) ──CI(lint·typecheck·unit·integration·e2e·secret scan)
    ├─ PR → Vercel Preview (Git 연동, 자동) — DB: Neon `preview` 브랜치(고정 1개)
    └─ main 머지 → Actions `deploy-production`(승인 필요, PR-4): 마이그레이션 → vercel deploy --prebuilt --prod → 스모크
Vercel Production ── Neon `main`(pooled) ── Upstash Redis(rate limit)
```

- Vercel Git 연동은 **preview 전용**이다. 프로덕션 자동 배포는 끈다(마이그레이션보다 앱이 먼저 배포되는 것 방지, P-4):
  저장소 루트 `vercel.json` 의 `git.deploymentEnabled.main = false`(PR-4). production 배포는 §10 `deploy-production` 워크플로만 한다.
- 함수 본문 한도 **4.5MB**(Vercel 플랫폼): 원본 엑셀 합계 약 0.9MB(최대 `병합_가격_raw.xlsx` 0.43MB)라 관리 화면 업로드가 가능하다.
  4.5MB 를 넘으면 플랫폼이 413 을 먼저 낸다 — 그때는 `pnpm import:source --target-host <호스트>` 대안을 쓴다(§4.9.1, PR #19 I-4).

## 2. 환경변수 (§4.3.2 전 항목)

구분: **S** = Secret/Sensitive, **C** = Config, **I** = Vercel 주입(직접 설정 금지). "금지" 는 설정 자체가 기동 거부 대상이다.
이 표의 변수 집합은 `src/env.ts` 스키마·`.env.example` 과 단위 테스트(`tests/unit/env-keys.test.ts`, AC-322)로 일치를 검사한다.

<!-- env-table:start -->
| 변수 | Production | Preview | Local | 필수 | 구분 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| `APP_ENV` | — (Vercel 은 `VERCEL_ENV`) | — | — | | C | 자체 호스팅 운영에서 `NODE_ENV=production` 과 함께 `production` → 운영 기동 검사 |
| `NEXT_PUBLIC_APP_URL` | `https://<운영 도메인>` | `https://<preview 고정 호스트>` | `http://localhost:3000` | ✓ | C | production 은 https 필수(ⓕ) |
| `DB_DRIVER` | `neon` | `neon` | `pg` | ✓ | C | 운영·preview 에서 `neon` 외 거부(ⓔ) |
| `DATABASE_URL` | Neon main **pooled** | Neon preview pooled | docker | ✓ | S | 호스트에 `-pooler`. 로컬·사설 호스트 거부(ⓔ) |
| `DATABASE_URL_UNPOOLED` | — (GitHub Environment 시크릿) | — (GitHub 시크릿) | — | 마이그레이션 시 | S | `pnpm db:migrate`·`pg_dump` 전용. **Vercel 런타임에 두지 않는다** |
| `PGLITE_DATA_DIR` | — | — | 테스트만 | | C | |
| `PRAMI_ALLOW_SEED` | **금지** | **금지** | CI·격리 DB 만 `1` | | C | 로컬 :3000 금지(§4.9.3 L2) |
| `AUTH_SECRET` | 운영 전용 | preview 전용(고정 호스트·모든 preview 배포 공유) | 임의 | ✓ | S | production ≠ preview. 없으면 거부(ⓗ). preview 는 하나를 공유해야 리다이렉트 프록시가 state 를 푼다 |
| `AUTH_URL` | 운영 도메인 | **미설정**(리다이렉트 프록시 사용 — [`oauth.md`](oauth.md) §3) | — | production | C | https(ⓕ). preview 에 프록시와 함께 두면 거부(ⓚ) |
| `AUTH_REDIRECT_PROXY_URL` | **금지** | `https://<preview 고정 호스트>/api/auth` | — | preview | C | 형식 `https://…/api/auth`, production 에 있으면 거부(ⓚ) |
| `AUTH_REQUIRE_HD` | `true` | `true` | `false` | ✓ | C | Google ID 토큰 `hd` 클레임 서버 검증. production·preview 에서 `true` 아니면 거부(ⓚ) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 운영 OAuth 클라이언트 | preview 클라이언트 | 개발 클라이언트(선택) | ✓ | S | 환경별 분리. 없으면 거부(ⓗ) |
| `AUTH_TEST_MODE` / `AUTH_TEST_PASSWORD` | **금지** | **금지** | 선택 | | | 값이 false 여도 설정 자체 거부(ⓐ) |
| `AUTH_TEST_ALLOWED_HOSTS` | — | — | 선택 | | C | 테스트 모드 자체가 금지 |
| `AUTH_TEST_MODE_ALLOW_REMOTE` | **금지** | **금지** | — | | | ⓐ |
| `ALLOWED_EMAIL_DOMAINS` | `pentasecurity.com` | 동일 | 동일 | ✓ | C | |
| `ADMIN_EMAILS` | 운영 관리자 | QA 관리자 | 개발자 | ✓ | C | production 에서 비면 거부, preview 경고(ⓖ) |
| `AUTH_AUTO_PROVISION` | `true` | `true` | `true` | | C | |
| `TRUST_PROXY_HEADERS` | `vercel` | `vercel` | `none` | ✓ | C | `vercel` 외 거부(ⓓ) |
| `VERCEL` / `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA` | Vercel 주입 | Vercel 주입 | — | | I | 직접 설정 금지 |
| `APP_RELEASE` | Actions 가 커밋 SHA 주입 | (`VERCEL_GIT_COMMIT_SHA` 사용) | `dev` | | C | 헬스·로그 `release` |
| `MAINTENANCE_MODE` | 평소 미설정 | 미설정 | — | | C | `true` 면 비 ADMIN 503(런북 R-3) |
| `RATE_LIMIT_PER_MIN` | `30` | `30` | `30` | | C | |
| `RATE_LIMIT_BACKEND` | `upstash` | `upstash` 권장 | `memory` | ✓ | C | §5 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Marketplace 주입 | 동일(별 DB 권장) | — | backend=upstash | S | |
| `RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION` | 기본 미설정 | — | — | | C | memory 운영 위험 수용 예외(ⓘ) — 체크리스트 C-12 기록 필수 |
| `IMPORT_FAULT_INJECTION` | **금지** | **금지** | QA 선택 | | | ⓑ |
| `CHAT_LLM_ENABLED` | `true`(게이트 통과 후) | `true` | `true` | | C | `true` 면 KEK 필수(ⓙ) |
| `CHAT_RULE_FALLBACK` | `true` | `true` | `true` | | C | |
| `LLM_CREDENTIALS_KEKS` / `LLM_CREDENTIALS_ACTIVE_KEK` | 운영 KEK | preview KEK | 개발 KEK | 챗봇 사용 시 | S | §9 |
| `CHAT_LLM_MAX_OUTPUT_TOKENS` / `CHAT_LLM_TIMEOUT_MS` / `CHAT_LLM_MAX_TOOL_CALLS` / `CHAT_HISTORY_MAX_TURNS` | 기본 | 기본 | 기본 | | C | PRAMI-002 §4.13 |
| `LLM_VERIFY_PER_MIN` | `5` | `5` | `5` | | C | |
| `LLM_VENDOR_MODE` | **미설정(live)** | 미설정 | `live`/`fake` | | C | `fake` 거부(ⓒ) |
| `LLM_OAUTH_OPENROUTER` | `false`(켜는 기준 [`oauth.md`](oauth.md) §5) | 선택 | 선택 | | C | |
| `LANGSMITH_TRACING` / `LANGCHAIN_TRACING_V2` | **금지** | **금지** | 미설정 | | | 켜면 거부(ⓒ) |
<!-- env-table:end -->

- 오류 추적(Sentry `SENTRY_DSN` 등)은 사용자 제공(UP-11) 시 PR-4 에서 추가한다(§4.3.8). 지금은 스키마에 없다.
- GitHub Environment `production`·`preview` 시크릿: `DATABASE_URL_UNPOOLED`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`(PR-4·PR-5).

### 운영 기동 검사 (§4.3.3, `src/env-deploy.ts`)

`VERCEL_ENV=production` 또는 (`NODE_ENV=production` ∧ `APP_ENV=production`)이면 아래 위반이 하나라도 있을 때 **기동·빌드를 거부**한다
(`next.config.ts` 가 `src/env` 를 import 하므로 Vercel 빌드도 같은 규칙으로 실패). 메시지에는 변수 이름만 나온다.
`VERCEL_ENV=preview` 는 ⓕ·ⓖ 만 경고, 나머지(ⓚ 포함)는 거부다. 로컬·CI(`VERCEL_ENV` 없음, `APP_ENV` 없음)는 검사하지 않는다.
값은 대소문자·공백을 무시하고, `production`·`development` 가 아닌 `VERCEL_ENV`(오타 포함)는 preview 로 검사한다.

| # | 규칙 |
| --- | --- |
| ⓐ | `AUTH_TEST_MODE`·`AUTH_TEST_PASSWORD`·`AUTH_TEST_MODE_ALLOW_REMOTE` 설정 자체 |
| ⓑ | `IMPORT_FAULT_INJECTION` 설정 |
| ⓒ | `LLM_VENDOR_MODE=fake`, `LANGSMITH_TRACING`/`LANGCHAIN_TRACING_V2` 켜짐 |
| ⓓ | `TRUST_PROXY_HEADERS ≠ vercel` |
| ⓔ | `DB_DRIVER ≠ neon`, `DATABASE_URL` 없음, 호스트가 로컬·사설 주소, 연결 호스트를 판정할 수 없음(`?host=`·`?hostaddr=`·소켓 경로·비정규 숫자 IP 등) |
| ⓕ | `NEXT_PUBLIC_APP_URL`·`AUTH_URL` 이 `https://` 아님(미설정 포함). preview 가 `AUTH_REDIRECT_PROXY_URL` 을 쓰면 `AUTH_URL` 미설정이 정상 |
| ⓖ | `ADMIN_EMAILS` 비어 있음 |
| ⓗ | `AUTH_SECRET`·`AUTH_GOOGLE_ID`·`AUTH_GOOGLE_SECRET` 없음 |
| ⓘ | `RATE_LIMIT_BACKEND=memory` 인데 `RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION≠true` (upstash 인데 URL·토큰 없음은 모든 환경에서 거부) |
| ⓙ | `CHAT_LLM_ENABLED=true` 인데 KEK 없음 |
| ⓚ | (PR-3·PR-4) `AUTH_REQUIRE_HD≠true` · production 에 `AUTH_REDIRECT_PROXY_URL` 설정(공백뿐인 값 포함) · preview 의 `AUTH_REDIRECT_PROXY_URL` 이 **정확히** `https://<호스트>/api/auth` 가 아님(끝 슬래시·userinfo·프래그먼트·쿼리·점 세그먼트·`:443`·대문자 호스트 거부) · preview 프록시 origin ≠ `NEXT_PUBLIC_APP_URL` · preview 에 프록시와 `AUTH_URL` 동시 설정 · 배포 환경에 `NEXTAUTH_URL` 설정 ([`oauth.md`](oauth.md) §3.1) |
| seed | `PRAMI_ALLOW_SEED` 설정(§4.9.3 L2) |

## 3. Vercel 프로젝트 설정

1. Framework preset: Next.js. Build `pnpm build`, Install `pnpm install --frozen-lockfile`, Node 24.
2. §2 환경변수를 Preview / Production 스코프별로 넣는다.
3. 함수 리전을 Neon 리전과 맞춘다(조회 p95 < 300ms).
4. `maxDuration`: 임포트 60s, PDF 30s, 챗봇 60s(코드). Fluid compute 기본 최대(Pro 800s) 안이다.
5. PDF 폰트·로고는 `outputFileTracingIncludes` 로 함수 번들에 포함된다. preview 에서 한글 PDF 1회 확인(C-15).
6. Google OAuth 클라이언트·동의 화면·리다이렉트 URI·preview 리다이렉트 프록시: [`oauth.md`](oauth.md) (PR-3).
7. `DB_DRIVER=neon` 빌드의 함수 트레이스 전체(`/api/*`·페이지·proxy·instrumentation)에 `@electric-sql/pglite` 가 들어가지 않는지 `pnpm check:trace` 로 확인한다(AC-330 ③).

## 4. Neon 구성과 마이그레이션 (§4.3.5·§4.3.6)

| 항목 | 결정 |
| --- | --- |
| 브랜치 | `main`(production), `preview`(모든 preview 공용, 고정 1개) |
| 런타임 연결 | `DATABASE_URL` = **pooled**(PgBouncer transaction mode). `neon-http` + 트랜잭션은 `neon-serverless` WebSocket(`src/db/tx.ts`) |
| 트랜잭션·락 | `pg_advisory_xact_lock`(트랜잭션 범위)만 쓴다. 세션 advisory lock·런타임 `SET`·`LISTEN`·`CREATE TEMP`·SQL `PREPARE` 금지 — `tests/unit/db/neon-compat.test.ts`(AC-325) |
| 마이그레이션 연결 | `DATABASE_URL_UNPOOLED`(직접). `scripts/migrate.ts` 가 있으면 우선 사용, 없으면 `DATABASE_URL` + 경고. 로그에는 호스트만 |
| 백업 | Neon PITR(플랜), 배포 직전 스냅샷 브랜치 `pre-deploy-<날짜>-<sha7>` |
| 롤백 | 앱: Vercel instant rollback. DB: forward-only(expand/contract) — 손상 시만 PITR(런북 R-3) |

- 마이그레이션은 **앱 배포 전에** 적용한다: `DB_DRIVER=neon DATABASE_URL_UNPOOLED=<직접 연결> pnpm db:migrate` (값은 셸 환경변수로만).
  현재 `0000`~`0007`(PR-3 `0007_llm_credential_expiry`).
- **기동 시 스키마 버전 검사**(`src/instrumentation.ts` → `src/server/ops/schema-version.ts`): 번들의 `drizzle/meta/_journal.json`
  마지막 항목과 DB `drizzle.__drizzle_migrations` 최신 항목을 비교한다. DB 가 뒤처지면 `db.schema_behind` 오류 로그 + `/api/health` 503,
  앞서면(롤백한 구버전 앱) `db.schema_ahead` 경고 + 200.

## 5. rate limit (§4.3.7, `src/server/rate-limit.ts`)

키(사용자 id·IP)당 분당 `RATE_LIMIT_PER_MIN`(기본 30), 슬라이딩 윈도우. 초과 시 429 + `Retry-After` + `{ok:false, error:{code:'RATE_LIMITED'}}`.

| 엔드포인트 | 키 | 한도 | 적용 위치 |
| --- | --- | --- | --- |
| `POST /api/chat` | 사용자 | 30/분 | Route |
| `POST /api/imports/*` | 사용자 | 30/분 | Route |
| 키 검증 | 사용자 | `LLM_VERIFY_PER_MIN` | 서비스 |
| `GET /api/quotes/[id]/pdf` | IP | 30/분 | proxy |
| `/share/quotes/[token]` | IP | 30/분 | proxy |
| `/api/auth/callback/*` | IP | 30/분 | proxy |
| `GET /api/health` | IP | 30/분 | proxy |
| 테스트 Credentials 로그인 | 이메일 | 30/분 | authorize (로컬 전용) |

- **백엔드**: `RATE_LIMIT_BACKEND=memory`(인스턴스 메모리 — 인스턴스당 근사치) | `upstash`(Upstash Redis REST, 인스턴스 간 합산).
  Upstash 는 REST `multi-exec` 한 번(ZREMRANGEBYSCORE·ZADD·ZCARD·PEXPIRE)으로 판정한다. 키: `prami:<env>:rl:<scope>:<key>`
  (`<env>` = `VERCEL_ENV` 또는 `local`). IP 키는 원문 IP 대신 `AUTH_SECRET` 파생 HMAC-SHA256 값이다.
- **장애 시**: Upstash 호출 실패·타임아웃(200ms)이면 그 요청만 인메모리로 판정하고 `rate_limit.backend_error`(scope·code, 키 없음) 경고.
  1분에 50회 이상 실패하면 `error` 수준으로 올린다. 가용성 우선(5xx 없음).
- IP 키는 감사 IP 와 같은 신뢰 헤더 정책을 쓴다. 운영은 반드시 `TRUST_PROXY_HEADERS=vercel`(ⓓ).
- Upstash 미제공 시: `RATE_LIMIT_BACKEND=memory` + `RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION=true` 로만 운영 가능 — 체크리스트 C-12 에 위험 수용과 승인자 기록.

## 6. 헬스체크·점검 모드 (§4.3.10·§4.3.11)

- `GET /api/health`(비인증, IP 30/분, `no-store`): `{ ok, release, db, schema, data }` 만. 실패 시 503.
  `db`: `select 1`, `schema`: `ok|behind|ahead`, `data`: production·preview 에서 fixture 계정(`fixture-` 접두)이 있으면 `fixture`(503, §4.9.3 L4).
  로컬·CI(`VERCEL_ENV` 없음)는 fixture 를 조회하지 않고 항상 `ok`.
- `GET /api/health/deep`(ADMIN): fixture 계정 수, `items.source='stub'` 수, 품목·판매단가·원가 행 수, 활성 KEK 존재, rate limit 백엔드 왕복.
  USER 는 권한 거부(403 + 감사 `access.denied`). 원가 값·이메일 목록은 없다.
- `MAINTENANCE_MODE=true`: 비 ADMIN 의 페이지·API 요청에 503 점검 안내. `/login`·`/api/auth/*`·`/api/health` 는 열어 둔다(ADMIN 복구 작업, Q-13).
- 구조화 로그는 모든 줄에 `release`(`APP_RELEASE` → `VERCEL_GIT_COMMIT_SHA` → `dev`)·`env`(`VERCEL_ENV` 또는 `local`)·`requestId`
  (proxy 가 붙인 `x-request-id`, Server Action·Route 경계 `runAction`·`runRoute` 의 요청 스코프에서 자동, 요청 밖은 `null`)를 싣는다(PR-4, AC-363).
  로그 검색 쿼리·알림·사고 대응은 [`../ops/runbook.md`](../ops/runbook.md).

## 7. 시연 데이터·로컬 스크립트 차단 (§4.3.4·§4.9.3)

| 대상 | 규칙 |
| --- | --- |
| `pnpm seed` / `seedDatabase()` | 원격 거부(`NODE_ENV=production` ∨ `VERCEL_ENV` ∨ `DB_DRIVER=neon` ∨ 호스트가 `localhost`·`127.0.0.1`·`::1`·`postgres`·`db` 밖) + 로컬도 `PRAMI_ALLOW_SEED=1` 일 때만. 우회 플래그 없음 |
| `pnpm fixtures` | seed 와 같은 조건 |
| `pnpm import:source` | 파일 경로 필수(기본 경로 없음). 원격 대상이면 `--target-host <호스트>` 가 실제 연결 호스트와 같아야 실행. 감사 actor `script:<OS 사용자>` |
| `pnpm credentials:rewrap` | 원격 허용. `--yes` 없으면 대상 호스트·대상 건수만 출력(변경 0) |
| `pnpm db:migrate` | 원격 허용. `DATABASE_URL_UNPOOLED` 우선 |
| `pnpm data:verify` | 읽기 전용(`READ ONLY` 트랜잭션). 원격 대상(`--target preview|production`)은 `--target-host` 일치 필요 |
| 로그인 정책 | `VERCEL_ENV` 가 있으면 로컬 부분이 `fixture-` 로 시작하는 이메일 거부(감사 `auth.denied_domain`, 사유 `fixture_account`) |
| 기동 데이터 검사 | `VERCEL_ENV` 가 있으면 기동 시 fixture 계정 수 1회 조회 → 있으면 `db.fixture_accounts_present` error 로그 + 헬스 503 |

## 8. 운영 데이터 적재 (§4.9.1 클린 설치)

빈 DB → `pnpm db:migrate` → `pnpm data:verify --stage schema --target <env> --target-host <호스트>` → 첫 ADMIN 로그인(`ADMIN_EMAILS`) →
관리 화면에서 판매단가(`병합_가격_raw.xlsx`) → 품목조회 5파일(한 배치) → 원가(`원자재코드 정보_260825.xlsx`) 순서로 적용 →
`pnpm data:verify --fresh --target <env> --target-host <호스트>` exit 0. **seed 실행 금지.** 부분 재시도 금지(실패하면 S-1 부터).
파츠 매핑은 `pnpm parts:draft --out <저장소 밖 폴더>` 초안을 관리자가 검수한 뒤 `/admin/parts` 엑셀 등록으로 넣거나 빈 상태로 둔다(§4.9.5).

## 9. LLM 자격 증명 (PRAMI-002)

- **KEK 생성**: `openssl rand -base64 32` → Vercel 환경변수(Sensitive)에만. preview 와 production 은 반드시 다른 KEK(T-11).
- **KEK 회전**(§4.7.2): 새 버전 추가 → `LLM_CREDENTIALS_ACTIVE_KEK` 변경 → 재배포 → `pnpm credentials:rewrap`(대상·건수 확인) →
  `pnpm credentials:rewrap --yes` → 구버전 행 0 이면 옛 KEK 제거.
- **백업 잔존(T-2)**: 삭제한 키도 PITR 보존 기간 동안 암호문으로 남는다(KEK 없이 복호화 불가). 보존 기간은 PR-5 에서 기록.
- 키 평문은 DB·로그·감사·응답 어디에도 남지 않는다.

## 10. 배포 워크플로·스모크·배포 게이트 (§4.3.1·§4.3.6·§4.3.10·§4.3.12, PR-4)

| 워크플로 | 트리거 | 하는 일 | 필요한 설정 |
| --- | --- | --- | --- |
| `.github/workflows/deploy-production.yml` | `main` push(= `integration/prami-003` → `main` 머지 1회), 수동 | ① `pnpm db:migrate`(Neon main, `DATABASE_URL_UNPOOLED`) → ② `vercel build --prod`(`APP_RELEASE`=커밋 SHA) → ③ `vercel deploy --prebuilt --prod` → ④ `pnpm smoke`(운영 도메인, 헬스 `release`=SHA) → ⑤ 실패 시 직전 production 배포로 `vercel rollback`. 앞 단계가 실패하면 뒤 단계는 실행하지 않는다(`needs`), 동시에 하나(`concurrency`, 취소 안 함) | GitHub Environment `production`(Required reviewers ≥ 1) 시크릿 `DATABASE_URL_UNPOOLED`·`VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`, 저장소 변수 `PRODUCTION_URL` |
| `.github/workflows/preview-migrate.yml` | `drizzle/**` 변경 PR 에 라벨 `db-migration` 을 **붙일 때만**(라벨 후 push 로는 실행 안 함 — 다시 적용은 라벨 제거 후 다시 붙이기) | Neon `preview` 브랜치에 `pnpm db:migrate`. preview DB 는 공용이라 동시에 하나(`preview-db-migration`). 포크 PR 은 실행하지 않는다. Environment `preview` 에 Required reviewers 권장 | GitHub Environment `preview` 시크릿 `DATABASE_URL_UNPOOLED`, 저장소 변수 `PREVIEW_URL` |
| `.github/workflows/preview-smoke.yml` | Vercel `deployment_status`(success, Preview), 수동(URL 입력) | 그 배포 URL 에 `pnpm smoke`(비인증 8항목) | (선택) 배포 보호를 켰으면 저장소 시크릿 `VERCEL_AUTOMATION_BYPASS_SECRET` — `deployment_status` 이벤트이고 대상이 https `*.vercel.app` 일 때만 헤더로 보낸다 |

- **GitHub 설정(사용자 제공 항목)**: Environment `production` = Required reviewers ≥ 1 + Deployment branches `main` 만.
  Environment `production-rollback` = 시크릿 `VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID` 만, reviewers 없음(사고 중 승인 대기 없이 롤백), Deployment branches `main` 만.
  Environment `preview` = `DATABASE_URL_UNPOOLED`(Neon preview), Required reviewers 권장. `main` 브랜치 보호로 CI 4잡 통과를 머지 조건으로 둔다 —
  `deploy-production` 은 CI 결과를 다시 확인하지 않으므로(머지 = 배포 트리거) 이 보호가 "검사 전 마이그레이션"을 막는다(보안 리뷰 L-1).
- **스모크 8항목**(`src/server/ops/smoke-checks.ts`, `tests/smoke/preview.smoke.ts`): ① `/api/health` 200·`schema:'ok'`(+`db`·`data` ok, no-store)
  ② `/login` Google 버튼만(테스트 폼·TEST MODE 배너·Credentials 공급자 없음) ③ 보안 헤더 6종 + CSP nonce ④ 비인증 `/pricing` → `/login`, `POST /api/chat` → 401 봉투
  ⑤ 비인증 Server Action 직접 호출 → `/login` ⑥ 없는 공유 토큰 404 ⑦ OpenRouter OAuth 시작이 벤더로 리다이렉트되지 않음(비인증 401 — 플래그 확인은 인증 E2E·C-3)
  ⑧ 위조 `X-Forwarded-For` 를 매번 바꿔도 31회 안에 429. 실행: `SMOKE_URL=https://<대상> pnpm smoke`.
- **로컬 preview 모의**(AC-361): `SMOKE_PG_URL=postgres://…@localhost:<격리 포트>/<DB> pnpm smoke:local` — 프로덕션 빌드(`.next-smoke`) + `VERCEL_ENV=preview`
  (preview 기동 검사 그대로) + 격리 Postgres. 앱은 `*.neon-smoke.test` 호스트로 Neon HTTP 드라이버를 쓰고, 테스트 전용 preload(`scripts/smoke/neon-local-fetch.mjs`,
  `next start` 의 `NODE_OPTIONS` 로만 주입 — 운영 코드·번들에 없음)가 그 요청을 격리 DB 로 실행한다. `--fault fixture` 는 fixture 계정을 넣어 ①이 실패하는지 본다.
  `:5432`·DB 이름 `prami`(로컬 실데이터)는 거부한다.
- **배포 게이트** `pnpm release:check env|schema|data|headers` — [`checklist.md`](checklist.md) C-3·C-5·C-7·C-8·C-9.
- actionlint 는 로컬에서 `docker run --rm -v "<저장소>:/repo" -w /repo rhysd/actionlint:latest` 로 확인한다(CI 잡 없음). 워크플로 구조는 `tests/unit/ops/workflows.test.ts` 가 고정한다.
- 오류 추적(Sentry, §4.3.8)은 DSN(UP-11)이 없어 도입하지 않았다 — `logger.error` + Vercel 로그·알림으로 대신한다. 도입 시 조건은 런북 §2.
