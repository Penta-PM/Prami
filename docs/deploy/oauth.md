# OAuth 운영화 (PRAMI-003 PR-3, 요구 U-3)

사용자 요구(원문): "OAuth도 다 구현하고".
이 문서는 스펙 §4.4(4.4.1~4.4.4)의 결정과 운영 설정 절차다. Google 콘솔 작업(§4)은 **사용자가 직접** 하고, 발급 값은 Main 에게만 전달한다.
환경변수 전체 표는 [`vercel.md`](vercel.md) §2, 로컬 실로그인 전환(T-0~T-2)은 [`local.md`](local.md) §1 을 본다.

> **비밀값은 이 저장소에 두지 않는다.** 이 문서는 자리표시자(`<…>`)만 쓴다. 클라이언트 ID·시크릿은 Vercel 환경변수(Sensitive)와
> 로컬 `.env.local`(Main 보관)에만 넣는다. `pnpm check:secrets` 가 Google OAuth 시크릿 형식을 추적 파일에서 찾으면 CI 가 실패한다.

## 1. 범위 (§4.4)

"다 구현"의 범위를 아래처럼 확정했다(스펙 §11 Q-01·Q-08).

| 대상 | 범위 | 상태 |
| --- | --- | --- |
| Google 로그인(Auth.js) | **운영 완성**: production·preview 실로그인, Internal 동의 화면, `hd` 서버 검증, 환경별 클라이언트 3개, preview 리다이렉트 프록시 | 구현(PR-3) + 실검증(PR-5) |
| OpenRouter OAuth PKCE | **운영 준비 완성**: 키 라벨, 한도 안내, 만료 처리(`expires_at`, `0007`), 해제·폐기 안내, 운영 활성화 기준(§5.4). 기본 플래그는 off | 구현(PR-3) |
| Anthropic / OpenAI / Gemini 사용자 OAuth | **구현하지 않는다**(공식 금지·제한·운영 부적합, §2). API 키(BYOK) 유지 | 결정 기록 |
| xAI | 사용자 위임 OAuth 문서 없음 → API 키(BYOK)만 | 결정 기록 |
| Google API 토큰(access/refresh) | 저장하지 않는다(필요한 Google API 없음) | 결정 기록 |

## 2. LLM 벤더 OAuth 조사 (확인일 2026-10-01, OpenRouter 파라미터는 PR-3 에서 2026-10-02 재확인)

