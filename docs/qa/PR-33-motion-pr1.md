# QA 기록 — PR #33 Motion 도입 PR-1 기반

- 대상: `feat/motion-pr1-foundation` @ `cc211ea` (base `origin/main` @ `90ffb86`)
- 판정: **통과 / 셀프머지 승인** (2026-10-02)
- 스펙: `docs/specs/motion-interactions.md` (origin/Plan) §6 공통 + PR-1

## 실행 환경
- 프로덕션 빌드 3종: PR 모션 on (:3002), PR `NEXT_PUBLIC_MOTION_DISABLED=1` (:3003), origin/main 기준 (:3004)
- Playwright 1.63 Chromium, axe-core 4.13
- E2E: Docker `prami-postgres-1` / `prami_e2e`, `E2E_PORT=3200` (main 대조는 3300)

## 수용 기준 대조
- [x] typecheck exit 0 / lint 경고 1건 — main 과 동일한 기존 경고(`wording-consistency.test.ts` 미사용 `vi`), 신규 0
- [x] 단위 테스트 150 files / 1723 tests 통과 (13 skip 은 main 과 동일)
- [x] E2E — PR 에서만 재현되는 실패 없음 (아래 백로그 2·3 참고)
- [x] `headers.ts`·`proxy.ts`·`next.config.ts` 변경 0, 실서버 응답 보안 헤더(CSP 포함)가 nonce 제외 main 과 동일
- [x] 콘솔: 3002·3003 `/login`·`/share/quotes/*` 에서 strict 모드 에러·hydration 경고 0
- [x] `"motion": "13.5.0"` 정확한 버전 고정
- [x] tokens.ts 값이 §3.1 과 일치 (tsx 로 import 해 덤프)
- [x] MotionProvider 를 루트 `<body>` 에 적용, `/login`·`/share` 에서도 해당 chunk 로드(200)
- [x] 플래그 빌드에서 `skipAnimations=!0`, `reducedMotion:"always"` 인라인. E2E dev 서버 환경변수에 플래그 들어감
- [x] playwright 두 config 에 `reducedMotion:'reduce'` 설정, smoke config 에는 webServer 없음
- [x] `tests/setup.ts` 에 `skipAnimations = true`, globals.css 에 reduced-motion 전역 규칙
- [x] press: GoogleButton 실측 rest `none` → 누르는 동안 `0.98`, 0.12s. reduce 설정 시 `1` / `1e-05s`. Button primary/secondary·CloseButton 은 빌드된 CSS 하네스로 같은 결과 확인
- [x] `button.tsx` 에 `"use client"` 없음
- [x] 외형 변화 없음: 1440×900 `/login`·`/share` 에서 main 대비 픽셀 차이 0

부가 확인: axe 위반 0, 텍스트 대비 16.13:1, 포커스 링 2px purple-500(대비 4.21:1), 320/768/1024/1440 폭에서 가로 오버플로 없음, 다크 테마 없음(스펙 비범위, 라이트·다크 픽셀 차이 0), smoke 8/8.

## 백로그 (비블로킹)
1. `prami_e2e` 를 실행 사이에 초기화하지 않아 `quotes`·`import_batches` 가 쌓인다. 데이터가 쌓인 DB 에서는 main 에서도 `items-master.spec.ts:33`("이미 업로드된 파일입니다")가 실패하고, `calculator.spec.ts:13` 은 간헐 실패한다.
2. `calculator.spec.ts:13` 경합: `QuoteCalculator.tsx:239-247` 이 `await refreshSaved()` 전에 저장 완료 문구를 띄워서, 테스트의 `.first()` 가 이전 견적을 담는다. main 에서도 같은 증상.
3. `company-key-warning.spec.ts:115/137` 간헐 실패: `/settings` 날짜 포맷이 서버와 클라이언트에서 달라 hydration 불일치. main 에서도 같음.
4. Dev 가 보고한 "62 passed / 2 failed, chat-llm:134 실패"는 재현되지 않음. chat-llm:134 는 매번 통과했다.
5. 플래그를 지정하지 않은 빌드에서는 `NEXT_PUBLIC_MOTION_DISABLED` 가 인라인되지 않고 런타임 `process.env` shim 으로 읽힌다. 결과(false)는 맞으므로 동작 문제는 아니다.
6. 번들 +117,738 B(+9.0%, motion chunk). 스펙의 domMax 예상 범위다.
7. `/share/quotes/<잘못된 토큰>` 이 Next 기본 404 페이지를 보여준다. main 에서도 같음, 범위 밖.
