# 스펙: Linux 환경 하이드레이션 실패 2건 정식 수정 (긴급)

- 요구사항 출처: Main `msg_5fd6b367307c` (2026-10-02, HIGH)
- 되묻기: `msg_68ec9a885ff1` — Main이 선택지 A 승인 + 결정 3 조건부
- 상태: 확정 (Plan) → Dev 배정. **Motion PR-2·3·4보다 먼저** 머지한다.

## 1. 목표

`http://192.168.1.156:3000`(LAN)에서 테스트 모드 로그인 후 버튼·등록 등 클라이언트 동작이 정상 작동하게 한다. 원인 2건을 정식으로 고치고, Main 워크트리의 커밋 안 된 임시 수정(`proxy.ts`, `next.config.ts`)을 대체한다.

## 2. 원인 진단 (검토로 확정, Main 수용)

| 증상 | 진짜 원인 | 근거 |
|---|---|---|
| LAN에서 HMR 웹소켓 실패, dev 오버레이 스택프레임 403 | `blockCrossSiteDEV`: 허용 origin이 `localhost` + `--hostname` 값(`0.0.0.0`)뿐이라 `192.168.1.156` 불일치 → `allowedDevOrigins` 미설정 | `node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js`, `router-server.js:207,336,669` (모두 `if (development)` 안) |
| `/settings` 버튼 먹통, "요소 75개 중 fiber 1개", E2E `company-key-warning.spec.ts:137` 실패·`chat-llm.spec.ts:134` flake | `LlmCredentialCard`('use client')가 SSR과 하이드레이션에서 다른 날짜 문자열을 렌더 → React recoverable error → dev 오버레이(별도 React root)가 클릭을 가로막음. `formatDateTime`(`src/features/settings/labels.ts:129-136`)이 `dateStyle/timeStyle:'short'`를 써서 ICU/CLDR 버전에 종속. 실측: Node 24.14(ICU 78) `26. 10. 2. PM 3:12` vs Chromium 153 `26. 10. 2. 오후 3:12`. 키 등록 후 `/settings` 재진입부터 발생 | 실측 + `LlmCredentialCard.tsx:193,197` |
| (요구사항 1의 가설) `proxy.ts` matcher가 `/_next/hmr`를 제외하지 않아 307 | **no-op.** HMR 업그레이드는 `router-server.js` `upgradeHandler`(658-700)에서 middleware(`resolveRoutes`, 715) **이전**에 처리. `/__nextjs_*`·dev `/_next/static`도 `hotReloader.run`(334-352)이 먼저 처리. `/_next/webpack-hmr`는 Next 16에 없음. HMR 실패는 `hydrateRoot`(`app-index.js:302`)를 막지 않음 | Next 16.3.6 소스 |

## 3. 동작 정의

### 3.1 `src/proxy.ts` — **변경 없음 (원복)**
- matcher는 main 그대로. 주석 1줄만 허용: "dev 전용 경로(`/_next/hmr`, `/__nextjs_*`)는 Next가 proxy 이전에 처리하므로 제외 불필요".
- `tests/unit/auth/boundaries.test.ts:99-113` 무변경 통과.

### 3.2 `next.config.ts` — `allowedDevOrigins`를 env로 공급
```ts
// dev 전용(Next가 development 분기에서만 참조). 운영 영향 없음.
allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean),
```
- 값은 **브라우저가 접속하는 서버 주소의 hostname**(예: `192.168.1.156`). 접속자 IP가 아니므로 서브넷 와일드카드 불필요.
- `NEXT_DIST_DIR` 선례(`next.config.ts:28`)대로 `src/env.ts` zod 스키마·`.env.example`·`docs/deploy/vercel.md` 표에 **등록하지 않는다** (`env-keys.test.ts` 1:1 검사 무변경). `.env.local`에만 기재.
- `package.json`에 `"dev:lan": "next dev --hostname 0.0.0.0"` 스크립트 추가 (기존 `dev`는 `127.0.0.1` 유지).