| 벤더 | 제3자 웹앱의 사용자 위임 OAuth | 공식 근거(요지) | 결정 |
| --- | --- | --- | --- |
| Anthropic | **없음·금지** | "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications … developers may not collect, store, or intermediate Claude.ai credentials or session tokens." 인증 방식은 API 키·Workload Identity Federation(자기 조직 워크로드용)·App Attest(iOS/macOS)뿐 — <https://code.claude.com/docs/en/legal-and-compliance>, <https://platform.claude.com/docs/en/manage-claude/authentication>, <https://platform.claude.com/docs/en/manage-claude/workload-identity-federation> | BYOK API 키 유지 |
| OpenAI | 상용 웹앱 불가(제한 트라이얼) | "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial". 사용자 플랜 사용(token sharing)은 "open-source and locally hosted apps"용, 웹사이트 통합은 신원(openid/profile/email)만 — <https://developers.openai.com/siwc> | BYOK 유지. 파트너 승인 시 별도 스펙 |
| Google Gemini API | **운영 부적합** | OAuth 가이드는 "appropriate for a testing environment". 범위 `cloud-platform` + `generative-language.retriever`, 할당량·과금 프로젝트가 OAuth 클라이언트(개발사) 쪽. 사용자 과금은 `x-goog-user-project` + `serviceusage.services.use` + 사용자 GCP 프로젝트·결제 필요 — <https://ai.google.dev/gemini-api/docs/oauth>, <https://docs.cloud.google.com/docs/authentication/troubleshoot-adc>, <https://docs.cloud.google.com/docs/quotas/set-quota-project> | **구현하지 않는다**: ① 공식 가이드가 테스트용 ② 기본 과금이 회사 프로젝트(BYOK 원칙과 충돌) ③ 사용자별 GCP 프로젝트·결제·IAM 은 대상 사용자(영업·기획)에 비현실적 ④ `cloud-platform` 범위 과도 |
| Google Vertex AI | 기술적으로 가능, 범위 과도 | 사용자 프로젝트 URL + `roles/aiplatform.user` + `cloud-platform` — <https://docs.cloud.google.com/vertex-ai/docs/general/access-control> | 구현하지 않는다(위 ③④) |
| xAI | **없음(문서 미발견)** | API 인증은 `Authorization: Bearer <xAI API key>` 뿐, 관리 API 는 팀 관리 키용. 제3자 앱 사용자 위임 OAuth 문서는 찾지 못함(UNVERIFIED) — <https://docs.x.ai/developers/rest-api-reference/inference> | BYOK API 키 |
| OpenRouter | **있음(공식)** | PKCE: `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256` → `POST /api/v1/auth/keys` → 사용자 소유·사용자 과금 키(`key`, `user_id`). auth URL 파라미터는 `callback_url`·`code_challenge`·`code_challenge_method`·`key_label`("Prefills the label of the API key that will be created")·`workspace_id`·`required_workspace_id`뿐 — <https://openrouter.ai/docs/guides/overview/auth/oauth>. `limit`·`usage_limit_type`·`expires_at` 은 관리 키가 필요한 서버 API `POST /api/v1/auth/keys/code` 에만 있다("Only management keys can perform this operation") — <https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code.md>. 교환 응답은 `key`·`user_id` 뿐 — <https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key.md> | 운영 준비 완성(§5) |

## 3. Google 로그인 동작 (§4.4.1)

| 항목 | 구현 |
| --- | --- |
| 범위 | `openid email profile` 만(Auth.js Google 기본). Google 토큰은 저장하지 않고 JWT 세션에 `userId`·`role` 만 싣는다 |
| 도메인 제한 | ① 인가 URL 에 `hd=pentasecurity.com`(계정 선택 화면 힌트 — 우회 가능) ② 서버 `signIn` 콜백이 **ID 토큰 `hd` 클레임 ∈ `ALLOWED_EMAIL_DOMAINS`**(`AUTH_REQUIRE_HD=true`), `email_verified=true`, 이메일 도메인 ∈ `ALLOWED_EMAIL_DOMAINS` 를 모두 검사한다(`src/server/auth/callbacks.ts` `domainDenyCode`). Google 공식 권고: "Don't rely on this UI optimization … validate that the returned ID token has an `hd` claim" |
| 거부 감사 | `auth.denied_domain`, `after.reason` = `hd_missing`(개인 Gmail 등 `hd` 없음) / `hd_mismatch` / `email_unverified` / `email_domain`. 판정 순서는 `hd` → `email_verified` → 이메일 도메인. 로그인 화면에는 사유를 구분하지 않고 "허용된 회사 도메인…" 한 문구만 보인다. 거부 시 `users` 무변경 |
| ADMIN 부트스트랩 | `ADMIN_EMAILS` 의 이메일이 첫 로그인하면 ADMIN(감사 `user.bootstrap_admin`). production 에서 비면 기동 거부(ⓖ). 이후 역할은 `/admin/users` 에서 관리 ([`local.md`](local.md) §4) |
| 세션·쿠키 | JWT 8시간. https `AUTH_URL` 에서 쿠키는 `__Secure-authjs.session-token`(csrf 는 `__Host-`), `HttpOnly; Secure; SameSite=Lax; Path=/`. http(로컬)에서는 접두·`Secure` 없음(Auth.js 기본값) |
| 테스트 모드 | CI·E2E·격리 DB 만 `AUTH_TEST_MODE`(Credentials). 테스트 Credentials 는 `hd` 검사 대상이 아니고, production·preview 에서는 설정 자체가 기동 거부(ⓐ) |

