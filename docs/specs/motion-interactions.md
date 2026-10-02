# 스펙: Motion 도입 — 인터랙션 요소 모션 추가

- 요구사항 출처: Main `msg_93675eb3d8be` (2026-10-02)
- 상태: 확정 (Plan) → Dev 배정
- 검토: UI/UX 검토 + 기능/기술 검토 (병렬) 합성

## 1. 목표

사용자 조작에 반응하는 UI(오버레이, 전환, 피드백, 목록)에 `motion` 라이브러리 기반의 **절제된** 모션을 추가해 화면이 부드럽게 느껴지게 한다. 공용 토큰과 래퍼로 화면 전반의 느낌을 통일하고, `prefers-reduced-motion`을 존중하며, 기존 단위·E2E 테스트가 깨지거나 flaky해지지 않게 한다.

## 2. 코드 현황 (검토로 확인된 사실)

| 항목 | 사실 | 근거 |
|---|---|---|
| 애니메이션 라이브러리 | 없음. Tailwind transition 5개 파일 (`button.tsx`, `segmented.tsx`, `GoogleButton.tsx`, `ProductCards.tsx`, `Sidebar.tsx`) | grep |
| 헤드리스 UI | 없음 (Radix 등 미사용). 프리미티브는 `src/components/ui/` | 디렉터리 |
| 모달 | 네이티브 `<dialog>` + `showModal()`. 호출부 약 15곳이 `{x ? <XModal/> : null}` 조건부 마운트 | `components/ui/modal.tsx`, `CostBrowser.tsx:71`, `QuoteCalculator.tsx:404` 등 |
| 드로어 | `if (!open) return null`, 자체 포커스 트랩·복원. 사용처 `RowDetailDrawer` 1곳 | `components/ui/drawer.tsx` |
| 챗 패널 | `if (!isOpen) return null`. `ChatDock`의 FAB와 교대 마운트 | `chat/ChatPanel.tsx`, `chat/ChatDock.tsx` |
| 탭 | `Segmented`(`CalculatorTabs`), Link 기반 RSC `FamilyTabs`. `role="tab"` 없음 | — |
| 토스트·드롭다운·메뉴·팝오버·아코디언 | **코드에 없음**. 셀렉트는 네이티브 `<select>`, 알림은 인라인 `role="alert|status"` 약 35곳 | grep 0건 |
| 표 | 가격·원가·감사 표는 서버 페이지네이션(50행, `router.push`) | `PricingFilters.tsx`, `queries.ts:13` |
| 다크 테마 | **없음** (`globals.css` 주석, `dark:`/`prefers-color-scheme` 0건) | — |
| reduced-motion CSS | 없음 | `globals.css` |
| CSP | `style-src 'self' 'unsafe-inline' cdn`, style에 nonce 없음. script는 nonce+strict-dynamic | `src/server/security/headers.ts:23` |
| 루트 레이아웃 | `src/app/layout.tsx` async RSC, Provider 없음. `(app)/layout.tsx`에 ChatProvider만. `login`·`share`는 `(app)` 밖 | — |
| 패키지 매니저 | pnpm 10.x, 의존성 정확한 버전 고정 관례 | `package.json` |
| motion | 최신 `13.5.0`, peer react ^18‖^19 → React 19.3 / Next 16.3 호환. 엔트리 `motion/react`, `motion/react-client`, `motion/react-m` | npm view |

## 3. 동작 정의

### 3.1 모션 토큰 (`src/lib/motion/tokens.ts`, 순수 TS — CSS 변수 추가 금지)

| 토큰 | 값 | 용도 |
|---|---|---|
| `duration.fast` | 0.12s | press, 라벨 fade, 색 |
| `duration.base` | 0.18s | fade, 배너, 탭 콘텐츠, 챗 버블 |
| `duration.enter` | 0.24s | 모달·드로어·챗 패널 진입 |
| `duration.exit` | 0.16s | 모든 퇴장 (진입의 약 70%) |
| `duration.layout` | 0.28s | 목록 재배치 |
| `ease.standard` | `[0.2, 0, 0, 1]` | 일반 |
| `ease.enter` | `[0.05, 0.7, 0.1, 1]` | 진입(감속) |
| `ease.exit` | `[0.3, 0, 0.8, 0.15]` | 퇴장(가속) |
| `spring.layout` | `{ type: "spring", stiffness: 500, damping: 40 }` | layout, layoutId 인디케이터 (바운스 없음) |

