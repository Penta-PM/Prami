# 계산기 STEP 2 소분류 줄 미표시 — 판정과 수정

- 요구사항: Main msg_fa0d4c7a843c (2026-10-12). 출처: Motion PR-4(#40) QA 비블로킹 백로그 4번.
- 검토: UI/UX·기능/기술 서브에이전트(main 7592ca3 기준). 판정 일치.

## 1. 판정: **결함** (계산기 최초 구현부터, 회귀 아님)

QA 추정("중분류 미선택 상태로 로드")은 원인이 아니다. **중분류를 골라도 소분류 줄은 절대 나타나지 않는다.**

- 표시 조건: `chips.hasMaster && mid && chips.minors.length > 0` (`src/features/calculator/QuoteSteps.tsx:92`).
- 페이지는 `listQuoteCategories(db, family)` 를 `mid` 없이 부르고(`src/app/(app)/calculator/page.tsx:31-33`),
  서버는 `mid` 가 없으면 `minors: []` 를 돌려준다(`src/server/quotes/catalog.ts:83-85`).
- 중분류 선택(`QuoteCalculator.tsx:341-345`)은 상태만 바꾸고 소분류를 다시 가져오지 않는다.
  전용 Server Action `listQuoteCategoriesAction`(`actions.ts:94-101`)은 PRAMI-001 PR-7(1460acd) 이후 **어디서도 호출되지 않는다**.
- 의도된 동작은 대/중/소 3단 필터다: STEP 제목 "대분류 / 중분류 / 소분류"(`QuoteSteps.tsx:66`), 무마스터 안내 "중/소분류로 좁힐 수 있습니다"(`:89`),
  품목 조회의 `minor` 필터(`catalog.ts:98`), README:263, Motion 스펙 "소분류 줄 첫 표시"(motion-interactions.md:206),
  같은 계층을 쓰는 `/pricing` 은 중분류 선택 시 소분류를 조회(`src/server/pricing/categories.ts:78-87`).
- 데이터에는 소분류가 있다(`items.category_minor`, 업로드 필수 열, 픽스처).
- Motion PR-3/PR-4 는 표시 조건을 바꾸지 않았다(원인 아님).
- 테스트 공백: 서버·UI 테스트 모두 `minors: []`/`hasMaster:false` 만, E2E 에 중·소분류 시나리오 없음.

**중분류 선택 전 소분류 줄이 없는 것은 정상**(계층형 필터, `/pricing` 과 일관). 고칠 대상은 "선택 후에도 안 보이는 것".

## 2. 기술 결정 (Plan 결정 — Dev는 이 결정을 따른다)

1. **서버 사전 적재(B안)**: `listQuoteCategories` 가 `minorsByMid: Record<string, string[]>` 를 함께 돌려준다.
   - 한 번의 DISTINCT (category_mid, category_minor) 쿼리. 마스터 적용 품목만(현행 중분류 목록과 같은 조건).
   - `null`·빈 문자열·공백만인 소분류는 제외. 각 배열은 현행 문자열 정렬 규칙과 같은 순서(중분류 목록과 동일 방식).
   - 클라이언트는 `minors = minorsByMid[mid] ?? []` 로 파생. 조회 대기·경합 없음, 로딩 상태 불필요.
   - 기각한 A안(선택 시 `listQuoteCategoriesAction` 호출): 경합 가드·지연 등장·레이아웃 밀림이 생긴다.
2. `CategoryChips` 의 `minors` 필드는 제거하고 `minorsByMid` 로 대체한다(파생값은 클라이언트에서). 호출처가 없는
   `listQuoteCategoriesAction` 과 서버 함수의 `selection.mid` 분기는 **제거**한다(죽은 코드). 관련 mock·테스트도 정리.
   - 단, 다른 호출처가 발견되면 제거하지 말고 Plan 에 알릴 것.
3. 기본 중분류 선택은 **하지 않는다**(현행 미선택 유지). 기본 선택은 STEP 3 품목을 사용자 모르게 좁힌다.
4. 중분류 선택 전 안내 문구는 **추가하지 않는다**(비범위). 결함 수정으로 줄이 정상 등장하므로 혼동 근거가 사라진다.
5. 선택한 중분류에 소분류가 없으면 줄을 숨긴다(현행 조건 유지, 에러 없음).
6. 중분류 변경·해제·제품군 변경 시 소분류 선택 해제(현행 유지). 품목 조회 `minor` 필터는 무변경.
7. Motion: CalculatorTabs fadeUp·`ChipMotion`/`Presence` 무변경. 소분류 줄 등장은 기존 규칙을 그대로 따른다.
8. 원가 필드는 클라이언트로 가지 않는다(기존 COST_KEYS 검사 유지).

## 3. 비범위

- 기본 중분류 선택, 안내 문구, 칩 디자인 변경, 다크 테마.
- `/pricing` 의 소분류 동작.

## 4. 수용 기준

- [ ] 마스터가 적용된 제품군에서 소분류가 1개 이상인 중분류 칩을 누르면 `role=group` "소분류" 줄과 그 중분류의 소분류 칩이 표시된다.
- [ ] 다른 중분류로 바꾸면 소분류 칩이 새 중분류 기준으로 바뀌고 소분류 선택이 해제된다.
- [ ] 같은 중분류를 다시 눌러 해제하거나 제품군을 바꾸면 소분류 줄이 사라진다.
- [ ] 소분류 칩을 누르면 `aria-pressed=true` 가 되고 STEP 3 품목 목록이 그 소분류로 좁혀진다(`listQuoteItemsAction` 에 `minor` 전달).
- [ ] 소분류가 없는(또는 빈 문자열만 있는) 중분류를 고르면 소분류 줄이 표시되지 않고 에러가 없다. 이름 없는 칩이 생기지 않는다.
- [ ] 첫 로드 시 중분류·소분류 모두 미선택이고 소분류 줄이 없다.
- [ ] 서버 단위 테스트: 마스터 적용 후 `minorsByMid[mid]` 가 그 중분류의 소분류만 정렬해 담고, 다른 중분류의 소분류·빈 값은 제외된다.
- [ ] UI 단위 테스트(`hasMaster:true` mock): 위 표시·전환·해제 동작.
- [ ] E2E: 마스터 적용 데이터에서 중분류 → 소분류 → 품목 목록이 좁혀짐 1시나리오.
- [ ] 탭 전환 fadeUp·첫 로드 무애니메이션 무변화(Motion PR-3/PR-4 테스트 통과).
- [ ] 클라이언트로 가는 페이로드에 원가 필드 없음(기존 검사 통과).
- [ ] Dev 게이트 기록(`docs/pipeline/verification.md` §3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3)

## 5. 태스크

1. [BE] `catalog.ts` — `minorsByMid` 적재, `selection.mid` 분기 제거, 서버 테스트.
2. [FE] `QuoteCalculator`/`QuoteSteps` — `minors` 파생, `listQuoteCategoriesAction` 제거, UI 테스트.
3. [E2E] 중→소→품목 시나리오(E2E 시드가 마스터를 적용하는지 확인, 없으면 시나리오 안에서 적용).

의존: 2 → 1, 3 → 2. PR 1개.

- 2026-10-12 Main 확인(msg_784fea0d4bd3): 판정·수정 방향, 기본 중분류 미선택 유지, 안내 문구 미추가, 작업 순서 모두 이의 없음.
