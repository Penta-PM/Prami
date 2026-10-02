# QA 기록 — PR #34 Linux 하이드레이션 실패 2건 정식 수정

- 대상: `fix/linux-hydration` @ `7da54a2` (base `origin/main` @ `90ffb86`)
- 판정 (1차, 2026-10-02): **반려 / CRITICAL 1건** — 수용 기준 §6 공통 "pnpm lint 경고 0" 미충족
  - 경고 1건 `tests/unit/chat/wording-consistency.test.ts` 2:53 미사용 `vi`. main 에도 같은 경고가 있다 (PR 이 새로 만든 경고 아님)
  - 해소: (a) 미사용 import 제거, 또는 (b) Plan 이 "새 경고 0"이 의도라고 확인. 그 외 항목은 모두 실측으로 통과

## 실측 요약
- 브라우저 확인: `pnpm dev:lan -p 3200` 을 localhost 와 192.168.1.156 양쪽에서. dist 를 지운 뒤 기동
  - 로그인 → `/`, 클라이언트 동작 3종(사이드바·챗봇·등록 모달) 모두 반응
  - `/settings` 재진입: 오버레이 0, Hydration 0, "마지막 검증" `YYYY-MM-DD HH:mm`
  - HMR: 101 Switching Protocols, `[HMR] connected`, Blocked 0
  - 대조 실험: `NEXT_DEV_ALLOWED_ORIGINS` 를 빼면 Blocked cross-origin 이 발생하고 HMR 이 실패함 (원인 확정)
  - main 에서는 `/settings` 재진입 시 `오후` vs `PM` 불일치로 hydration 실패가 재현됨
  - 기존 날짜 표시(사용자 관리·감사 로그·견적 목록·공유 만료) 형식이 main 과 같음
- 테스트·서버:
  - typecheck 통과, 단위 1717 통과(부하 flake 1건은 단독 재실행 시 통과)
  - E2E 격리 DB 66/66, 문제의 세 스펙 연속 3회 12/12
  - prod 빌드 보안 헤더가 main 과 같음(nonce 제외), 307/401 동작 확인
  - 카나리에 불일치를 주입하면 테스트가 실패함
- "다른 PC" 경로는 같은 호스트에서 LAN IP 로 접속해 대신 확인 (서버가 받은 Host/Origin 이 LAN 값)

## 백로그 (비블로킹)
1. 가드 정규식: 같은 줄에 `'a//b'` 같은 문자열 리터럴이 있으면 뒤의 dateStyle 을 놓친다. `hour12`·`toLocale*String(undefined)`·`weekday:'long'` 은 가드 범위 밖
2. 카나리: `loginAs` 끝의 `expectNoHydrationErrors` 는 도착 페이지가 hydrate 되기 전에 실행된다. 짧은 테스트는 불일치를 놓친다
3. 검증 안내의 fake 키 예시가 최소 16자 제한에 걸릴 수 있다
4. 새 `NEXT_DIST_DIR` 로 `next dev` 를 띄우면 tsconfig.json 이 자동 수정된다 (Next 기본 동작)
5. 단위 테스트 `llm-diagnostics-r2.test.ts:262` 가 고부하에서 간헐 실패한다 (PR 무관)
