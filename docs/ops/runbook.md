# Prami 운영 런북 (PRAMI-003 §4.3.11, PR-4)

운영(Vercel Production · Neon `main` · Upstash)과 preview 의 정기 배포·롤백·복구·사고 대응 절차다. 배포 전 점검은
[`../deploy/checklist.md`](../deploy/checklist.md), 구성·환경변수는 [`../deploy/vercel.md`](../deploy/vercel.md), 로그인·OAuth 는
[`../deploy/oauth.md`](../deploy/oauth.md), 로컬 :3000 은 [`../deploy/local.md`](../deploy/local.md) 를 본다.

> 명령의 `<…>` 는 자리표시자다. 실제 값(연결 문자열·토큰·키)은 셸 환경변수로만 주고 이 문서·PR·채팅에 쓰지 않는다.
> 모든 절차의 결과(수행 일시·수행자·판정)는 배포 PR 본문 또는 사고 기록에 남긴다.

## 0. 공통 — 로그·알림·킬스위치 (§4.3.8)

### 0.1 구조화 로그

모든 줄이 한 줄 JSON 이고 `level`·`event`·`time`·`release`(커밋 SHA)·`env`(`production`/`preview`)·`requestId`(응답 헤더 `x-request-id` 와 같은 값)를 갖는다.
비밀값은 키 이름·값 패턴 두 겹으로 가려진다(`[REDACTED]`). 사용자가 오류 화면의 "요청 ID" 를 알려 주면 `requestId` 로 찾는다.

Vercel 대시보드 → 프로젝트 → **Logs** 검색창 예시(로그 드레인이 없으면 이것만 쓴다 — 보존 기간이 짧으므로 판단에 필요한 내용은 사고 기록으로 옮긴다):

| 목적 | 검색어 |
| --- | --- |
| 특정 요청 | `"requestId":"<x-request-id>"` |
| 이번 배포에서 난 로그만 | `"release":"<커밋 SHA>"` |
| 예상 밖 서버 오류(5xx 봉투) | `"event":"request.failed"` |
| 챗봇 LLM 오류(원인 진단 필드) | `"event":"chat.llm_error"` — `code`·`vendor`·`httpStatus`·`vendorErrorType`·`vendorErrorCode`·`attempts` |
| 어댑터 갱신 필요 신호(폐기된 벤더 기능) | `"event":"chat.llm_error"` + `"vendorErrorCode":"deprecated"` (level `error`) |
| 스키마 불일치 | `"event":"db.schema_behind"` (헬스 503) · `"event":"db.schema_ahead"` (롤백한 구버전 앱, 경고) |
| rate limit 저장소 장애 | `"event":"rate_limit.backend_error"` (1분 50회 이상이면 level `error`) |
| 한도 초과 | `"event":"rate_limited"` |
| 위조 X-Forwarded-Host 차단(preview) | `"event":"proxy.forwarded_host_rejected"` |
| 관리자 영역 거부 감사 실패 | `"event":"proxy.audit_failed"` |

### 0.2 알림

| 신호 | 감지 | 대응 |
| --- | --- | --- |
| 배포 스모크 실패 | `deploy-production` 실패 알림(GitHub Actions — 저장소 Watch 설정) | 자동 롤백 결과 확인 → R-2 |
| `/api/health` 503 (`db.schema_behind`·`data:'fixture'`) | 배포 스모크 ① / Vercel 알림(플랜 기능) | 마이그레이션 상태 확인(C-5) · fixture 계정 정리(R-7) |
| `rate_limit.backend_error` 폭증 | 로그 검색 / Vercel 알림 | Upstash 상태 확인. 장애 동안은 인메모리 판정(가용성 우선) |
| 5xx 비율 증가 | Vercel Observability | `request.failed` 를 `release` 로 좁혀 원인 PR 확인 → R-2 |

### 0.3 킬스위치 (Vercel 환경변수 변경 → 재배포)

| 변수 | 효과 |
| --- | --- |
| `CHAT_LLM_ENABLED=false` | 챗봇 LLM 경로 전체 끔(규칙 응답만) |
| `LLM_OAUTH_OPENROUTER=false` | OpenRouter 연결 시작·사용 끔(저장 키 삭제는 가능) |
| `MAINTENANCE_MODE=true` | 비 ADMIN 의 페이지·API 에 503 점검 안내. `/login`·`/api/auth/*`·`/api/health` 는 열림 |

### 0.4 오류 추적(Sentry) — 현재 미도입

UP-11(DSN)이 없어 도입하지 않았다(AC-364 해당 없음). 도입하면: `@sentry/nextjs`, `sendDefaultPii=false`, `beforeSend` 에서 요청 본문·쿠키·
`authorization`·`x-api-key` 헤더 제거 + `sanitizeForLog`, CSP `connect-src` 에 수집 호스트 1개만 추가하고 AC-91 을 다시 확인한다.

