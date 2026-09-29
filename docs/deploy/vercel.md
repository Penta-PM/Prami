# Vercel 배포 체크리스트 (PRAMI-001)

이 문서는 PR-11a(로컬 하드닝)에서 만들었다. 실제 Vercel 배포·Neon 실연결·Google 실로그인·품목조회 매핑은 **PR-11b** 에서 한다.
PR-11b 는 아래 "착수 조건" 4종이 사용자에게서 도착해야 시작한다. §11.1 D-1~D-5 중 하나라도 미완이면 production 배포를 하지 않는다(R-18, AC-97).

> **비밀값은 이 저장소에 두지 않는다.** 모든 값은 Vercel 프로젝트 설정(Environment Variables)에만 둔다.
> `pnpm check:secrets`(CI `secret scan` 잡)가 원격 DB 자격 증명·`AUTH_SECRET=` 값·Google OAuth 시크릿/ID·Neon 비밀번호 패턴을
> 추적 파일에서 찾으면 실패한다(AC-96).

## 1. PR-11b 착수 조건 (사용자 제공)

| 제공 항목 | 용도 | 대응 |
| --- | --- | --- |
| Vercel 프로젝트 연결(저장소 연동 권한 또는 프로젝트 생성) | preview/prod 배포, env 설정 | AC-90, D-4, D-5 |
| Neon `DATABASE_URL` (preview/prod 브랜치) | `DB_DRIVER=neon` 실연결 | D-2 |
| Google OAuth 클라이언트 ID/Secret | 실로그인 | D-3 |
| ERP 품목조회 파일 | 헤더 상수·`ITEM_STATUS_MAP` 확정 | D-1 |

## 2. 환경변수 (§4.9.2 전 항목)

| 변수 | Preview | Production | 비고 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | preview URL (`https://…vercel.app`) | 운영 도메인 | https 이면 CSP 에 `upgrade-insecure-requests` 추가 |
| `DB_DRIVER` | `neon` | `neon` | |
| `DATABASE_URL` | Neon **preview 브랜치** 연결 문자열 | Neon **main 브랜치** 연결 문자열 | 시크릿. 저장소·문서에 적지 않는다 |
| `PGLITE_DATA_DIR` | — | — | Vercel 에서는 쓰지 않는다 |
| `AUTH_SECRET` | 32바이트 임의값 (`openssl rand -base64 32`) | preview 와 **다른** 값 | 시크릿 |
| `AUTH_URL` | preview URL | 운영 도메인 | Auth.js 콜백 기준 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 운영 OAuth 클라이언트 | 동일 | 시크릿(Secret) |
| `AUTH_TEST_MODE` / `AUTH_TEST_PASSWORD` | **설정하지 않는다** | **설정하지 않는다** | `VERCEL_ENV` 가 있으면 `env.ts` 가 기동 거부 |
| `AUTH_TEST_ALLOWED_HOSTS` | — | — | 테스트 모드 자체가 거부됨 |
| `AUTH_TEST_MODE_ALLOW_REMOTE` | **설정하지 않는다** | **설정하지 않는다** | 비공개 배포 예외 전용. 운영에서 금지 |
| `ALLOWED_EMAIL_DOMAINS` | `pentasecurity.com` | 동일 | |
| `ADMIN_EMAILS` | 운영 관리자 이메일 | 동일 | 최초 로그인 시 ADMIN 부트스트랩 |
| `AUTH_AUTO_PROVISION` | `true` | `true`(가정) | |
| `TRUST_PROXY_HEADERS` | `vercel` | `vercel` | 11b 에서 D-5 로 확정. 기본 `none` 이면 감사 IP 가 NULL |
| `RATE_LIMIT_PER_MIN` | `30` | `30` | 아래 §5 |
| `IMPORT_FAULT_INJECTION` | — | — | QA 전용. production 에서 기동 거부 |
| `VERCEL`, `VERCEL_ENV` | Vercel 이 주입 | Vercel 이 주입 | 직접 설정하지 않는다 |

### 테스트 모드 금지 조항

