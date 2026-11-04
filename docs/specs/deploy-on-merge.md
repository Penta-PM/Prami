# 머지 즉시 :3000 반영 — 미리보기 절차·띠 폐지

- 요구: Main msg_a74912d3a09c (2026-11-04). 사용자 "미리보기중 이런거 하지마 그냥 배포해".
- 대체: `docs/specs/preview-on-3000.md`(2026-10-30, PR-PV #110) 전체를 폐지합니다.
- 범위: "배포"는 LAN :3000(Dev 워크트리 `pnpm dev:lan`)에 main을 반영하는 것입니다. Main 요구 문구는 "main에 반영되고 :3000에 보이길"입니다. Vercel 운영 배포는 이번 범위가 아닙니다.
- 제약은 그대로 둡니다. QA 생략 모드, 보안 규칙, LAN DB(추가형만 · `pg_dump` 백업 선행)를 유지합니다.
- 병렬 검토: UI/UX 검토와 기능/기술 검토가 서로 상충하지 않았고, 두 결과를 보완 관계로 함께 반영했습니다.

## 1. 새 기본 흐름
```
Plan 배정 → Dev 구현(작업 워크트리) → Dev 게이트 → PR(ci:run 라벨) → 셀프머지(CI 대기 없음)
  → [마이그레이션 있으면 백업 → LAN 적용] → :3000 = origin/main 반영 → Main 에 머지·반영 보고
  → CI 결과 확인(빨강이면 수정 PR)
```
- 작업 브랜치를 :3000에 띄우지 않습니다. 사용자 확인을 기다리는 단계도 없습니다.
- :3000 워크트리(Dev)에는 **origin/main SHA(detached)만** 체크아웃합니다. 띠가 없어 화면으로는 구분할 수 없으므로 규칙으로 지킵니다.
- "확인 후 머지" 예외는 두지 않습니다(지시: "하지마"). 사용자가 특정 건에서 직접 다시 요청하면 그때 Main 요구사항으로 받습니다.

## 2. CI 게이트 — Plan 결정: B′ (CI는 돌리되 머지를 막지 않음)
| 안 | 사용자 대기 | E2E 전체 | 변경량 |
|---|---|---|---|
| A. 현행(머지 전 CI 녹색) | 머지마다 약 15–20분 | 머지 전 | 없음 |
| **B′. PR에 `ci:run`, Dev 게이트 후 바로 머지** | **0** | 머지 후 약 17분 안 | 문서만 |
| B2. main push 트리거 추가 | 0 | 머지 후 | ci.yml · workflows.test · 스펙 |
| C. CI 폐지 | 0 | **없음** | 문서 |

- 근거: QA 생략 모드에서는 E2E 전체가 CI e2e 잡에서만 돕니다. CI를 아예 끄면 회귀를 사용자가 :3000에서 처음 발견하게 됩니다. B′는 사용자 대기를 0으로 만들면서 이 안전망을 지킵니다.
  - 무거운 CI 실행 최근 약 20건: 중앙값 약 17분, 실패 1건.
  - main은 브랜치 보호가 없어 머지가 기술적으로 막히지 않습니다. PR merge ref에서 시작된 CI는 머지 뒤에도 끝까지 돕니다.
- 운영 규칙:
  - Dev는 PR을 올릴 때 `ci:run` 라벨을 붙입니다. Dev 게이트(`verification.md` §3.1)가 끝나면 CI 결과를 기다리지 않고 머지합니다.
  - 머지 보고에 CI run URL(진행 중)을 넣습니다.
  - CI가 빨강이면 Dev가 즉시 수정 PR을 올리고 Main에 한 줄로 알립니다. 수정이 오래 걸리면 revert PR을 올립니다. flake는 기존 §4 분류를 따릅니다.
- 문서 전용 PR은 기존대로 경량 CI만 탑니다.
- CI 완전 폐지(C)는 사용자가 명시적으로 지시할 때만 합니다.

## 3. 머지 후 :3000 반영 절차 (Dev)
1. `git -C <Dev 워크트리> fetch origin`
2. 마이그레이션이 있으면:
   - LAN DB를 `pg_dump`로 백업합니다(경로를 보고).
   - origin/main 코드로 `pnpm db:migrate`를 실행합니다. 추가형만 허용합니다.
   - 저널 항목 수와 핵심 행 수를 대조합니다.
   - **적용은 체크아웃 전환 전에 합니다.** 새 코드가 아직 없는 테이블을 읽으면 안 되기 때문입니다.
3. `git -C <Dev 워크트리> checkout --detach origin/main`
4. lockfile이 바뀌었으면 `pnpm install --frozen-lockfile --offline`을 실행합니다.
5. `/login` 200과 dev 서버 로그에 컴파일 오류가 없는지 확인합니다.
   - 실패하면 직전 main SHA로 되돌리고 Main·Plan에 보고합니다.
   - :3000 프로세스 재시작은 기존대로 사전 승인된 경우에만, PID나 포트로 그 프로세스만 종료해 합니다.
6. Main 보고에 다음을 넣습니다: `:3000 = main @ <SHA7>, /login 200`, 볼 곳 1–2줄, CI run URL, DB 영향(없음 또는 백업 경로).
- Main이 직접 머지한 건(예: #111)은 머지한 쪽이 반영합니다. Main이 반영하지 못하면 Plan을 거쳐 Dev에 요청합니다.

## 4. 제품 코드 제거 (PR-RM)
- 삭제:
  - `src/components/PreviewBanner.tsx`
  - `src/server/dev/preview.ts` (폴더째)
  - `tests/unit/dev/preview-banner.test.tsx` (폴더째)
- 수정:
  - `src/app/layout.tsx`: PreviewBanner import와 마운트(주석 포함)를 제거합니다.
  - `playwright.config.ts`: `PREVIEW_BANNER: 'off'`와 주석을 제거합니다. `E2E_ENV`의 다른 키는 유지합니다.
- 건드리지 않음: 이름만 비슷하고 관계없는 것들입니다.
  - `.github/workflows/preview-*.yml`, `docs/deploy/*`, `.env.example`의 Vercel preview
  - README의 엑셀 임포트 "미리보기"
- 띠는 일반 흐름 안의 28px 블록이었고 보정 CSS가 없어 남는 여백이 없습니다.

## 5. 문서 반영
- main (PR-RM과 같은 PR):
  - `CLAUDE.md`: `:3000 미리보기 선반영` 블록을 제거하고 "머지 즉시 :3000 반영"(§1–§3 요약)으로 바꿉니다. 상태 목록에서 `미리보기 확인중`을 제거합니다.
  - `docs/pipeline/verification.md`:
    - §2.5를 제거하고 §3 절차로 대체합니다.
    - §3의 "LAN :3000이 Dev 워크트리를 서빙할 때" 중 미리보기·머지 전 적용 분기를 정리해 머지 후 적용 한 경로로 만듭니다(백업 선행·추가형은 유지).
    - §3.3 CI 문구를 B′로 고칩니다.
- Dev 브랜치 `CLAUDE.md`(origin/Dev):
  - 미리보기 절을 제거하고 §3 절차를 넣습니다.
  - 작업흐름 단계(ci:run → 머지 → 보고)를 B′ 순서로 고칩니다.
  - ":3000 워크트리는 origin/main detached 외 체크아웃 금지"를 추가합니다.
- Plan `CLAUDE.md`: 배정 형식의 "미리보기 볼 곳"을 "반영 후 볼 곳"으로 바꾸고, 선반영 절과 수용 기준 표준 문구를 고칩니다(Plan이 커밋합니다).
- `docs/specs/preview-on-3000.md`는 지우지 않고 "폐지" 표시만 남깁니다(이력 추적용).

## 6. 수용 기준
- [ ] main에서 `git grep -n "PreviewBanner\|PREVIEW_BANNER\|server/dev/preview"`가 0건
- [ ] :3000 화면 상단에 노란 띠가 없고, `<body>` 첫 자식이 MotionProvider
- [ ] main `CLAUDE.md`와 `docs/pipeline/verification.md`에 ":3000 미리보기", "미리보기 확인중", "[미리보기 준비됨]"이 없음(Vercel preview·임포트 미리보기는 남음)
- [ ] origin/Dev `CLAUDE.md`에 §3 반영 절차와 B′ 규칙이 있고, 미리보기 절이 없음
- [ ] 이 PR 자체를 새 흐름으로 처리: Dev 게이트 → `ci:run` 붙여 바로 머지 → :3000 = main 반영 보고(SHA·/login 200·CI URL)
- [ ] 머지 후 CI 녹색(빨강이면 수정 PR까지 완료)

## 7. 진행 기록
- 2026-11-04 스펙 확정, Dev 배정(PR-RM).
- 2026-11-04 #112 PR-RM 머지(main 57ff8b5) — 새 흐름(B′) 첫 적용. Dev 게이트 SHA 7fac604 녹색 → ci:run 부착 → CI 대기 없이 머지 → :3000 = main @ 57ff8b5, /login 200, 띠 0건. DB·lockfile 변경 없음. Dev CLAUDE.md origin/Dev 56bd0ca.
  - Dev 해석 수용: verification.md §5 표준 문구·§3 3번(SHA 대조 = Dev 게이트 SHA)도 B′ 에 맞춤. QA 승인 형식(§2)은 QA 생략 모드라 유지.
  - 머지 후 CI run 41777372740 — 결과는 Dev 가 한 줄로 알림.
