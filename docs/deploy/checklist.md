# 배포 전 체크리스트 (PRAMI-003 §4.3.12, PR-4)

production 배포(`integration/prami-003` → `main` 머지 → `deploy-production`) 전에 C-1~C-18 을 **모두** 끝낸다.
하나라도 미완이면 production 배포 금지(PRAMI-001 R-18). 자동 항목은 `pnpm release:check` 가 판정 표를 출력하고 실패가 있으면 exit 1 이다.
수동 항목은 PR-5 본문에 **수행 일시 · 수행자 · 판정 · 증거 위치**를 적는다. 값(연결 문자열·토큰·키·개인 정보·원가 금액)은 쓰지 않는다.

명령의 `<…>` 는 자리표시자다. 실제 값은 셸 환경변수로만 준다(예: `DATABASE_URL_UNPOOLED` 는 셸에만, 문서·히스토리에 남기지 않는다).
`pnpm release:check` 는 이름·상태 코드·항목 판정만 출력한다(값 없음, AC-365).

| # | 항목 (흡수한 기존 ID) | 실행 명령 / 절차 | 판정 | 기록 |
| --- | --- | --- | --- | --- |
| C-1 | 저장소 품질 | `pnpm install --frozen-lockfile && pnpm check && pnpm test:integration && pnpm build && pnpm check:prerender && pnpm check:trace && pnpm check:secrets` (CI 4잡과 같음) | 전부 exit 0 | CI 실행 URL |
| C-2 | E2E | `pnpm test:e2e` (CI 동일, `--workers 1`) | 통과 | CI 실행 URL |
| C-3 | env 정합 | `pnpm release:check env --target preview` → `--target production` (Vercel CLI 로그인 상태에서 `vercel env ls <target>` 의 **이름**만 비교. 오프라인이면 `--names-file <이름 목록>`) | 필수 누락 0 · 금지 존재 0 (테스트 모드·시드·`DATABASE_URL_UNPOOLED`·`NEXTAUTH_URL`·production 의 프록시·preview 의 `AUTH_URL` 등) | 출력 표 |
| C-4 | 기동 검사 | `VERCEL_ENV=production <금지 설정 1개> pnpm build` 를 §4.3.3 규칙마다 — 판정 근거는 `tests/unit/env-deploy.test.ts`(규칙별 위반·통과 쌍)이고, 대표 1건(`AUTH_TEST_MODE=false`)을 실제 빌드로 확인 | 규칙마다 실패, 메시지에 이름만 | 빌드 로그 끝 5줄 |
| C-5 | 마이그레이션 (D-2, D2-5) | `DB_DRIVER=neon DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm db:migrate` (preview → production 순 — production 은 `deploy-production` 1단계가 실행) 후 `pnpm release:check schema --target <env> --url https://<호스트>` | `0000`~`0007` 적용, `schema:'ok'` | 출력 표 |
| C-6 | Neon 실연결 회귀 (D-2) | preview 브랜치 대상 `DB_DRIVER=neon pnpm test:integration -- --project neon` — AC-01·20·21·40, advisory lock(AC-215), OAuth state 소비(AC-244 ⑤) | 통과 | 실행 로그 |
| C-7 | 품목 적재 (D-1) | §4.3.13·§4.9.1 절차 후 `pnpm release:check data --target <env> --target-host <Neon 호스트>` (= `pnpm data:verify --fresh`) | items 2,511 · stub 0 · 운영중 2,428 · I-1/I-2/I-10 위반 0 | 출력 표 |
| C-8 | 시연 데이터 부재 (U-7) | C-7 의 시연 데이터 검사 + `/api/health/deep`(ADMIN) + `curl -s https://<호스트>/api/health` 의 `data:'ok'` | fixture 0 · 견적·공지·솔루션 그룹 0 · 파츠 매핑은 관리자 적재분만 · 감사 actor `seed` 0 | 출력·응답 |
| C-9 | 헤더·CSP (AC-91) | `pnpm release:check headers --url https://<preview 고정 호스트>` → `--url https://<운영 도메인>` | 6종 + nonce | 출력 표 |
| C-10 | 테스트 모드 부재 (D-4) | `SMOKE_URL=https://<호스트> pnpm smoke` ②(또는 `preview-smoke` 워크플로 결과) + `curl -s https://<호스트>/login` 에 `TEST MODE` 없음 | 통과 | 실행 URL |
| C-11 | 감사 IP (D-5) | `curl -H 'X-Forwarded-For: 1.2.3.4' …` 로 감사 대상 행위(로그인 등) → `audit_logs.ip` 가 실제 IP | `1.2.3.4` 아님 | 감사 행 id |
| C-11a | (PR-4) 위조 X-Forwarded-Host (PR #25 L-3) | preview 에서 `curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Host: evil.example.com' https://<배포별 preview URL>/login` | 400 (Vercel 엣지가 헤더를 덮어쓰면 200 — 어느 쪽인지 기록) · 정상 로그인은 영향 없음 | 상태 코드 |
| C-12 | rate limit | 같은 세션 31회 `POST /api/chat` → 429, 재배포 직후 다른 인스턴스에서도 합산되는지. memory 예외면 위험 수용 기록·승인자 | 429 / 기록 | 상태 코드 |
| C-13 | Google 실로그인 (D-3) | QA-5 수동 6건: ADMIN 부트스트랩 · USER 자동 생성 · 타 도메인 거부 · `hd` 없는 개인 Gmail 거부 · 비활성 거부 · preview 리다이렉트 프록시(서로 다른 preview URL 2개 복귀) | 6건 기대대로 | QA 보고서 |
| C-14 | KEK·LLM (D2-0~D2-3) | 환경별 KEK 다름(이름·버전만) · `LLM_VENDOR_MODE`·트레이싱 미설정 · 실벤더 스모크 §4.5.3(운영자 **회사** 키, preview `/settings` 등록 → "Wapples-500 가격" → `mode='llm'` → 키 삭제. SSE 에서 원가 질문 거부·가격 근거 도구 결과 1건. production 에 노출하는 API 키 벤더 **전부** 1회 — 미수행 벤더는 위험 수용 기록) · xAI 데이터 처리자 허용 결정(Q-15) · `LLM_OAUTH_OPENROUTER` 켜면 [`oauth.md`](oauth.md) §5.4 기준 | 통과 / 기록 | 벤더·모델·성공·토큰 수(키 없음) |
| C-15 | PDF·공유 | preview 에서 견적 PDF 한글 렌더, 공유 링크 열람 → 폐기 → 404 | 통과 | 스크린샷 위치 |
| C-16 | 백업 (D2-4) | Neon PITR 보존 기간(플랜) 확인 + `neonctl branches create --name pre-deploy-<날짜>-<sha7> --parent main` | 기록 | 브랜치 이름 |
| C-17 | 성능 | `/pricing` 필터 10회 p95, 임포트 적용 시간 | 기록(목표 p95 < 300ms·적용 < 10s, 미달 시 위험 기록) | 수치 |
| C-18 | 롤백 리허설 | preview 에서 런북 R-2 1회(Instant Rollback → 헬스 → 롤포워드 → 품목 재적용 점검) | 성공 | 실행 기록 |

## 자동 항목 빠른 실행 (로컬 대상 — AC-365)

```bash
pnpm release:check env --target local       # .env.local·.env 키 이름 비교
pnpm release:check schema --target local    # 직접 연결 DB(DB_DRIVER·DATABASE_URL)의 저널 대비 상태
pnpm release:check data --target local      # pnpm data:verify --fresh
pnpm release:check headers --url http://localhost:<포트>
```

원격(preview·production)은 `schema`·`headers` 에 `--url` 이 필요하고, `data` 는 `--target-host` 가 실제 연결 호스트와 같아야 실행된다(data:verify 원격 가드).

## 워크플로 (참고 — [`vercel.md`](vercel.md) §10)

- `deploy-production`: 마이그레이션 → 빌드 → 배포 → 스모크 → 실패 시 롤백. GitHub Environment `production` 승인 필요.
- `preview-migrate`: `drizzle/**` 변경 PR 에 라벨 `db-migration` 을 붙일 때만(다시 적용은 라벨 제거 후 다시 붙이기).
- `preview-smoke`: Vercel preview 배포 성공 시 스모크 8항목.
- GitHub Actions 가 조직 설정으로 막혀 있으면(2026-10-02 현재 queued) 위 워크플로는 실행되지 않는다 — 그동안 C-1·C-2 는 로컬 4잡 결과로, 스모크는 `pnpm smoke` 로 대신 기록한다.