- Preview·Production 어디에도 `AUTH_TEST_MODE=true` 를 두지 않는다. 켜져 있으면 공용 비밀번호로 누구나 ADMIN 픽스처 계정에 로그인한다(R-17).
- `env.ts` 가 `NODE_ENV=production` 과 `VERCEL_ENV` 정의 환경에서 기동을 거부한다(AC-07, AC-94 ②). 예외 변수 `AUTH_TEST_MODE_ALLOW_REMOTE` 는 운영 배포에 넣지 않는다.
- 배포 후 `/login` 에 테스트 계정 폼·TEST MODE 배너가 **없어야** 한다(AC-94 ④, D-4).
- 로컬 dev 서버는 기본 `127.0.0.1` 바인드. LAN 노출(`pnpm dev -H 0.0.0.0`) 전에는 테스트 모드를 끈다.

## 3. Vercel 프로젝트 설정

1. Framework preset: Next.js. Build command `pnpm build`, Install `pnpm install --frozen-lockfile`, Node 24.
2. 위 §2 환경변수를 Preview / Production 스코프별로 넣는다.
3. 함수 리전을 Neon 리전과 맞춘다(§4.8 성능 목표 p95 < 300ms).
4. `maxDuration` 은 코드에 있다: 임포트 적용 페이지·업로드 Route 60s, PDF 30s, 챗봇 10s. 플랜 상한이 60s 미만이면 11b 에서 조정한다.
5. PDF 폰트·로고는 `next.config.ts` `outputFileTracingIncludes` 로 함수 번들에 포함된다. 배포 후 PDF 한글 렌더를 1회 확인한다.
6. Google Cloud 콘솔 OAuth 클라이언트에 승인된 리다이렉트 URI 를 등록한다:
   - `https://<preview 도메인>/api/auth/callback/google`
   - `https://<운영 도메인>/api/auth/callback/google`
   - preview URL 이 배포마다 바뀌면 고정 preview 도메인(브랜치 별칭)을 쓰거나 11b 에서 방식을 정한다.

## 4. Neon 전환 절차 (D-2)

1. Neon 프로젝트에서 `main`(production)·`preview` 브랜치를 만든다(Main).
2. Vercel env `DB_DRIVER=neon`, `DATABASE_URL`(브랜치별) 설정.
3. 마이그레이션: 로컬에서 대상 연결 문자열을 **셸 환경변수로만** 주고 실행한다. 파일에 저장하지 않는다.
   `DB_DRIVER=neon DATABASE_URL=<브랜치 연결 문자열> pnpm db:migrate`
4. 시드·데이터: `pnpm seed` → 판매단가 원본 5,885행·원가 487행 적용(화면 또는 `pnpm import:source`). 로컬 측정 적용 시간 0.5s 내외.
5. 트랜잭션 실패 주입(R-3): preview 전용으로 `IMPORT_FAULT_INJECTION` 을 잠깐 켜 QA-03e 를 재실행하고 곧바로 지운다.
6. AC-01·AC-20·AC-21·AC-40·QA-03a/03e 를 `DB_DRIVER=neon` 으로 재실행해 결과를 §7 표에 기록한다.

## 5. rate limit (§4.8 r6, AC-95)

구현: `src/server/rate-limit.ts` 단일 모듈. 키당 분당 `RATE_LIMIT_PER_MIN`(기본 30). 초과 시 HTTP 429 + `Retry-After`(초) +
`{ok:false, error:{code:'RATE_LIMITED'}}`. 감사 로그는 남기지 않고 구조화 로그 `rate_limited` 만 남긴다.

| 엔드포인트 | 키 | 한도 | 적용 위치 |
| --- | --- | --- | --- |
| `POST /api/chat` | 사용자 | 30/분 | Route |
| `POST /api/imports/*` | 사용자 | 30/분 | Route |
| `GET /api/quotes/[id]/pdf` | IP | 30/분 | proxy |
| `/share/quotes/[token]` | IP | 30/분 | proxy (비로그인 페이지라 IP 만 가능) |
| `/api/auth/callback/*` | IP | 30/분 | proxy |
| 테스트 Credentials 로그인 | 이메일 | 30/분 | authorize (로컬 전용) |