프리셋 variants (같은 파일): `fade`, `fadeUp`(y 6px), `scaleIn`(0.96→1), `slideRight`(x 24px + fade), `listItem`(height auto↔0 + fade). 이동 거리는 4–8px, 모달 scale 0.96→1, 드로어·챗 패널 x 24px + fade. **바운스 있는 spring 금지.**

> `tests/unit/tokens.test.ts`가 CSS 토큰 개수를 검사하므로 모션 토큰은 TS 모듈로만 둔다.

### 3.2 Provider / 래퍼 (`src/components/motion/`)

- `MotionProvider.tsx` (`"use client"`): `<LazyMotion features={domMax} strict>` + `<MotionConfig reducedMotion="user" transition={base}>`. **루트** `src/app/layout.tsx`의 `<body>` 바로 안쪽에 둔다 (login·share도 포함). `nonce`는 넘기지 않는다 (style-src에 nonce를 넣으면 `unsafe-inline`이 무효화됨).
- 모션 비활성 플래그: `NEXT_PUBLIC_MOTION_DISABLED=1`이면 Provider가 `MotionGlobalConfig.skipAnimations = true` + `reducedMotion="always"`로 동작한다. E2E 전용.
- `Presence.tsx`: `<AnimatePresence initial={false}>` 래퍼. 기본 `mode="sync"`; `popLayout`은 쓰지 않는다.
- import 규칙: 클라이언트 파일에서 `motion/react`의 `m.*`만 사용. `motion.*` 혼용 금지(strict 모드라 런타임 에러). RSC 파일에서 `motion/react-client` 사용 금지 — 모션은 항상 `"use client"` 컴포넌트 안에서만.

### 3.3 요소별 동작