## R-1 정기 배포

1. `integration/prami-003`(또는 이후 통합 브랜치) → `main` PR 을 QA 최종 승인 후 머지한다. 체크리스트 C-1~C-18 이 모두 끝나 있어야 한다.
2. Actions `deploy-production` 이 대기한다 → GitHub Environment `production` 승인자가 **Review deployments → Approve**.
3. 워크플로가 순서대로 ① 마이그레이션(`DATABASE_URL_UNPOOLED`) ② `vercel build --prod` ③ `vercel deploy --prebuilt --prod` ④ 스모크 8항목 ⑤ 실패 시 롤백을 한다.
   마이그레이션이 실패하면 배포 단계는 실행되지 않는다.
4. 결과 기록: 워크플로 실행 URL, 커밋 SHA, 스모크 결과, `/api/health` 의 `release` 가 SHA 와 같은지.
5. 실패하면 R-2.

## R-2 앱 롤백

1. 자동: 스모크가 실패하면 워크플로의 `rollback` 잡이 직전 production 배포로 `vercel rollback` 한다(잡 로그에서 확인).
2. 수동: Vercel 대시보드 → Deployments → 직전 정상 배포 → **Instant Rollback**, 또는
   `vercel rollback <직전 배포 URL> --token "$VERCEL_TOKEN"`.