### 3.1 preview 리다이렉트 프록시

Google 은 리다이렉트 URI 를 정확 일치로만 받는다(와일드카드 불가). preview 배포마다 URL 이 달라 등록할 수 없으므로 Auth.js
리다이렉트 프록시를 쓴다.

1. 배포별 preview(`https://<프로젝트>-git-<브랜치>-<팀>.vercel.app`)에서 로그인을 시작하면 Google `redirect_uri` 는 **고정 preview 호스트**
   콜백(`https://<preview 고정 호스트>/api/auth/callback/google`)이 되고, 원래 배포의 콜백 주소는 암호화된 `state` 에 실린다.
2. Google 이 고정 호스트로 돌려보내면 고정 호스트가 `state` 를 풀어(같은 `AUTH_SECRET` 필요) 원래 배포 콜백으로 `code`·`state` 를 그대로 302 한다.
3. 원래 배포가 자기 도메인의 state·PKCE 쿠키로 검증하고 세션을 만든다.

**preview 환경변수**(Vercel Preview 스코프 — 고정 호스트와 모든 preview 배포에 같은 값):

| 변수 | 값 |
| --- | --- |
| `AUTH_REDIRECT_PROXY_URL` | `https://<preview 고정 호스트>/api/auth` |
| `AUTH_SECRET` | preview 전용 값 **하나**(production 과 다름) |
| `AUTH_URL` | **설정하지 않는다** |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | `prami-preview` 클라이언트 |
| `AUTH_REQUIRE_HD` | `true` |
| `NEXT_PUBLIC_APP_URL` | `https://<preview 고정 호스트>` |

> **스펙 편차 (Main 승인, 2026-10-02 — Plan 사후 반영 대상)**: 스펙 §4.3.2·AC-342 는 preview `AUTH_URL` = 고정 호스트였다.
> next-auth 는 `AUTH_URL` 이 있으면 **모든 요청의 origin 을 그 값으로 바꾼다**(`next-auth/lib/env.js` `reqWithEnvURL`). 그러면 배포별 preview 의
> 로그인 요청도 고정 호스트로 간주돼 `state` 에 원래 배포 주소가 실리지 않고, state·PKCE 쿠키는 배포별 도메인에 남아 고정 호스트 콜백이
> 실패한다(재현 테스트: `tests/unit/auth/auth-flow.test.ts` "preview 에 AUTH_URL(고정 호스트)을 두면 …"). 그래서 preview 는 `AUTH_URL` 을
> 두지 않고(Vercel 은 요청 Host 를 신뢰) 기동 검사 ⓚ 가 "프록시 + `AUTH_URL` 동시 설정"을 거부한다. ⓕ 의 preview `AUTH_URL` 경고도 프록시를 쓰면 내지 않는다.