| 요소 | 파일 | 동작 | 우선 |
|---|---|---|---|
| 버튼 press | `ui/button.tsx`, `modal.tsx` `CloseButton`, `GoogleButton.tsx`, `ChatPanel` ChipRow, `ChatDock` FAB | **CSS로만**: `active:scale-[0.98] transition-[transform,colors] duration-[120ms] motion-reduce:transform-none`. Motion 사용 금지 (Button은 서버 호환 유지, `"use client"` 붙이지 않음). hover는 기존 색 변화 유지 | P1 |
| 링크·표 행·텍스트 링크 | Sidebar 링크, `FamilyTabs`, `TableRow` | **추가 안 함** (색 전환만). scale·lift 금지 | — |
| 모달 | `ui/modal.tsx` + 호출부 약 15곳 | 진입: 내부 패널 `scaleIn` + fade (`enter`). 퇴장: `exit` 토큰. 애니메이션 대상은 `<dialog>` 내부 래퍼 `m.div` (dialog 자체에 transform 금지 → top-layer·포커스 트랩 유지). `::backdrop`은 CSS transition(`@starting-style`로 진입, 퇴장은 dialog에 `data-closing` 속성을 걸어 opacity 0으로 전환 후 `close()`). Esc: `cancel` 이벤트 `preventDefault` → 퇴장 애니메이션 → `onClose` 1회. **"사용자 행동 1회 = onClose 1회" 불변식 유지** (`modal.tsx:17`). 호출부는 `{x ? <XModal/> : null}`을 `<Presence>{x ? <XModal/> : null}</Presence>`로 감싸 프로그램적 닫힘(제출 성공 등)에도 퇴장이 보이게 한다. 퇴장 시작 시점에 `pointer-events:none` + 포커스를 트리거로 즉시 복원 | P1 |
| 드로어 | `ui/drawer.tsx`, `pricing/RowDetailDrawer.tsx` | `open` prop 유지. 패널 `slideRight`(x 100% → 0, enter/exit), 오버레이 fade. `useRestoreFocus`는 언마운트가 아니라 **퇴장 시작** 시점에 포커스를 복원하도록 변경. 퇴장 중 `inert` | P1 |
| 챗 패널 + FAB | `chat/ChatPanel.tsx`, `chat/ChatDock.tsx` | `Presence`로 패널 x 24px + fade 진입·퇴장, FAB scale/fade 교대. 패널 재오픈 시 기존 메시지는 애니메이션 없음 (`initial={false}`) | P1 |
| 모바일 사이드바 오버레이 | `shell/Sidebar.tsx` | **CSS transition 유지** (기존 translate). 백드롭 fade만 CSS로 추가. `max-md:invisible` 동작 유지 (`a11y-responsive.spec.ts` `toBeHidden`) | P2 |
| 사이드바 접기/펼치기 | `shell/Sidebar.tsx` | 폭은 **CSS `transition-[width]` 유지** (200ms, 변경 금지 — `shell.spec.ts:29-35` boundingBox 단언). 라벨·"관리자" 헤더는 **펼칠 때만 fade-in(`fast`), 접을 때는 즉시 제거**(main과 같은 동작, 9.3절). 링크에 `overflow-hidden` 추가 금지. Motion `layout` 금지 | P2 |
| 세그먼트 탭 | `ui/segmented.tsx` | 활성 pill을 `layoutId` + `spring.layout`으로 슬라이드. 색은 CSS 유지 | P2 |
| 탭 콘텐츠 | `calculator/CalculatorTabs.tsx` | 새 콘텐츠 `fadeUp`(y 4px, `base`) 진입만. `mode="wait"` 금지 (입력 지연) | P2 |
| 인라인 성공·에러 배너 (토스트 대체) | `GroupsManager.tsx`, `NoticesAdminTable.tsx`, `UsersTable.tsx`, `LlmSection.tsx`, `ImportPanel.tsx` 등 `role="status|alert"` | `Presence` + `listItem`(height auto + fade, `base`). `aria-live` 속성 유지. shake 금지 | P2 |
| 폼 에러 | `PolicyFormModal.tsx`, `Cost*Modal.tsx`, `UserFormModal.tsx`, `GroupFormModal.tsx` 등 `role=alert` | 위와 동일 (fade + height). shake 금지 | P2 |
| 챗 메시지 | `chat/ChatPanel.tsx` Bubble, "답변을 찾는 중…" | 새 버블만 마운트 시 1회 `fadeUp`(y 8px, `base`). **`layout` 금지** (스트리밍 토큰마다 재계산). 자동 스크롤은 기존 즉시 이동 유지 | P2 |
| 클라이언트 목록 추가·삭제 | `calculator/CartPanel.tsx` lines, `parts/PartsEditor.tsx` 선택 목록, `calculator/QuoteSteps.tsx` 칩 | `Presence` + `m.li layout` + `listItem` variants, `duration.layout` | P2 |
| `FamilyTabs` 밑줄 인디케이터 | `parts/FamilyTabs.tsx` (RSC) | 인디케이터만 작은 client 컴포넌트로 분리해 `layoutId`. 링크·데이터 흐름은 RSC 유지 | P3 |
| 카드 hover | `home/ProductCards.tsx` | 기존 shadow 유지 + CSS `hover:-translate-y-0.5` | P3 |
| `GroupsManager` 그룹 목록 | `GroupsManager.tsx` | 신규·삭제 항목 fade + `m.li layout`(`duration.layout`) 재배치 (9.4절) | P3 |

### 3.4 금지 규칙 (Dev·QA 공통)

1. 서버에서 렌더되는(페이지 로드 시 보이는) 요소에 `initial={{opacity:0}}` 등 숨김 initial 금지 — JS 로드 전 내용이 안 보이고 hydration 불일치 위험. 모션은 **사용자 조작으로 마운트·전환되는 요소에만**.
2. 표 `<tr>`에 `layout`/transform 금지. 서버 페이지네이션 표(`PriceTable`, `CostBrowser`, `AuditTable`)는 모션 대상이 아님.
3. 스트리밍 중인 챗 버블에 `layout` 금지.
4. 색(배경·글자·보더)은 Motion으로 애니메이션하지 않는다. CSS `transition-colors`로 둔다 (추후 다크 테마 대비).
5. `AnimatePresence mode="popLayout"` 금지 (`<style>` 주입). `mode="wait"`는 탭 콘텐츠에 금지.
6. CSP(`headers.ts`) 변경 금지. `MotionConfig nonce` 금지.
7. 사이드바 폭·모바일 translate는 CSS 유지.
8. 바운스 있는 spring, 300ms 초과 duration 금지 (layout 0.28s 제외).

### 3.5 prefers-reduced-motion