3. `curl -s https://<운영 도메인>/api/health` → 200·`schema` 가 `ok` 또는 `ahead`(구버전 앱 — expand/contract 라 정상)인지 확인.
4. 스키마는 되돌리지 않는다(forward-only — 마이그레이션 down 스크립트는 없다, PR #19 I-5). 원인 PR 은 일반 PR 로 revert 한다.
5. **롤포워드 후 점검 (PR #21 I-10)**: 롤백 창 동안 감사 로그에 `policy.apply`(품목 배치 포함)가 있었으면 — 구버전 앱이 적용한 품목은 종류가 비어
   stub(미확인)이 된다 — 신버전 재배포 직후 `/admin/policies` 에서 **직전 품목 5파일 배치를 "기존 파일 재사용"으로 다시 적용**하고
   `pnpm data:verify --target production --target-host <Neon 호스트>` 로 품목 2,511 · stub 0 · 운영중 2,428 을 확인한다. 롤백 창에 품목 적용이 없었으면 생략.

## R-3 DB 복구

데이터 손상·잘못된 대량 적용 때만 한다(앱 문제는 R-2).

1. **먼저 이력 재적용으로 되는지 본다**: 임포트를 잘못 적용했으면 `/admin/policies` 에서 이전 배치를 "기존 파일 재사용"으로 다시 적용한다(PRAMI-001 §4.4.6).
2. 쓰기 중단: `MAINTENANCE_MODE=true` → 재배포.
3. Neon 콘솔에서 배포 직전 스냅샷 브랜치 `pre-deploy-<날짜>-<sha7>`(C-16) 또는 PITR(플랜 보존 기간 안)로 **새 브랜치**를 만든다. 원래 `main` 은 지우지 않는다.
4. 새 브랜치에 읽기 전용으로 `pnpm data:verify --target production --target-host <새 브랜치 호스트>` → 기대 수치 확인.
5. Vercel Production `DATABASE_URL`(pooled)과 GitHub Environment `DATABASE_URL_UNPOOLED` 를 새 브랜치로 바꾼다 → 재배포 → `/api/health` 200.
6. `MAINTENANCE_MODE` 제거 → 재배포. 사고 기록(R-7 5단계)에 복원 시점·브랜치 이름을 남긴다.

## R-4 KEK 회전 (PRAMI-002 §4.7.2)

1. 새 KEK 버전을 `LLM_CREDENTIALS_KEKS` 에 **추가**(기존 유지) → `LLM_CREDENTIALS_ACTIVE_KEK` 를 새 버전으로 → 재배포.
2. `DATABASE_URL="$DATABASE_URL_UNPOOLED" DB_DRIVER=neon pnpm credentials:rewrap --yes` — 실행 전 대상 호스트·행 수가 출력된다. 모든 행이 새 버전으로 바뀐다.
3. 옛 버전을 `LLM_CREDENTIALS_KEKS` 에서 제거 → 재배포 → 설정 화면에서 키 하나 [검증] 정상 확인.

## R-5 비밀값 노출 대응

노출 의심 즉시: 값의 종류를 확인하고 아래를 한 뒤 R-7 로 기록한다. 값 자체를 사고 기록에 쓰지 않는다.

| 노출된 값 | 조치 |
| --- | --- |
| `AUTH_SECRET` | 새 값으로 교체 → 재배포(전 세션 무효 — 사용자 재로그인). preview·production 은 서로 다른 값 |
| Google 클라이언트 시크릿 | Google Auth Platform → 클라이언트 → 새 보안 비밀번호 추가 → Vercel 반영·재배포 → 옛 비밀번호 삭제 |
| DB 비밀번호 | Neon 역할 비밀번호 재설정 → `DATABASE_URL`(Vercel)·`DATABASE_URL_UNPOOLED`(GitHub) 교체 → 재배포 |
| KEK | R-4 + 저장된 사용자 키가 노출됐을 수 있으므로 사용자에게 키 재등록(벤더 콘솔에서 폐기) 공지 |
| Upstash 토큰 | Upstash 콘솔에서 재발급 → Vercel 반영 → 재배포 |
| `VERCEL_TOKEN` | Vercel Account → Tokens 에서 폐기·재발급 → GitHub Environment 시크릿 교체 |

## R-6 감사 로그 보관 (§4.9.7, Q-07)

- 감사 로그는 DB 에 append-only 로 **최소 3년** 둔다. 삭제 배치는 없다.
- 분기마다 ADMIN 이 `/admin/audit` → **CSV 내보내기**로 그 분기 범위를 받아 보관한다(보관 위치·담당은 사용자 결정 — 정해지면 여기에 적는다).
- CSV 는 `=`·`+`·`-`·`@`·탭·CR 로 시작하는 셀 앞에 `'` 를 붙여 스프레드시트 수식 실행을 막는다(`src/lib/audit-format.ts` `csvCell`, AC-373 ④).
  원본 품목 비고처럼 수식처럼 보이는 텍스트도 그대로 안전하게 열린다.

## R-7 사고 대응

1. **탐지**: 알림(§0.2) 또는 사용자 신고(요청 ID 포함 권장).
2. **영향 범위**: §0.1 검색어로 `release`·`requestId`·`event` 를 좁힌다. 감사 로그(`/admin/audit`)에서 같은 시간대 행위를 본다.
3. **차단**: 킬스위치(§0.3) — 챗봇 문제면 `CHAT_LLM_ENABLED=false`, OAuth 문제면 `LLM_OAUTH_OPENROUTER=false`, 데이터 문제면 `MAINTENANCE_MODE=true`.
   원가 노출이 의심되면 PRAMI-001 AC-42·43·81(원가 격리) 테스트를 다시 돌린다.
4. **복구**: R-2(앱) / R-3(DB) / R-5(비밀값). fixture 계정이 운영에 생겼으면(`/api/health` `data:'fixture'`) 원인을 찾은 뒤 ADMIN 이 비활성화한다.
5. **사후 기록**: 탐지 시각·원인·영향·조치·재발 방지(PR 링크). 값·개인 정보·원가 금액은 쓰지 않는다.

## R-8 관리자 부트스트랩·이관 (§4.9.8)

1. 첫 배포 후 `ADMIN_EMAILS` 에 있는 계정으로 Google 로그인 → ADMIN 으로 자동 생성된다(`created_via=bootstrap`).
2. `/admin/users` 에서 역할을 확인하고 필요한 관리자를 추가한다.
3. 이후 `ADMIN_EMAILS` 는 비상용으로 1명만 유지한다(비어 있으면 production 기동 거부 — 기동 검사 ⓖ).

## R-9 데이터 갱신 (ERP 판매단가·품목·원가)

1. `/admin/policies`(판매단가·품목) 또는 `/admin/costs`(원가)에서 새 파일 업로드 → 미리보기 경고(제외 컬럼·누락 제품군·행 오류) 확인.
2. 품목 배치에 직전 제품군이 빠졌으면 병합 방식을 고른다. **전량 교체**는 확인 창에 사라질 품번 수와 운영중 판매단가 행 증감 예상
   (예: 2,428 → 3,644)이 나온다 — stub 이 된 품번의 최신 행은 폐기가 아니라 운영중이 되므로 의도한 경우만 교체한다(PR #19 I-3).
3. 적용 → 결과 리포트(적용 통계)를 보관한다. 이상하면 R-3 1단계(이전 배치 재적용).
4. 대량 갱신 후 `pnpm data:verify --target production --target-host <Neon 호스트>` 로 불변식(I-1·I-2·I-10)을 확인한다.

## R-10 로컬 :3000 DB 재구성 (§4.9.6, Main 실행)

[`../deploy/local.md`](../deploy/local.md) §2 절차 그대로다(백업 덤프 → 드롭·재생성 → migrate → 판매단가·품목·원가 임포트 → `data:verify --fresh`).
복원이 필요하면 같은 문서의 백업 덤프로 `pg_restore` 한다. 워커는 :3000 dev 서버와 `prami-postgres-1` 을 건드리지 않는다.