### 3.3 날짜 포맷 — CLDR 비의존 공용 유틸 `src/lib/date-format.ts` 신설
- `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', [second], hourCycle:'h23' })` 기반. **`dateStyle`/`timeStyle`/`hour12` 사용 금지** (주석으로 명시).
- export: `formatDateTime(iso|Date) → 'YYYY-MM-DD HH:mm'`, `formatDateTimeSeconds → 'YYYY-MM-DD HH:mm:ss'`, `formatDate → 'YYYY-MM-DD'` (모두 KST).
- `src/lib/audit-format.ts`의 `formatAuditTime`은 `formatDateTimeSeconds`로 위임(출력 불변, `hour12:false`→`hourCycle:'h23'`). 기존 `.slice(0,10)` 호출(`CartPanel.tsx:283`, `QuoteSheet.tsx:27`)은 `formatDate`로 치환.
- `src/features/settings/labels.ts:129-136`의 자체 `formatDateTime` 삭제 → 공용 유틸 사용. 영향: `LlmCredentialCard.tsx:193,197`, `AccountSection.tsx:41`. 표시 형식이 `26. 10. 2. 오후 3:12` → `2026-10-02 15:12`로 바뀜 (기존 8개 화면과 통일).
- `src/features/admin-policies/ImportFileRow.tsx:68` `createdAt.slice(0,10)`(UTC 날짜 → KST 00~09시 업로드가 전날로 표시) → `formatDate` 사용.
- 숫자 포맷(`toLocaleString('ko-KR')` 등 14곳)은 실측 동일 → 변경 금지.

### 3.4 문서
- `docs/deploy/local.md`: "LAN에서 dev 서버 열기" 절 추가 — `pnpm dev:lan`, `.env.local`의 `NEXT_DEV_ALLOWED_ORIGINS=<서버 주소 hostname>`, `AUTH_TEST_ALLOWED_HOSTS`에 LAN 주소 추가, 미설정 시 증상(서버 로그 `Blocked cross-origin request to Next.js dev resource`, 콘솔 HMR 오류).
- `README.md:66,97`, `.env.example:31`의 **"LAN 노출 시 테스트 모드 끌 것" 경고는 그대로 유지**(삭제·완화 금지). 그 아래에 보완 절차만 덧붙인다: "내부망 전용 호스트에서 의도적으로 켤 경우 `AUTH_TEST_ALLOWED_HOSTS`에 LAN 주소를 추가하고 강한 `AUTH_TEST_PASSWORD`를 쓸 것".

### 3.5 테스트
- 단위 추가: `tests/unit/lib/date-format.test.ts` — 고정 입력 `'2026-10-02T05:03:00Z'` → `'2026-10-02 14:03'` / `'2026-10-02 14:03:00'` / `'2026-10-02'`; 자정 `'2026-10-01T15:00:00Z'` → `'2026-10-02 00:00'` (24:00 금지); `src/` grep 가드 테스트 — `dateStyle|timeStyle` 사용 0건, 인자 없는 `toLocaleString()/toLocaleDateString()/toLocaleTimeString()` 0건.
- `tests/unit/settings/settings-page.test.tsx` fixture(`:110` `lastVerifiedAt`)에 "마지막 검증" 텍스트 단언 추가.
- E2E 카나리: `tests/e2e` 공용 헬퍼(`loginAs` 등)에 페이지 콘솔 `Hydration failed`/`hydration` recoverable error 감지 시 테스트 실패하도록 추가. 의도적 불일치를 주입했을 때 실패하는지 Dev가 1회 수동 확인(커밋 금지).
- 무변경 통과: `tests/unit/auth/boundaries.test.ts`, `tests/unit/env-keys.test.ts`, `tests/unit/security/next-config.test.ts`.
- 재검증 E2E: `company-key-warning.spec.ts`, `chat-llm.spec.ts`, `settings-llm.spec` 연속 3회.

## 4. 기술 결정 요약 (Dev는 이 결정을 따릅니다)
1. `proxy.ts` matcher 원복. 보안 범위(CSP·인증) 변동 0.
2. `allowedDevOrigins` ← `NEXT_DEV_ALLOWED_ORIGINS` env, 스키마 미등록, `dev:lan` 스크립트.
3. 날짜는 `src/lib/date-format.ts`(sv-SE 숫자 필드 + `hourCycle:'h23'` + `Asia/Seoul`), `audit-format.ts`는 위임, `labels.ts` 자체 포맷터 삭제.
4. 1개 PR, 커밋 2개(`fix(dev): LAN dev origin via NEXT_DEV_ALLOWED_ORIGINS`, `fix(settings): CLDR 비의존 날짜 포맷 + ImportFileRow KST`). 브랜치 `fix/linux-hydration`. Motion #33과 파일 겹침 0 — **먼저 머지**, 이후 #33 rebase.