- Motion: `MotionConfig reducedMotion="user"` → transform·layout 이동은 즉시, opacity fade만 남음 (Motion 기본 동작).
- CSS: `globals.css`에 `@media (prefers-reduced-motion: reduce)` 전역 규칙 추가 — `*, ::before, ::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }` 수준. Tailwind 쪽은 `motion-reduce:` 변형을 함께 사용.

### 3.6 테스트 전략

- **E2E (Playwright)**: `playwright.config.ts`(및 smoke config)의 `use`에 `reducedMotion: 'reduce'` 추가 + `webServer.env`에 `NEXT_PUBLIC_MOTION_DISABLED=1`. 두 겹으로 애니메이션을 완전히 끈다. 기존 `toBeHidden`/`toHaveCount(0)`/axe color-contrast 스펙(11개)이 변경 없이 통과해야 한다.
- **단위 (Vitest/jsdom)**: `tests/setup.ts`에 `MotionGlobalConfig.skipAnimations = true`. `matchMedia` 목킹은 불필요(가드됨). 사라짐을 동기 단언하는 테스트(17개 파일: `tests/unit/ui.test.tsx`, `shell.test.tsx`, `chat/panel*.test.tsx`, `costs/ui.test.tsx`, `pricing/ui.test.tsx` 등)는 필요한 곳만 `waitFor`/`waitForElementToBeRemoved`로 바꾼다. 단언 의도는 바꾸지 않는다.
- 모션 자체의 단위 테스트: `tokens.ts` 값 스냅샷, `MotionProvider`가 플래그에 따라 `skipAnimations`를 켜는지, Modal `cancel` 가로채기 후 `onClose`가 정확히 1회 호출되는지.

## 4. 기술 결정 요약 (Dev는 이 결정을 따릅니다)

1. `pnpm add motion@13.5.0` (정확한 버전 고정).
2. `LazyMotion strict` + `domMax` + `m.*`. 번들 영향: 초기 ~4.6kb + domMax ~25kb (gz).
3. 토큰은 `src/lib/motion/tokens.ts` TS 모듈. 래퍼·Provider는 `src/components/motion/`.
4. Provider는 루트 `app/layout.tsx`. 환경 플래그 `NEXT_PUBLIC_MOTION_DISABLED`.
5. 모달 퇴장은 (a) Modal 내부 `cancel` 가로채기 + 내부 래퍼 `m.div` + (b) 호출부 `<Presence>` 감싸기 — 두 가지 모두 적용.
6. 버튼 press는 CSS. Motion 사용 금지.
7. 사이드바 폭·모바일 오버레이는 CSS 유지.
8. 색 전환은 CSS 유지.

## 5. 비범위 (Non-goals)

- 토스트 시스템, 드롭다운·메뉴·팝오버, 아코디언 신설 — 코드에 없음. 필요하면 별도 요구사항.
- 다크 테마 — 코드에 없음. 이번 검증은 라이트 테마만. (색을 Motion으로 다루지 않으므로 추후 다크 도입 시 토큰 교체로 대응 가능)
- 페이지 진입(로드) 애니메이션, 라우트 전환 애니메이션, 스켈레톤·`loading.tsx`.
- 서버 페이지네이션 표의 행 재배치 애니메이션.
- 헤더 종 아이콘(기능 없음), `error.tsx`.
- `src/proxy.ts` HMR matcher / `next.config.ts` `allowedDevOrigins` 수정 — Main이 별도 요구사항으로 보낼 예정. **이 PR들에 포함하지 않는다.**

## 6. 수용 기준 (QA 검증 항목)

### 공통 (모든 PR)
- [ ] `pnpm lint`, `pnpm typecheck`(있으면), 단위 테스트, 기존 E2E 전부 통과. 새 lint 경고 0.
- [ ] `src/server/security/headers.ts`의 CSP 문자열이 변경되지 않았다.
- [ ] `src/proxy.ts`, `next.config.ts`의 변경이 없다.
- [ ] 브라우저 콘솔에 Motion strict 모드 에러(`motion.* used inside LazyMotion strict`)나 hydration 경고가 없다.

