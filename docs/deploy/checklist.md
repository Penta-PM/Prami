# 배포 전 체크리스트 (PRAMI-003 §4.3.12, PR-4)

production 배포(`integration/prami-003` → `main` 머지 → `deploy-production`) 전에 **배포 전** 표(C-1~C-18)를 **모두** 끝낸다.
하나라도 미완이면 production 배포 금지(PRAMI-001 R-18). production 에서만 확인할 수 있는 부분은 **배포 직후** 표(A-1~A-4)로 나눴다 —
배포 직후 항목이 실패하면 런북 R-2(롤백) 또는 R-7(사고)로 간다(PR #26 F-11).
자동 항목은 `pnpm release:check` 가 판정 표를 출력하고 실패가 있으면 exit 1 이다.
수동 항목은 PR-5 본문에 **수행 일시 · 수행자 · 판정 · 증거 위치**를 적는다. 값(연결 문자열·토큰·키·개인 정보·원가 금액)은 쓰지 않는다.

명령의 `<…>` 는 자리표시자다. 실제 값은 셸 환경변수로만 준다(예: `DATABASE_URL_UNPOOLED` 는 셸에만, 문서·히스토리에 남기지 않는다).
명령은 bash(Windows 는 Git Bash) 문법이다 — PowerShell 이면 런북 머리말의 대응(`curl.exe`, `$env:`)을 쓴다(F-10).
Vercel CLI 를 쓰는 항목(C-3·C-18·A-4)은 런북 §0.5(설치·토큰·`vercel link`·`--scope`)를 먼저 한다(F-9). Vercel CLI 명령에는 모두 `--scope <팀> --token "$VERCEL_TOKEN"` 을 붙인다.

**preview 배포 보호 (PR #26 L2-5)**: Vercel Deployment Protection(Standard)이 켜져 있으면 preview 호스트(고정 호스트 포함)에 대한 curl·`pnpm smoke` 가 401 이다.
- curl: 셸 변수로 우회 시크릿을 받고(`read -rs VERCEL_AUTOMATION_BYPASS_SECRET`) 요청마다 `-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"` 을 붙인다. 끝나면 `unset`.
- `pnpm smoke`: 우회 헤더는 `SMOKE_BYPASS_SECRET` + `SMOKE_BYPASS_HOST_PATTERN` 에 맞는 **배포별 URL**(`<프로젝트>-<해시>-<팀>.vercel.app`)에만 보낸다 —
  고정 preview 호스트(`<프로젝트>-git-<브랜치>-<팀>.vercel.app`)는 패턴 밖이라 보내지 않는다. 보호가 켜져 있으면 **배포별 URL 로 스모크**한다
  (`preview-smoke` 수동 실행도 같다). 보호를 켜지 않았으면 이 줄은 해당 없음.
`pnpm release:check` 는 이름·상태 코드·항목 판정만 출력한다(값 없음, AC-365).

## 배포 전 (preview·로컬)

| # | 항목 (흡수한 기존 ID) | 실행 명령 / 절차 | 판정 | 기록 |
| --- | --- | --- | --- | --- |
| C-1 | 저장소 품질 | CI 2잡(quality: secret scan·lint·typecheck·format·unit·build / e2e: integration·E2E — `ci:run` 라벨 실행)과 같다. 로컬에서 대신할 때는 **격리 Postgres**(새 컨테이너, `:5432`·DB `prami` 금지 — :3000 실데이터 보호, F-13)를 띄워 `pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm check:prerender && pnpm check:trace && pnpm check:secrets` + `DB_DRIVER=pg DATABASE_URL=postgres://…@localhost:<격리 포트>/<DB> pnpm db:migrate && … pnpm test:integration` | 전부 exit 0 | CI 실행 URL(또는 로컬 로그) |
| C-2 | E2E | `pnpm test:e2e` (CI 동일, `--workers 1`, `E2E_DATABASE_URL` = 격리 DB — C-1 과 같은 주의) | 통과 | CI 실행 URL |
| C-3 | env 정합 · GitHub 설정 | `pnpm release:check env --target preview` → `--target production`(Vercel CLI 로그인 + `vercel link`. `vercel env ls <target>` 의 **이름**만 비교 — 표가 stderr 로 나와도 읽고, 이름을 하나도 못 읽으면 실행 실패로 끝난다. 오프라인이면 `--names-file <이름 목록>`) + GitHub 설정 확인([`github-plan.md`](github-plan.md) — 플랜에 맞는 절): 조직 플랜·저장소 공개 여부 기록 · 시크릿 6개(`DATABASE_URL_UNPOOLED`·`VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`·`PREVIEW_DATABASE_URL_UNPOOLED`·`VERCEL_AUTOMATION_BYPASS_SECRET`)의 위치(Free = 저장소, Team 이상 = Environment `production`·`production-rollback`·`preview` + Deployment branches `main` + 같은 이름 저장소 시크릿 없음, Enterprise = + reviewers) · write 이상 권한자 목록 = 운영 비밀값 보유자 · 저장소 변수 `PRODUCTION_URL`·`PREVIEW_URL`·`VERCEL_PREVIEW_HOST_PATTERN` · Vercel `MAINTENANCE_MODE` 유형 Config · Vercel Git 설정 `deployment_status` Events **꺼짐**(S1-a) · Actions 실행 가능(github-plan.md §5) | 필수 누락 0 · 금지 존재 0 (테스트 모드·시드·`DATABASE_URL_UNPOOLED`(Neon 연동 자동 추가 주의, vercel.md §3)·`NEXTAUTH_URL`·production 의 프록시·preview 의 `AUTH_URL` 등) · 설정 일치 · 남는 위험(github-plan.md §3.2) 수용 기록 | 출력 표 · 설정 화면 확인 일시 |
| C-4 | 기동 검사 | 규칙별 증명: `pnpm exec vitest run --project unit tests/unit/env-deploy.test.ts` — 기준 env(`VALID_PRODUCTION`·`VALID_PREVIEW`, 전 규칙 통과)에 **위반 1개만** 더한 쌍이 그 규칙으로만 실패한다(F-12). 실제 빌드 1건: 정상 preview 배포 성공(기준) → Vercel Preview 에 `AUTH_TEST_MODE=false` **하나만** 추가해 재배포 → 빌드 실패 · 로그에 그 이름만 → 변수 제거 | 규칙마다 실패, 메시지에 이름만 | 테스트 출력 · 빌드 로그 끝 5줄 |
| C-5 | 마이그레이션 (D-2, D2-5) — preview | **먼저 preview 역할 비밀번호 분리(보안 리뷰 HIGH)**: Neon 브랜치는 부모 브랜치의 역할을 그대로 물려받는다(같은 비밀번호인지 PR-5 에서 확인·기록) — `preview` 를 `main` 에서 만들었으면 Neon 콘솔 → `preview` 브랜치 → Roles 에서 앱·마이그레이션 역할 비밀번호를 **재설정**하고 Vercel Preview `DATABASE_URL`·GitHub `PREVIEW_DATABASE_URL_UNPOOLED` 를 새 값으로 바꾼다(preview 연결 문자열은 PR 코드가 읽을 수 있어, 비밀번호가 같으면 호스트만 바꿔 운영 DB 에 접속된다). 그다음 `DB_DRIVER=neon DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:migrate`(Neon `preview` 직접 연결 — 또는 `preview-migrate` 워크플로 수동 실행: PR 번호 + 검토한 head SHA) 후 `pnpm release:check schema --target preview --url https://<preview 고정 호스트>` | preview 역할 비밀번호 ≠ `main`(재설정 일시 기록, 값 없음) · `0000`~`0008` 적용, `schema:'ok'` | 출력 표 |
| C-6 | Neon 실연결 회귀 (D-2) | **일회용 브랜치**에서 실행(테스트 사용자·OAuth state 행을 쓰고 지운다 — `main` 금지). `neonctl` 준비는 C-16 과 같다(설치·`neonctl auth`·프로젝트 ID, I2-6): `neonctl branches create --project-id <프로젝트 ID> --name ci-neon-<날짜> --parent preview` → `DB_DRIVER=neon DATABASE_URL="<그 브랜치 pooled 연결>" NEON_TEST_ALLOW_HOST=<그 호스트> pnpm test:neon` → `neonctl branches delete ci-neon-<날짜> --project-id <프로젝트 ID>`. vitest 프로젝트 `neon` = neon-http 쿼리·마이그레이터 + WebSocket 트랜잭션으로 AC-01·AC-21·자격 증명 advisory lock(AC-215)·OAuth state 1회 소비(AC-244 ⑤). AC-20·AC-40(실데이터 적재 수치)은 C-7 이 같은 Neon 에서 확인 | `Tests 7 passed`, failed·skipped 0 — **환경이 없거나 호스트가 다르면 실패**한다(0건 통과 없음, PR #26 D-2) | 실행 로그 |
| C-7 | 품목 적재 (D-1) | §4.3.13·§4.9.1 절차 후 `DB_DRIVER=neon DATABASE_URL="<대상 직접 연결>" pnpm release:check data --target preview --target-host <그 URL 의 호스트>` (= `pnpm data:verify --fresh`, F-7 — 셸 env 가 없으면 `.env.local` 을 읽고 호스트 불일치로 거부) | items 2,511 · stub 0 · 운영중 2,428 · I-1/I-2/I-10 위반 0 | 출력 표 |
| C-8 | 시연 데이터 부재 (U-7) — preview | C-7 의 시연 데이터 검사 + `/api/health/deep`(ADMIN 브라우저 세션) + `curl -s https://<preview 고정 호스트>/api/health` 의 `data:'ok'` | fixture 0 · 견적·공지·솔루션 그룹 0 · 파츠 매핑은 관리자 적재분만 · 감사 actor `seed` 0 | 출력·응답 |
| C-9 | 헤더·CSP (AC-91) — preview | `pnpm release:check headers --target preview --url https://<preview 고정 호스트>` (원격 target 은 `--url` 필수 — 없으면 실패, F-23) | 6종 + nonce | 출력 표 |
| C-10 | 테스트 모드 부재 (D-4) | `SMOKE_URL=https://<preview 호스트> pnpm smoke` ②(또는 `preview-smoke` 워크플로 결과) + `curl -s https://<호스트>/login` 에 `TEST MODE` 없음 | 통과 | 실행 URL |
| C-11 | 감사 IP (D-5) | curl 로는 Google 로그인을 할 수 없다(F-19) — 브라우저로 로그인한 **USER** 계정의 세션 쿠키를 C-12 방법으로 셸 변수 `SESSION` 에 받아, 감사가 남는 거부 행위를 위조 헤더와 함께 보낸다: `curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 1.2.3.4' -H "cookie: __Secure-authjs.session-token=$SESSION" https://<preview 호스트>/api/health/deep` → 403 → ADMIN 이 `/admin/audit` 에서 그 시각 `access.denied` 행의 IP 확인 → `unset SESSION`·로그아웃 | 403 · 감사 IP 가 `1.2.3.4` 아님(실제 공인 IP) | 감사 행 id |
| C-11a | (PR-4) 위조 X-Forwarded-Host (PR #25 L-3) | preview 에서 `curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Host: evil.example.com' https://<배포별 preview URL>/login` | 400 (Vercel 엣지가 헤더를 덮어쓰면 200 — 어느 쪽인지 기록) · 정상 로그인은 영향 없음 | 상태 코드 |
| C-12 | rate limit | 세션 쿠키 얻기(F-19): preview 에 브라우저로 로그인 → 개발자 도구 Application → Cookies 의 `__Secure-authjs.session-token` 값을 셸 변수 `SESSION` 에만 → `for i in $(seq 31); do curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -H "cookie: __Secure-authjs.session-token=$SESSION" --data '{"messages":[{"role":"user","content":"ping"}]}' https://<preview 호스트>/api/chat; done` → 31번째 429. 재배포 직후 다시(다른 인스턴스 합산 확인). 끝나면 `unset SESSION` 후 로그아웃. memory 예외면 위험 수용 기록·승인자 | 429 / 기록 | 상태 코드 |
| C-13 | Google 실로그인 (D-3) | QA-5 수동 6건: ADMIN 부트스트랩 · USER 자동 생성 · 타 도메인 거부 · `hd` 없는 개인 Gmail 거부 · 비활성 거부 · preview 리다이렉트 프록시(서로 다른 preview URL 2개 복귀) | 6건 기대대로 | QA 보고서 |
| C-14 | KEK·LLM (D2-0~D2-3) | 환경별 KEK 다름(이름·버전만) · `LLM_VENDOR_MODE`·트레이싱 미설정 · `CHAT_LLM_ENABLED`·`LLM_OAUTH_OPENROUTER` 값 확인(대시보드 — 스모크 ⑦은 플래그를 보지 않는다) · 실벤더 스모크 §4.5.3(운영자 **회사** 키, preview `/settings` 등록 → "Wapples-500 가격" → `mode='llm'` → 키 삭제. SSE 에서 원가 질문 거부·가격 근거 도구 결과 1건. production 에 노출하는 API 키 벤더 **전부** 1회 — 미수행 벤더는 위험 수용 기록) · xAI 데이터 처리자 허용 결정(Q-15) · `LLM_OAUTH_OPENROUTER` 켜면 [`oauth.md`](oauth.md) §5.4 기준 | 통과 / 기록 | 벤더·모델·성공·토큰 수(키 없음) |
| C-15 | PDF·공유 | preview 에서 견적 PDF 한글 렌더, 공유 링크 열람 → 폐기 → 404 | 통과 | 스크린샷 위치 |
| C-16 | 백업 (D2-4) | Neon PITR 보존 기간(플랜) 확인 + 스냅샷 브랜치. `neonctl` 준비(F-18): `npm install --global neonctl` → `neonctl auth`(브라우저 로그인) 또는 `NEON_API_KEY` 셸 변수 → `neonctl projects list` 로 프로젝트 ID → `neonctl branches create --project-id <프로젝트 ID> --name pre-deploy-<날짜>-<sha7> --parent main` | 기록 | 브랜치 이름 |
| C-17 | 성능 | 측정 방법(F-19): preview 에 ADMIN 로그인 → 개발자 도구 Network 에서 `/pricing` 필터 변경 10회의 요청(Server Action/RSC) **Duration** 기록 → 정렬해 10개 중 10번째 값(p95 근사), 같은 표를 Vercel Observability 의 함수 p95 로 교차 확인. 임포트 적용 시간은 결과 리포트의 적용 소요 시간 | 기록(목표 p95 < 300ms·적용 < 10s, 미달 시 위험 기록) | 수치 |
| C-18 | 롤백 리허설 — preview (D-4) | Instant Rollback·`vercel rollback` 은 **production 전용**(preview 배포는 대상 아님)이라 preview 에서는 별칭 재할당으로 같은 판단 흐름을 연습한다: ① `vercel alias ls --scope <팀> --token "$VERCEL_TOKEN"` 으로 고정 preview 호스트가 지금 가리키는 배포(현재)를 확인하고(`vercel ls` 로는 별칭 대상을 알 수 없다, L2-4), `vercel ls --scope <팀> --token "$VERCEL_TOKEN"` 에서 그 직전 preview 배포 URL 을 고른다(`vercel inspect <URL> --scope <팀> --token "$VERCEL_TOKEN"` 로 커밋 확인) ② `vercel alias set <직전 배포 URL> <preview 고정 호스트> --scope <팀> --token "$VERCEL_TOKEN"` → `curl -s https://<고정 호스트>/api/health` 의 `release` = 직전 SHA ③ `vercel alias set <현재 배포 URL> <고정 호스트> --scope <팀> --token "$VERCEL_TOKEN"` 로 원복 → `release` = 현재 SHA(고정 호스트는 Git Branch 도메인이라 그 브랜치의 다음 preview 배포 때도 다시 붙는다 — oauth.md) ④ 런북 R-2 6단계(품목 재적용 점검)를 preview 에서 1회. production 의 실제 Instant Rollback·Undo Rollback 은 A-4 | 성공 | 실행 기록 |

## 배포 직후 (production — 사용자 공지 전)

| # | 항목 | 실행 명령 / 절차 | 판정 | 기록 |
| --- | --- | --- | --- | --- |
| A-1 | C-5 production | `deploy-production` 1단계가 마이그레이션 → `pnpm release:check schema --target production --url https://<운영 도메인>` | `schema:'ok'` | 출력 표 |
| A-2 | C-8 production | `DB_DRIVER=neon DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm release:check data --target production --target-host <그 URL 의 호스트>` + `/api/health/deep`(ADMIN) + `curl -s https://<운영 도메인>/api/health` 의 `data:'ok'`·`release` = SHA | C-8 과 같음 | 출력·응답 |
| A-3 | C-9 production | `pnpm release:check headers --target production --url https://<운영 도메인>` | 6종 + nonce | 출력 표 |
| A-4 | 롤백 리허설 — production (D-3·D3-N1·D-4) | 첫 배포는 되돌릴 이전 production 배포가 없으므로 `deploy-production` 을 같은 SHA 로 한 번 더 수동 실행(`maintenance`=`false`)해 production 배포를 2개(첫째 A, 둘째 B) 만든다. **두 배포의 SHA 가 같아 헬스 `release` 로는 구분이 안 되므로 판정은 배포 URL·ID 로 한다**(L2-1): 운영 도메인이 가리키는 배포 = `vercel alias ls --scope <팀> --token "$VERCEL_TOKEN"` 의 운영 도메인 행(또는 대시보드 production 타일). ① 런북 R-2 2단계(Instant Rollback 으로 A) → 도메인 = A · 헬스 200 ② **현재 배포 재promote 시도**: `vercel promote <A URL> --scope <팀> --token "$VERCEL_TOKEN"` → 결과(거부 메시지·종료 코드)를 기록한다(문서상 이미 promote 된 배포는 다시 promote 불가 — D3-N1) ③ `deploy-production` 을 한 번 더 실행(C, 같은 SHA) → deploy 잡이 "도메인 할당 확인"에서 실패하고 C 가 Staged 로 남는지 확인 ④ R-2 5단계 2) — Undo Rollback 대화상자에서 C 를 고르거나 `vercel promote <C URL> …` → 도메인 = C · 대시보드 롤백 표시 사라짐(자동 할당 복구) ⑤ 수동 스모크 8/8 | 성공 · ②의 결과와 ③의 Staged 감지 기록(PR #26 D3-N1 실측) | 실행 기록 |

## 자동 항목 빠른 실행 (로컬 대상 — AC-365)

```bash
pnpm release:check env --target local       # .env.local·.env 키 이름 비교
pnpm release:check schema --target local    # 직접 연결 DB(DB_DRIVER·DATABASE_URL)의 저널 대비 상태
pnpm release:check data --target local      # pnpm data:verify --fresh
pnpm release:check headers --url http://localhost:<포트>
```

원격(preview·production)은 `schema`·`headers` 에 `--url` 이 필요하고(없으면 실패), `data` 는 `--target-host` 가 실제 연결 호스트와 같아야 실행된다(data:verify 원격 가드).
출력 제목에는 실제로 본 대상(`--url` 호스트 또는 `--target-host`)이 나온다.

## 워크플로 (참고 — [`vercel.md`](vercel.md) §10)

- `deploy-production`: **수동 실행만**(브랜치 `main`) — 점검 모드 판정 → 마이그레이션 → 빌드 → 배포 → 도메인 할당 확인 → 스모크 → 실패 시 롤백(점검 모드 배포·롤백 상태면 롤백 안 함). 승인은 플랜이 허용할 때 1회(github-plan.md).
- `preview-migrate`: **수동 실행만**(브랜치 `main`, PR 번호 + 검토한 head SHA) — PR 의 `drizzle/` 만 받아 기본 브랜치 코드로 preview DB 에 적용.
- `preview-smoke`: Vercel `repository_dispatch`(`vercel.deployment.success`, preview) 때 기본 브랜치 YAML·스모크 코드로 8항목. 수동 실행은 URL 입력.
- **GitHub Actions 가 조직 설정으로 막혀 있으면(2026-10-02 현재 queued — 원인 확인 방법은 [`github-plan.md`](github-plan.md) §5) production 배포를 하지 않는다**(F-14). `vercel.json` 이 `main` 의 Vercel Git 배포를 꺼 두었으므로
  Actions 없이 production 으로 가는 경로는 운영자 PC 의 수동 `vercel deploy --prod` 뿐인데, 그 경로에는 마이그레이션 순서·승인·스모크·롤백 차단이 없다.
  막혀 있는 동안 C-1·C-2 는 로컬에서 같은 단계를 돌린 결과로, preview 스모크는 `pnpm smoke` 로 대신 기록하고, production 은 Actions 해제 후 R-1 로 배포한다
  (비상 점검 모드만 런북 §0.3 의 예외 절차).