## 5. 비범위
- `QuotePdf.tsx:93` PDF 날짜 서식(`2026. 10. 02.`) — 별도 판단.
- 숫자 포맷.
- `src/proxy.ts` matcher 변경, `/__nextjs_*` 제외.
- 테스트 모드 LAN 경고 문구 완화.

## 6. 수용 기준 (QA)

### 사용자 경로 (필수 — Main 지정)
- [ ] Linux 호스트에서 `pnpm dev:lan`, `.env.local`에 `NEXT_DEV_ALLOWED_ORIGINS=192.168.1.156`, `AUTH_TEST_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.156`로 기동. 다른 PC 브라우저에서 `http://192.168.1.156:3000/login` → 테스트 계정 로그인 → `/`로 이동.
- [ ] 같은 세션에서 클라이언트 동작 3종 모두 반응: 사이드바 접기 토글 → 폭 변화 / 헤더 "챗봇" → ChatDock 열림 / `/pricing` 또는 `/admin/costs` "+ 등록" → 모달 열림.
- [ ] LLM 키 등록·검증 후 `/settings` 재진입: 오버레이 없음, "마지막 검증"이 `YYYY-MM-DD HH:mm` 형식, 콘솔 `Hydration failed` 0건, "마지막 로그인"에 영문 `PM/AM` 없음.
- [ ] 네트워크 탭 `/_next/hmr` 101 Switching Protocols, 콘솔 `[HMR] connected`, 서버 로그 `Blocked cross-origin request` 0건 — localhost와 LAN 양쪽.

### 검증 프로토콜 (원인 확정)
- [ ] `proxy.ts` matcher가 main과 동일(diff 0, 주석 제외)한 상태에서 `rm -rf .next` 후 localhost·LAN 모두 위 사용자 경로 통과. **통과하지 못하면 제3 원인을 추적해 Plan에 보고**(임시 matcher 제외로 우회 금지).

### 보안 범위
- [ ] 비로그인 `/pricing` → 307 `/login?callbackUrl=…`, `/api/chat/status` → 401 JSON, 응답 헤더에 `Content-Security-Policy`·`x-request-id` 존재. `/share/quotes/<token>` CSP 유지.
- [ ] `next build && next start`에서 `allowedDevOrigins` 설정이 동작·헤더에 영향 없음.
- [ ] README/.env.example의 테스트 모드 LAN 경고 문구가 유지되고 보완 절차만 추가됐다.

### 날짜
- [ ] `src/lib/date-format.ts` 단위 테스트 통과(고정 출력, 자정 `00:00`).
- [ ] `src/`에 `dateStyle`/`timeStyle`·인자 없는 `toLocale*String()` 0건 (가드 테스트).
- [ ] `/admin/users`, `/admin/audit`, 견적 목록, 공유 모달 만료 시각의 기존 표시가 변하지 않았다.
- [ ] `ImportFileRow` 업로드일이 KST 기준 날짜로 표시된다 (단위 테스트: `'2026-10-01T20:00:00Z'` → `'2026-10-02'`).
- [ ] `company-key-warning.spec.ts`, `chat-llm.spec.ts`, `settings-llm.spec` 연속 3회 통과.

### 공통
- [ ] `pnpm lint` 경고 0, 단위·E2E 전부 통과. `env-keys.test`, `boundaries.test`, `next-config.test` 무변경 통과.
- [ ] `src/env.ts`, `.env.example`, `docs/deploy/vercel.md`에 `NEXT_DEV_ALLOWED_ORIGINS` 미등록(의도).

## 7. 태스크
1. **[커밋 1]** `next.config.ts` `allowedDevOrigins` env 공급, `dev:lan` 스크립트, `docs/deploy/local.md` LAN 절, README/.env.example 보완 절차. `proxy.ts` 무변경 확인.
2. **[커밋 2]** `src/lib/date-format.ts` 신설, `audit-format.ts` 위임, `labels.ts` 포맷터 삭제, `ImportFileRow` KST, `.slice(0,10)` 치환, 단위 테스트·가드 테스트·settings 텍스트 단언, E2E 하이드레이션 카나리.
3. **[검증]** 6절 검증 프로토콜 수행 후 PR 본문에 결과(localhost·LAN, `rm -rf .next` 후) 기록. QA 검증 요청.
의존 관계: 1·2 독립, 3은 1·2 이후. PR 1개.