### PR-1 기반
- [ ] `package.json`에 `motion`이 정확한 버전(`13.5.0`)으로 추가됐다.
- [ ] `src/lib/motion/tokens.ts`가 3.1의 토큰·프리셋을 export 한다.
- [ ] `src/app/layout.tsx`에서 `<body>` 안을 `MotionProvider`가 감싸고, `/login`·`/share/quotes/[token]`에서도 Provider가 적용된다.
- [ ] `NEXT_PUBLIC_MOTION_DISABLED=1`로 띄운 앱에서 어떤 Motion 애니메이션도 재생되지 않는다 (요소가 즉시 최종 상태).
- [ ] `playwright.config.ts`·`playwright.smoke.config.ts`에 `reducedMotion: 'reduce'`와 플래그 env가 설정됐다.
- [ ] `tests/setup.ts`에 `skipAnimations`가 설정됐다.
- [ ] `globals.css`에 `prefers-reduced-motion: reduce` 전역 규칙이 있다.
- [ ] `Button`, `CloseButton`, `GoogleButton`을 누르는 동안 scale 0.98로 축소되고, OS 모션 감소 설정 시 축소되지 않는다.
- [ ] `button.tsx`에 `"use client"`가 없다.
- [ ] UI 외형 변화 없음(press 피드백 제외).

### PR-2 오버레이
- [ ] 모달 열기: 패널이 scale 0.96→1 + fade로 240ms 안에 나타나고, 백드롭이 fade 된다.
- [ ] 모달 닫기(닫기 버튼 / Esc / 백드롭 클릭 / 제출 성공 후 프로그램적 닫힘) 4가지 모두 퇴장 애니메이션이 보인 뒤 사라진다.
- [ ] Esc 1회에 `onClose`가 정확히 1회 호출된다 (단위 테스트).
- [ ] 모달 퇴장 애니메이션(`duration.exit` 160ms)이 끝나 `dialog.close()`가 호출되는 시점에 포커스가 열었던 트리거로 돌아간다. 실제 브라우저 측정 기준 **퇴장 시작 후 250ms 이내** (dev 서버 실측 168~219ms). (정정 — 9.1·9.2절 참조)
- [ ] 퇴장 중(open=false 후 ≤160ms) 다시 open=true가 되면 퇴장이 취소되고 모달이 열린 상태로 남으며 `onClose`가 호출되지 않는다.
- [ ] 모달 퇴장 중 모달 내부 버튼을 클릭해도 반응하지 않는다.
- [ ] 드로어(`RowDetailDrawer`)가 오른쪽에서 슬라이드 인/아웃 되고 포커스가 트리거로 복원된다.
- [ ] 챗 패널 열기/닫기 시 패널과 FAB가 교대로 fade+slide 되며, 패널을 다시 열어도 기존 메시지는 애니메이션하지 않는다.
- [ ] 모달 호출부 전부(약 15곳)가 `<Presence>`로 감싸졌다 (grep으로 `? <` + `Modal` 패턴에 Presence 누락 0).

### PR-3 전환·피드백
- [ ] 사이드바 접기/펼치기 시 폭 transition은 기존 200ms CSS 그대로이고(`shell.spec.ts` 통과), 펼칠 때 라벨이 fade-in 되며 접을 때는 즉시 사라진다. 접는 동안 아이콘 x가 음수가 되거나 튀지 않는다(9.3절).
- [ ] 모바일(<768px)에서 사이드바 닫힘 후 `toBeHidden`(`a11y-responsive.spec.ts`)이 통과한다.
- [ ] `Segmented` 활성 pill이 탭 간 슬라이드 이동한다 (바운스 없음).
- [ ] `CalculatorTabs` 전환 시 새 콘텐츠가 fade-up 되고 이전 콘텐츠의 퇴장 대기가 없다 (클릭 즉시 새 탭 상호작용 가능).
- [ ] 인라인 성공/에러 배너와 폼 에러가 height+fade로 펼쳐지고 접힌다. `role`·`aria-live` 속성이 유지된다.
- [ ] axe color-contrast 검사(`a11y-responsive.spec.ts`)가 통과한다.