**인메모리 한계**: 슬라이딩 윈도우가 프로세스 메모리에 있다. Vercel 서버리스는 인스턴스마다 메모리가 따로라 상한은 **인스턴스당 근사치**다.
동시 인스턴스가 N개면 실제 허용량은 최대 N배가 될 수 있다. 콜드 스타트·재배포 때 카운트가 초기화된다.
IP 키는 감사 IP 와 같은 신뢰 헤더 정책을 쓴다. `TRUST_PROXY_HEADERS=vercel` 이면 `x-vercel-forwarded-for`(→ `x-real-ip`)이고,
기본 `none` 이면 클라이언트 `x-forwarded-for` 를 무시하고 **경로 단위 공용 버킷**이 된다(우회 불가·대신 경로 전체가 한도를 공유).
**운영에서는 반드시 `TRUST_PROXY_HEADERS=vercel`** 로 두어야 공유·PDF·auth 콜백 한도가 사용자(IP)별로 동작한다.
공유 저장소(Upstash Redis / Vercel KV) 전환은 후속 과제다(스펙 위험 R-19 후보로 Plan 에 기록 요청).

## 6. 보안 헤더 (AC-91)

- `src/proxy.ts`: 요청별 CSP nonce (`default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  frame-ancestors 'none'; form-action 'self' https://accounts.google.com; object-src 'none'; base-uri 'self'` …), `x-request-id`.
- `next.config.ts` `headers()`: `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- 확인: `curl -sI https://<preview>/login` 와 `curl -sI https://<preview>/share/quotes/<token>` 에 위 헤더가 있어야 한다. PR-11a 에서 로컬
  `pnpm build && pnpm start` 로 같은 검사를 했다(PR 본문).

## 7. §11.1 배포 전 필수 확인 (D-1~D-5) 수행 절차

결과 열은 PR-11b 에서 채운다(수행 일시·수행자·재실행 AC 판정). 하나라도 미완이면 production 배포 금지.

| # | 항목 | 수행 절차 | 재실행 AC | 결과 |
| --- | --- | --- | --- | --- |
| D-1 | ERP 품목조회 실파일 | 파일 수령 → 헤더 상수·`ITEM_STATUS_MAP` 확정(소PR 가능) → 임포트 적용 → 분류 3단·품목상태·폐기=미사용 확인 | AC-11, AC-22, AC-23, QA-03b | 미수행 |
| D-2 | Neon 실연결 | §4 절차 | AC-01, AC-20, AC-21, AC-40, QA-03a/03e | 미수행 |
| D-3 | Google OAuth 실로그인 | preview 에서 ADMIN 부트스트랩·USER 자동 생성·타 도메인 거부·비활성 거부를 실계정으로 각 1회 | AC-03, AC-06, AC-90 | 미수행 |
| D-4 | 테스트 모드 비활성 | preview/production `/login` 에 테스트 폼·TEST MODE 배너 없음. `VERCEL_ENV=preview AUTH_TEST_MODE=true` 거부는 단위 테스트(`tests/unit/env.test.ts`)로 확인됨 | AC-07, AC-94 ④ | 로컬 부분 완료 |
| D-5 | 감사 IP 신뢰 헤더 | `TRUST_PROXY_HEADERS=vercel` 로 배포 → 요청에 `X-Forwarded-For: 1.2.3.4` 를 넣고 감사 대상 행위 → `audit_logs.ip` 가 실제 클라이언트 IP 이고 `1.2.3.4` 가 아님을 확인 → §4.8·§4.9.2 에 확정값 반영 | AC-05, AC-93 | 로컬 구조 완료(모드별 단위·통합 테스트) |

## 8. 배포 직후 스모크 (AC-90)

1. `/login` → Google 로그인(ADMIN) → `/` 셸.
2. `/pricing` 조회·필터.
3. `/admin/policies` 임포트 업로드 → 미리보기 → 적용(5,885행).
4. `/calculator` 견적 저장 → PDF(한글) → 공유 링크 비로그인 열람 → 폐기 404.
5. 챗봇 "Wapples-500 가격".
6. `curl -sI` 헤더 검사(§6), rate limit 31회(§5) 1회 확인.