기동 검사 ⓚ(`src/env-deploy.ts`, production·preview 모두 거부): `AUTH_REQUIRE_HD≠true` · production 에 `AUTH_REDIRECT_PROXY_URL` 설정
(공백뿐인 값 포함) · preview 프록시 값이 **정확히** `https://<호스트>/api/auth` 가 아님(끝 슬래시·`user:pw@`·`#…`·`?…`·`/api/./auth`·`:443`·
대문자 호스트도 거부 — Auth.js 가 원문 뒤에 `/callback/google` 을 붙여 Google 정확 일치가 깨진다, PR #25 L-1) · preview 프록시 origin 이
`NEXT_PUBLIC_APP_URL`(고정 preview 호스트)과 다름 · preview 에 프록시와 `AUTH_URL` 동시 설정 · 배포 환경에 `NEXTAUTH_URL` 설정
(next-auth 가 `AUTH_URL` 처럼 origin 을 덮어쓴다, PR #25 L-2).

- **`AUTH_TRUST_HOST` 는 두지 않는다**(PR #25 I-5): 코드가 `trustHost: true` 로 고정(`src/server/auth/auth.config.ts`)이라 이 변수는 효과가 없다.
- **위조 X-Forwarded-Host 차단**(PR #25 L-3): preview 는 `AUTH_URL` 이 없어 요청 Host·X-Forwarded-Host 를 origin 으로 쓴다. proxy 가 preview 에서
  X-Forwarded-Host 를 허용 목록(요청 Host · `VERCEL_URL` · `VERCEL_BRANCH_URL` · `NEXT_PUBLIC_APP_URL` 호스트)과 비교해 다르면 400 으로 막는다
  (`src/server/security/forwarded-host.ts`). Vercel 엣지가 이 헤더를 직접 설정하는지는 PR-5 체크리스트 C-11a 에서 실 preview 로 1회 확인한다.

**고정 preview 호스트 만들기**(L-4): Vercel 프로젝트 → Settings → Domains → 도메인 추가(예 `preview.<회사 도메인>` 또는
`prami-preview.vercel.app`) → 그 도메인의 **Git Branch** 를 preview 용 브랜치(예 `integration/prami-003`)로 지정한다. 그 브랜치의 최신
preview 배포가 이 호스트로 서빙되며, 이 호스트가 Google 콜백을 받는 프록시 역할을 한다. 값은 Preview 스코프 `NEXT_PUBLIC_APP_URL`·
`AUTH_REDIRECT_PROXY_URL` 과 `prami-preview` 클라이언트 리다이렉트 URI 에 같은 호스트로 넣는다.

## 4. Google Cloud 콘솔 설정 절차 (사용자 작업 — UP-4a·UP-4)

Google Cloud 콘솔(<https://console.cloud.google.com>)에서 회사 Workspace 계정으로 진행한다. 메뉴 이름은 2026-10 기준
"Google Auth Platform"(구 "OAuth 동의 화면") 화면이다. **들어가는 법**(L-4): 콘솔 왼쪽 위 ☰ → **API 및 서비스** → **OAuth 동의 화면**
(또는 상단 검색창에 "Google Auth Platform") — 처음이면 "시작하기" 화면이 열린다.

### 4.1 프로젝트

1. 상단 프로젝트 선택 → **새 프로젝트**: 이름 예 `prami`, 조직 = `pentasecurity.com`(조직 아래에 만들어야 Internal 을 고를 수 있다).

### 4.2 동의 화면 (한 번)

1. **Google Auth Platform → 시작하기(Get started)** 또는 **브랜딩(Branding)**: 앱 이름 `Prami`, 사용자 지원 이메일 = 운영 담당자, 개발자 연락처 이메일.
2. **대상(Audience) → 사용자 유형 = 내부(Internal)**. 조직 구성원만 로그인할 수 있고 Google 앱 검증이 필요 없다.
   - `pentasecurity.com` 이 Google Workspace 조직이 아니어서 Internal 을 고를 수 없으면 **외부(External) + 프로덕션으로 게시**한다(기본 범위만이라
     민감 범위 검증이 없다). 이 경우에도 앱 서버가 `hd`·이메일 도메인을 검사하므로 회사 밖 계정은 로그인되지 않는다. 어느 쪽으로 했는지 Main 에게 알려 준다.
3. **데이터 액세스(Data Access) → 범위**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` 만 둔다(추가 범위 금지).

### 4.3 OAuth 클라이언트 3개 (환경별 분리)

**클라이언트(Clients) → 클라이언트 만들기 → 애플리케이션 유형 = 웹 애플리케이션**을 세 번 만든다. "승인된 JavaScript 원본"은 비워 둔다(서버 리다이렉트 흐름).

| 클라이언트 이름 | 환경 | 승인된 리다이렉트 URI (정확히 이대로) |
| --- | --- | --- |
| `prami-prod` | production | `https://<운영 도메인>/api/auth/callback/google` |
| `prami-preview` | preview | `https://<preview 고정 호스트>/api/auth/callback/google` (배포별 preview URL 은 등록하지 않는다 — §3.1 프록시) |
| `prami-dev` | 로컬 :3000 | `http://localhost:3000/api/auth/callback/google` 와 `http://127.0.0.1:3000/api/auth/callback/google` 두 개 |

- https 필수(localhost·127.0.0.1 만 예외), 끝 슬래시·경로 오타가 있으면 `redirect_uri_mismatch` 가 난다.
- **클라이언트 보안 비밀번호는 만들 때 나오는 창에서 바로 복사하거나 JSON 을 다운로드한다**(L-4). 2025년 이후 콘솔은 나중에 비밀번호를
  다시 보여 주지 않는다 — 잃어버리면 새 비밀번호를 추가하고 옛 것을 삭제한다.
- `<운영 도메인>`·`<preview 고정 호스트>` 가 아직 없으면 `prami-dev` 만 먼저 만들어도 된다(로컬 T-1 전환, UP-4a). 나머지는 도메인 확정 후(PR-5).

### 4.4 Main 에게 전달할 것 (값은 채팅·PR·저장소에 쓰지 않는다 — 안전한 경로로 Main 에게만)

| 항목 | 넣는 곳 |
| --- | --- |
| `prami-dev` 클라이언트 ID·시크릿 | 로컬 `.env.local` `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` ([`local.md`](local.md) T-1) |
| `prami-preview` 클라이언트 ID·시크릿 | Vercel Preview 환경변수 |
| `prami-prod` 클라이언트 ID·시크릿 | Vercel Production 환경변수 |
| 첫 관리자 이메일 1명 이상(+예비 1명 권장) | `ADMIN_EMAILS` (production·preview·로컬, UP-7) |
| 사용자 유형(Internal / External+게시) | PR-5 체크리스트 기록 |

### 4.5 확인 (PR-5 QA-5, 실 계정)

- 회사 계정 → 로그인 성공, 감사 `auth.login` 1행. 개인 Gmail → 거부(감사 `hd_missing`). 서로 다른 preview URL 2개에서 로그인 후 원래 preview 로 복귀.
- 운영 `/login` 에 테스트 폼·TEST MODE 배너가 없다.

## 5. OpenRouter OAuth (§4.4.3)

| 항목 | 구현 |
| --- | --- |
| 키 라벨 | 인증 화면 URL 에 `key_label=Prami (<환경>)`(`production`·`preview`·`local`, `src/server/llm/oauth/key-label.ts`). 사용자가 OpenRouter 대시보드에서 키를 알아본다 |
| 한도 | PKCE auth URL 은 `limit`·`usage_limit_type` 을 받지 않는다(§2) → **앱 한도 입력란은 두지 않는다**. 연결 카드에 "사용 한도(크레딧)는 OpenRouter 대시보드에서 키 `Prami (<환경>)`에 직접 설정" 안내와 [키 관리](https://openrouter.ai/settings/keys) 링크를 보인다 |
| 만료 | `user_llm_credentials.expires_at timestamptz NULL`(`drizzle/0007_llm_credential_expiry.sql`). PKCE 흐름은 만료를 지정할 수 없어 **기본 NULL(비만료)**. 값이 지나면 챗봇 `setup.status='invalid'` + "OpenRouter 연결이 만료되었습니다 — 다시 연결하세요", 설정 카드 "재연결 필요", [검증]은 벤더 호출 없이 `invalid`·`code=expired`(감사 `settings.llm_credential.verify` result=`error`, `after.code='expired'`) |
| 해제 | 삭제 = 앱 저장본 즉시 파기(플래그 off 에서도 가능) + 감사 `settings.oauth.disconnect`. 앱은 사용자 키를 원격 폐기할 수 없어(관리 키 필요) 화면에 "OpenRouter 대시보드에서 키 `Prami (<환경>)`를 삭제하세요" 안내와 링크를 보인다 |
| refresh | 없음 — OpenRouter 는 refresh token 대신 키를 준다. 만료(선택) 시 재연결 |
| 교환 키 노출 | 교환 응답의 키는 봉투 암호화 저장으로만 흐른다. 콜백 응답·로그·감사에 키 0(PRAMI-002 AC-204) |

### 5.4 운영에서 `LLM_OAUTH_OPENROUTER=true` 로 켜는 기준 (모두 충족, 체크리스트 C-14 에 기록)

1. 사내 정책상 OpenRouter 를 질문·판매단가 전송 대상(데이터 처리자)으로 허용(사용자 결정).
2. preview 에서 실 OpenRouter 계정으로 연결·질문·해제 왕복 1회 성공(수동).
3. PRAMI-002 AC-244 ①~⑥ 과 PRAMI-003 AC-345 재실행 통과.
4. 운영 도메인 `callback_url` 이 https 이고 `NEXT_PUBLIC_APP_URL` 과 일치.

충족하지 않으면 off 로 배포한다. off 여도 API 키 벤더(Anthropic·OpenAI·Gemini·xAI)는 정상이다.
preview 에서 켤 때 `callback_url` 은 `NEXT_PUBLIC_APP_URL`(고정 preview 호스트) 기준이므로 연결은 고정 호스트에서 시작한다.
배포별 preview URL 에서 [연결]하면 콜백이 고정 호스트로 가서 PKCE 쿠키가 맞지 않아 실패한다(fail-closed, PR #25 I-4) — preview 의 OpenRouter 연결은
**고정 preview 호스트에서만** 한다.

## 6. 토큰 저장·갱신·폐기·감사 (§4.4.4)

| 토큰 | 저장 | 갱신 | 폐기 | 감사 |
| --- | --- | --- | --- | --- |
| Google ID/access/refresh | **저장하지 않음**. JWT 세션에 `userId`·`role` 만 | 없음(8시간 후 재로그인) | 로그아웃·비활성화 시 세션 무효 | `auth.login`, `auth.denied_*`(`hd` 사유 코드 포함) |
| OpenRouter 발급 키 | 봉투 암호화(`auth_type='oauth_pkce'`), `expires_at`(선택, 기본 NULL) | refresh 없음, 만료 시 재연결 | 사용자 삭제 = 즉시 파기 + 대시보드 폐기 안내. 플래그 off 에도 삭제 가능 | `settings.oauth.connect`/`disconnect`, 만료 검증 `settings.llm_credential.verify` result=`error` code=`expired` |
| OAuth 흐름 state | `oauth_flow_states`(SHA-256 만, 1회 소비, 10분 만료) | — | 만료 행 정리 | 결과만 |

## 7. 검증 위치 (AC-341~347)

| AC | 테스트 |
| --- | --- |
| AC-341 `hd` 검증 | `tests/unit/auth/callbacks.test.ts`(① 허용 ② `hd_missing` ③ `hd_mismatch` ④ `email_unverified` ⑤ users 무변경), `tests/unit/auth/auth-config.test.ts`(콜백 연결), `tests/integration/auth.pg.test.ts`(실 PG) |
| AC-342 리다이렉트 프록시 | `tests/unit/auth/auth-flow.test.ts` — 실제 next-auth 핸들러, Google 디스커버리만 스텁(실 Google 호출 0), 302 Location 검사 |
| AC-343 쿠키·세션 | `tests/unit/auth/auth-flow.test.ts` — `__Secure-` 접두·속성·만료 8시간 |
| AC-344 결정 문서 | 이 문서 + `pnpm check:secrets` |
| AC-345 라벨·한도 | `tests/unit/settings/oauth-openrouter.test.ts`, `tests/unit/settings/oauth-card.test.tsx` |
| AC-346 만료 | `tests/unit/settings/oauth-expiry.test.ts`, `tests/unit/settings/oauth-card.test.tsx` |
| AC-347 해제 안내 | `tests/unit/settings/oauth-expiry.test.ts`, `tests/unit/settings/oauth-card.test.tsx` |