### PR-4 목록·메시지
- [ ] 챗에서 새 메시지 버블이 fade-up 으로 나타나고, 스트리밍 중 글자가 추가될 때 버블·주변 요소가 떨리거나 재배치되지 않는다.
- [ ] `CartPanel` 항목 추가/삭제, `PartsEditor` 선택 추가/삭제, `QuoteSteps` 칩 추가/삭제 시 나머지 항목이 layout(`duration.layout`)으로 부드럽게 재배치된다. 삭제 항목은 **세로 목록(`CartPanel`)은 height 접힘, 가로 칩(`PartsEditor`·`QuoteSteps`)은 `scaleIn` 축소+fade**로 사라진다. (정정 9.4절)
- [ ] `GroupsManager` 그룹 카드 삭제 시 삭제 카드는 fade로 사라지고 아래 카드는 layout으로 미끄러져 올라온다(한 번에 튀지 않음).
- [ ] 가격·원가·감사 표의 `<tr>`에 Motion 속성이 없다.

## 7. 태스크

1. **[PR-1 기반]** 의존성 추가, `tokens.ts`, `MotionProvider`, `Presence`, 루트 layout 적용, 플래그, `globals.css` reduced-motion, Playwright/Vitest 설정, 버튼 CSS press. 기존 테스트 전부 통과(동작 변화 없음).
2. **[PR-2 오버레이]** Modal(`cancel` 가로채기, 내부 `m.div`, backdrop CSS, 호출부 15곳 `Presence`), Drawer(포커스 복원 시점), ChatPanel/ChatDock 열림·닫힘. 영향받는 단위 테스트 `waitFor` 전환.
3. **[PR-3 전환·피드백]** Sidebar 라벨 fade + 모바일 백드롭 CSS, Segmented `layoutId`, CalculatorTabs 콘텐츠 fade-up, 인라인 배너·폼 에러 Presence.
4. **[PR-4 목록·메시지]** 챗 버블 등장, CartPanel/PartsEditor/QuoteSteps 칩 layout, (P3) FamilyTabs 인디케이터, ProductCards hover, GroupsManager 목록 fade.

의존 관계: 1 → 2, 1 → 3 (2와 3은 병렬 가능), 2 → 4 (`ChatPanel.tsx` 파일 겹침). 각 PR은 개별로 QA 검증 요청.

## 8. 환경 메모 (Dev/QA)

- Main 워크트리 dev 서버가 `0.0.0.0:3000` 사용 중 → Dev/QA는 다른 포트(`PORT=3001`, `3002`)로 띄운다.
- 이 Linux 호스트에서 dev 서버 hydration이 실패하면 `src/proxy.ts` matcher가 `/_next/hmr`를 제외하지 않는 별건 이슈 때문이다. **이 PR에서 고치지 말고** 검증은 `pnpm build && pnpm start`(프로덕션 빌드)로 하거나 Main의 임시 수정을 로컬에서만 적용(커밋 금지)한다.

## 9. 구현 중 확정된 결정 (Dev 보고 → Plan 승인, 2026-10-02)

- `NEXT_PUBLIC_MOTION_DISABLED`는 E2E 전용 빌드 플래그이므로 `src/env.ts` 스키마·`.env.example`·`docs/deploy/vercel.md`에 넣지 않는다. Provider가 `process.env`를 직접 읽는다.
- PR 브랜치는 `feat/motion-pr{1..4}-*` (Dev 브랜치 → main PR은 CLAUDE.md 충돌). PR-2·3은 PR-1 위에 스택, PR-1 머지 후 rebase.
- 버튼 press 해제: Tailwind 4의 `scale-*`는 `scale` 속성이라 `motion-reduce:transform-none`이 안 먹음 → `motion-reduce:active:scale-100`으로 구현. 3.3 표의 해당 문구는 이걸로 대체.
- 챗 ChipRow·FAB press는 파일 겹침으로 PR-2에서 적용.

### 9.1 PR-2 구현 중 결정 (Dev 되묻기 `msg_c58834860527` → Plan 결정, 2026-10-02)

- **모달 포커스 복원 시점 정정 (A안)**: `showModal()`로 열린 dialog가 top layer에 있는 동안 브라우저가 바깥 요소를 inert로 만들어 트리거 `focus()`가 무시된다. 따라서 "닫히는 즉시 복원"은 결정 5(dialog 내부 `m.div` 퇴장, dialog는 modal 유지)와 함께 실제 브라우저에서 성립하지 않는다. 기준을 **"퇴장 완료 시(`close()`, ≤160ms) 복원, 퇴장 중 모달 내부는 `pointer-events:none`으로 무반응"**으로 정정한다. 드로어는 dialog가 아니므로 기존 기준(퇴장 시작 즉시 복원) 유지. 3.3 표의 모달 행 "포커스를 트리거로 즉시 복원" 문구도 이 정정으로 대체한다.
- **퇴장 중 다시 열기 (신규 엣지케이스)**: 퇴장 중 `open=true`가 오면 퇴장을 취소하고 `animate` 상태로 되돌린다. `onClose`는 호출하지 않는다. 항상 마운트되는 `<Modal open={bool}>` 4곳(`UsersTable` 비활성화 확인, `LlmCredentialCard`, `ImportPanel`의 `ReplaceConfirmModal`, `ItemMergeChoice`)이 대상이다. (정정 2026-10-02, Dev `msg_127ef574f235` — `GroupsManager`·`PartsManager`는 `{deleting ? <Modal open> : null}` 조건부 마운트라 `<Presence>` 대상) 단위 테스트 1건 추가.
- **PR 순서 변경**: PR-2와 PR-3이 같은 파일 8개를 수정하고 그중 6개가 충돌하므로 병렬 대신 **PR-2 → 머지 → PR-3 rebase → 머지 → PR-4** 순차 진행한다. (7절 의존 관계 "2·3 병렬 가능"을 대체)

### 9.2 포커스 복원 허용 오차 (Dev 확인 요청 `msg_31038979435c` → Plan 결정, 2026-10-02)

- 9.1의 "≤160ms"는 퇴장 tween 길이를 그대로 상한으로 쓴 표현 오류다. `close()`는 tween이 끝난 다음 프레임의 완료 콜백에서 호출되므로 실측은 160ms + 1~2프레임 + dev 오버헤드다 (PR #35, dev 서버 rAF 샘플링 168 / 194 / 197 / 201 / 219ms).
- 기준: **"퇴장 애니메이션이 끝나는 시점(`close()`)에 복원, 퇴장 시작 후 250ms 이내"**. 250ms = 160ms + 약 5프레임 여유. 구현 변경 없음.
- 측정 환경: dev 서버(프로덕션 빌드는 테스트 로그인이 거부되어 측정 불가). QA도 같은 방식으로 측정한다.

### 9.3 PR-3 사이드바 라벨 퇴장 (Dev 되묻기 `msg_e50a394ad29b` → Plan 결정, 2026-10-02)

- 접을 때 라벨이 120ms 퇴장 fade로 자리를 차지하면 `justify-center` 묶음 정렬 때문에 폭 transition(CSS 200ms) 동안 아이콘이 링크 밖(음수 x)으로 밀렸다가 라벨 제거 시 튄다(실측 x 24→70.5→…→−14.9→28). "관리자" 헤더 퇴장과 구분선 진입이 겹쳐 아래 메뉴가 밀리는 현상도 같은 원인.
- 결정 **A**: 라벨과 "관리자" 헤더는 **펼칠 때만 fade-in**, 접을 때는 즉시 제거. 링크의 `overflow-hidden`은 되돌린다. 아이콘 궤적이 main과 같아야 한다.
- 추가 수용 기준(PR-3): 사이드바 접기 중 rAF 샘플링에서 아이콘 x가 음수가 되거나 튀지 않는다(단조 변화). 펼칠 때 라벨이 fade-in 된다.

### 9.4 PR-4 목록 판단 (Dev 되묻기 `msg_027db3a7ae64` → Plan 결정, 2026-10-02)

- **가로 칩 퇴장 (A)**: `PartsEditor` 선택 칩, `QuoteSteps` 중·소분류 칩은 가로 flex-wrap 알약이라 height 접힘이 어색하다. 퇴장은 `scaleIn`(0.96↔1 + fade, 160ms), 나머지 칩은 layout 재배치. 세로 목록(`CartPanel`)은 height 접힘 + layout 유지.
- **GroupsManager 튐 (A)**: fade만 두면 퇴장 160ms 후 아래 카드가 한 번에 튄다(PR-3 사이드바와 같은 종류). fade + `m.li layout`(`duration.layout`)으로 미끄러지게 한다.
- 허용(보고만): 마지막 항목 삭제 시 퇴장 160ms 동안 빈 목록 안내가 함께 보임, `QuoteSteps` 제품군 변경 시 이전·새 칩이 160ms 겹침 — `mode="wait"` 금지(입력 지연 방지)의 결과로 수용한다.
