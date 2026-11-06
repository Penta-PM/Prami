# Prami 모바일 UI/UX

- 요구: Main msg_fbb0f4a8859a (2026-11-06). 사용자 원문: "프라미의 모바일 버전 UI/UX도 만들어야함".
  - 기준: Vercel Web Interface Guidelines(command.md, 2026-11-06 최신본을 받아 대조).
- 기준 코드: main 83413aa.
- 병렬 검토: UI/UX 검토와 기능/기술 검토의 결론이 같습니다. 두 쪽 모두 아래 권고에 동의했고 상충하는 부분은 없습니다.
  - 반응형 단일 경로
  - CSS 우선
  - 경계는 `md`(768px)
  - 표는 카드로 바꾸되, 열 메타로 카드를 자동으로 만듦
  - PWA는 manifest만
  - 관리자 화면은 "깨지지 않음"까지만
- 사용자 결정이 필요한 항목은 §2에 모았습니다. 두 검토가 모두 권고만 내놓았으므로 Main에 되묻습니다.
- 다크 모드는 제품에 없습니다(`dark:` 0건). 이번 범위가 아닙니다.

## 1. 현재 화면 감사 (요약, 근거 file:line, main 83413aa)
### 전역 / 셸
- `src/app/layout.tsx:21-27` — `viewport` export가 없습니다. `viewportFit`·`interactiveWidget`·`themeColor`도 없습니다. 확대 금지는 없어서 이 점은 괜찮습니다.
- `src/app/(app)/layout.tsx:25-26`, `src/features/shell/Sidebar.tsx:119` — `h-screen`(100vh)를 씁니다. iOS에서 주소창이나 키보드가 뜨면 화면 아래가 잘립니다.
- `globals.css` — 다음이 모두 0건입니다.
  - `touch-action: manipulation`, tap-highlight, `overscroll-behavior`, `text-size-adjust`
  - `env(safe-area-inset-*)`
- **`globals.css:357-363` — 밀도 sm의 입력 글자가 14px입니다.** 표, 필터, 드로어 안의 입력을 누르면 iOS가 자동으로 확대합니다. 이번 감사에서 가장 넓게 퍼진 원인입니다.
  - 같은 문제가 있는 곳:
    - `PricingFilters.tsx:27-28` (12px)
    - `DateFilter.tsx:29-30` (12px)
    - `QuoteSteps.tsx:288` (코어 수, sm)
    - `ShareModal.tsx:117`
- `Header.tsx:27` — 헤더 높이가 72px입니다.
- **`Header.tsx:56` — 결함: "사용자 설정" 링크가 `max-md:hidden`이고, `nav.ts`에도 `/settings`가 없습니다.** 모바일에서는 설정 화면으로 갈 방법이 없습니다.
- `Header.tsx:63-66` — 로그아웃 버튼이 12px, 높이 약 30px입니다. 알림 버튼과 붙어 있습니다.
- `Sidebar.tsx:95` — ☰ 버튼이 36px입니다. 위치가 `top-[18px]`로 고정돼 있습니다.
- `Sidebar.tsx:100-123` — 오버레이가 열려도 배경 스크롤이 잠기지 않습니다. `inert`도 없습니다.
- `public/` — manifest, apple-touch-icon이 없습니다. CSP는 이미 `manifest-src 'self'`를 허용합니다(`server/security/headers.ts:33`).
  - `src/proxy.ts:26` PUBLIC_PREFIXES에는 manifest가 없습니다. 그래서 manifest를 추가하면 proxy 예외도 함께 넣어야 합니다.
- E2E AC-375(`tests/e2e/a11y-responsive.spec.ts:44-70`)는 홈 화면만 검사합니다.

### 공용 컴포넌트
- `modal.tsx:35-36,248-253` — 화면 가운데 뜨는 다이얼로그입니다. 본문 스크롤과 sticky 푸터가 없어서, 긴 폼에서는 저장 버튼이 키보드 아래로 내려갑니다. `overscroll-contain`이 없습니다.
- `modal.tsx:262-268` — 닫기 버튼이 32px입니다.
- `drawer.tsx:148,169` — 밀도 sm(14px 입력)이고, `overscroll-contain`과 safe-area가 없습니다.
- `popover.tsx:288` — `max-h-[calc(100vh-32px)]`라 키보드를 고려하지 않습니다(QuickFilterEditor 숫자 입력).
- `DataTableQuickFilterBar.tsx:327` — 칩 지우기 버튼이 24px입니다.
- `DataTable.tsx:712-716` — 행 전체가 `onClick`입니다. 가로 스크롤하다가 행이 눌려 상세가 열립니다.
- `table.tsx:18` — `overflow-x-auto`만 있고, 옆으로 더 있다는 표시가 없습니다.
- `range-slider.tsx:309` — 터치 영역 44px은 충족합니다. 다만 래퍼 전체가 `touch-none`이라 그 위에서는 세로 스크롤이 막힙니다.
- features 52곳 — 정보가 `title=` 툴팁에만 있습니다(예: `pricing/cells.tsx:208,216,262,277`). 터치 기기에서는 볼 수 없습니다.

### 화면별
- **가격 정책**
  - `columns.ts:34-62` — 조회 11열, 관리 최대 16열입니다.
  - `PricingFilters.tsx:127-170` + `PricingBrowser.tsx:299-330` — 필터가 5~7줄로 접혀서 표가 첫 화면 아래로 밀립니다.
  - `PricingBrowser.tsx:54-55,171-183` — 수정/복사/삭제 버튼이 약 24px이고 서로 붙어 있습니다.
- **계산기**
  - `QuoteCalculator.tsx:452` — 1024px 미만에서는 장바구니가 맨 아래로 갑니다. `CartPanel.tsx:66`의 sticky가 무의미해집니다.
  - `CartPanel.tsx:99-105` — 삭제 버튼이 약 16~20px입니다.
  - `CartPanel.tsx:128,151,390-420` — 11~12px 링크 버튼이 촘촘하게 붙어 있습니다.
  - `chips.tsx:78`, `QuoteSteps.tsx:263` — ± 버튼이 22~32px입니다.
  - `QuoteSteps.tsx:183`, `CartPanel.tsx:70,134` — 스크롤 영역 안에 스크롤 영역이 또 있습니다.
  - `QuoteSteps.tsx:415-423` — 할인율 range가 1000칸이라 손가락으로 맞추기 어렵습니다.
- **공유 견적서**
  - `QuoteSheet.tsx:30-39`, `app/share/quotes/[token]/page.tsx:28` — 외부 고객이 받는 7열 표입니다. 폰에서 가로 스크롤이 필요합니다.
  - `ShareModal.tsx:68` — 클립보드 복사만 있고 `navigator.share`가 없습니다.
  - PDF는 서버에서 렌더하고 inline으로 엽니다(`api/quotes/[id]/pdf/route.ts:52-58`). CSP `frame-ancestors 'none'`(`headers.ts:30`)이라 iframe 미리보기는 할 수 없습니다.
- **조달**
  - `BidTable.tsx:86` — `min-w-[1040px]`입니다.
  - `ItemsBrowser.tsx:291` — 가로 스크롤 표입니다.
  - `ChartFrame.tsx:184-195` — 터치에서 탭 한 번에 강조와 이동이 같이 일어납니다.
  - `ChartLegend.tsx:112-115` — 버튼이 32px이고 붙어 있습니다.
- **챗봇**
  - `ChatPage.tsx:15` — dvh를 쓰지만 `min-h-[480px]`이 있고 셸이 100vh입니다. 키보드가 뜨면 입력창이 밀려납니다.
  - `ConversationPane.tsx:172-181` — `enterKeyHint`와 safe-area가 없습니다.
  - `ChatWorkspace.tsx:63` — 새 대화를 열 때 자동 포커스가 걸려 모바일 키보드가 바로 올라옵니다.
  - `ConversationList.tsx:346,450` — 버튼이 32px입니다. 이름 바꾸기는 Enter로만 저장됩니다.
- **이미 잘 된 것**
  - 챗봇의 목록↔대화 전환
  - 알림 패널의 모바일 배치
  - DataTable이 터치에서 드래그·리사이즈를 막음
  - 범위 슬라이더 44px
  - SVG 차트가 폭에 맞춰 그려짐(`ComboChart.tsx:76-77`)
  - 모션 감소 대응
  - `tabular-nums`

## 2. Main 확인 필요 (Plan 권고 포함)
| # | 항목 | Plan 권고 |
|---|---|---|
| Q1 | 모바일 전용 경로 vs 반응형 | **반응형 단일 경로.** 전용 경로를 두면 권한, 페이지 상태 복원, proxy, 공유·알림 링크를 모두 두 벌로 관리해야 합니다. |
| Q2 | PWA | **manifest·아이콘·theme-color만 둡니다(홈 화면 추가).** 서비스워커와 오프라인은 하지 않습니다. 세션·원가가 캐시에 남거나, 배포 뒤 옛 번들이 남는 위험이 있습니다. `display`는 standalone에서 Google 로그인을 검증한 뒤 `standalone`으로 바꾸고, 그 전까지는 `browser`입니다. |
| Q3 | 관리자 화면 범위 | **"깨지지 않음"까지만** 합니다. 320px에서 가로 넘침 없음, 모달은 시트로, 입력은 16px입니다. 카드화는 하지 않고, 엑셀 업로드에는 "PC에서 이용 권장" 안내를 둡니다. |
| Q4 | 최소 폭 | **설계 기준 360px**(주력 확인 폭 375/390). 320px은 "깨지지 않음"만 보장합니다(AC-375 유지). |
| Q5 | 내비게이션 | **지금의 오버레이 사이드바를 유지하고 헤더만 개선합니다.** 하단 탭바는 권한마다 탭이 달라지고, 계산기 요약 바·챗봇 입력창과 화면 아래 공간을 다툽니다. 사용해 본 뒤 다시 판단합니다. |
| Q6 | 단계 우선순위 | 기반(M0) → 공유 견적서(M1) → 가격 정책(M2) → 계산기(M3) → 챗봇(M4) → 조달(M5) → 홈·설정·공지(M6) → 관리자(M7). 영업이 밖에서 많이 쓰는 화면과, 외부 고객이 폰으로 여는 공유 견적서를 먼저 합니다. |
| Q7 | 모바일에서 허용할 동작 | **권한을 데스크톱과 같게 둡니다**(편집·저장·공유 모두 허용, 별도 제한 없음). 다만 원가 관련 정보는 카드에 넣지 않고 상세에서만, 지금 권한 그대로 보여줍니다. |

## 3. 설계 결정 (두 검토 일치)
- **경계**: Tailwind `md`(768px)입니다.
  - 모바일 전용 스타일은 `max-md:`에만 적용합니다. 768px 이상의 화면과 코드 경로는 바꾸지 않습니다(데스크톱 회귀 방지).
  - 태블릿(768~1023px)은 지금 레이아웃을 그대로 씁니다.
- **CSS 우선**: 표와 카드를 둘 다 렌더하고 `max-md:hidden` / `md:hidden`으로 전환합니다.
  - 숨긴 쪽은 `display:none`이어서 접근성 트리에서도 빠집니다.
  - 표는 서버 페이징 50건 단위라 DOM이 두 배가 되는 것은 허용 범위입니다.
  - `matchMedia`로 표/카드를 고르는 방식은 금지합니다. 하이드레이션 불일치와 CLS가 생깁니다.
- **JS를 허용하는 곳은 두 군데뿐입니다.**
  1. 챗봇·폼 시트의 키보드 보정(`visualViewport`)
  2. 바텀시트 모션 분기(`useSyncExternalStore(matchMedia)`, 서버 스냅샷은 desktop, 열렸을 때만 사용)
- **표 → 카드**
  - `DataTableColumn`에 `mobile?: { role: 'title'|'subtitle'|'meta'|'badge'|'detail-only'|'hidden', order? }`를 추가합니다.
  - `DataTable`이 같은 `rows`·`cell()`로 `<ul role="list">` 카드를 만듭니다. 카드를 누르면 기존 상세를 시트로 엽니다.
  - 정렬은 카드 위의 select 하나로 합니다. 열 재배치·너비 조절·초기화 버튼은 모바일에서 숨깁니다.
  - 저장된 열 레이아웃(localStorage)과 `user_view_states`는 건드리지 않습니다. **DB 변경은 없습니다.**
  - DataTable이 아닌 `<table>` 15곳은 화면별로 처리합니다. 2~4열이면 가로 스크롤을 유지하고 끝에 그림자를 넣습니다. 열이 많으면 카드로 바꿉니다.
  - **원가 열**: 카드에는 매핑하지 않습니다(`detail-only` 또는 `hidden`). "권한이 없으면 열 정의 자체가 없음(RSC payload 키 0)" 원칙을 카드와 시트에도 그대로 적용합니다.
- **BottomSheet 공용 컴포넌트**: `max-md`에서는 Modal·Drawer·Popover를 시트로 표시합니다.
  - 높이는 최대 `90dvh`입니다. 본문만 스크롤하고 헤더·푸터는 고정합니다. 푸터에 safe-area를 둡니다.
  - `overscroll-contain`을 걸고 배경 스크롤을 잠급니다.
  - 닫기 버튼은 44px이며 필수입니다. 제스처만으로 닫히게 하지 않습니다.
  - 입력이 많은 폼(정책 등록, 원가, 사용자)은 전체 화면 시트로 엽니다.
  - 데스크톱 경로의 Modal·Drawer 코드는 바꾸지 않습니다. `max-md`에서만 분기합니다.
- **필터**: 위에 "검색 + [필터 n]" 한 줄과 적용 칩을 가로 스크롤로 둡니다.
  - 나머지 필터(분류, 날짜, 빠른 필터, 범위 슬라이더)는 필터 시트로 옮깁니다. 시트 아래에 [초기화] [결과 n건 보기]를 둡니다.
  - URL 상태는 지금처럼 유지합니다. 값은 "보기"를 누를 때 반영합니다.
- **헤더(모바일)**
  - 높이 56px입니다. 왼쪽에 ☰(44px), 검색은 아이콘을 누르면 펼칩니다.
  - 오른쪽에는 알림과 아바타를 둡니다. 아바타를 누르면 시트가 열리고 이름/역할, 사용자 설정, 로그아웃이 나옵니다. 이것으로 설정 진입 결함을 고칩니다.
  - 사이드바 오버레이는 배경 스크롤을 잠그고 `inert`를 겁니다.
- **스와이프 제스처**: 도입하지 않습니다. iOS의 뒤로 가기 제스처와 충돌합니다.

## 4. 모바일 밀도 규칙 Q-D1-M (`max-md`에만 적용, 데스크톱 Q-D1 그대로)
| 항목 | 규칙 |
|---|---|
| 터치 영역 | 44×44px 이상입니다. 보이는 크기는 36px까지 허용하고, 나머지는 패딩이나 `::before`로 넓힙니다. 인접한 대상 사이는 8px 이상 띄웁니다. |
| 입력 글자 | `input`/`select`/`textarea`는 **항상 16px 이상**입니다(밀도 sm 안에서도). 높이는 44px입니다. 새 토큰 `--density-field-font-size`를 `max-md`에서 16px로 고정합니다. |
| 카드 | 최소 높이 56px(한 줄이면 48px), 좌우 여백 16px입니다. 제목 16/600, 본문 14/20, 메타 12px입니다. **11px 이하는 금지**입니다. |
| 숫자 | 금액은 16px semibold에 `tabular-nums`, 합계는 20~24px입니다. |
| 칩 | 보이는 높이 36px, 터치 영역 44px, 간격 8px입니다. |
| 간격 | 화면 여백 16px(`max-md:p-4` 유지), 카드 안쪽 16px, 섹션 사이 16px입니다. |
| 고정 바 | 헤더 56px입니다. 하단 바는 56px + safe-area이고 **한 번에 하나만** 둡니다. 계산기 요약 바와 챗봇 입력창이 동시에 나오지 않게 합니다. |
| 모션 | transform과 opacity만 씁니다. 기존 모션 토큰을 쓰고, 모션 감소 설정을 따릅니다. |

## 5. 단계 (PR 묶음, 모두 DB 변경 없음)
| PR | 범위 | 규모 | 의존 |
|---|---|---|---|
| **M0 기반** | `viewport` export(`viewportFit:'cover'`, `interactiveWidget:'resizes-content'`, `themeColor`)<br>`h-dvh`(셸·사이드바)<br>전역 CSS: `touch-action:manipulation`, `text-size-adjust`, tap-highlight + `active:`, `@media (pointer:coarse)`에서 입력 16px, safe-area<br>헤더 56px + 아바타 시트(설정·로그아웃) — **설정 진입 결함 수정**<br>사이드바 ☰ 44px, 배경 잠금, `inert`<br>BottomSheet 컴포넌트와 Modal·Drawer·Popover의 `max-md` 시트 전환<br>`overscroll-contain`<br>닫기 버튼 44px<br>E2E `mobile` 프로젝트 골격 + 공통 단언 헬퍼 | 10~14 파일 | — |
| M1 공유 견적서 | QuoteSheet 카드화, 합계 고정, `navigator.share`(실패하면 클립보드), PDF 열기 후 돌아오기 확인 | 4~6 | M0 |
| M2 가격 정책 | DataTable 카드 모드(공용: `mobile` 메타, 정렬 select, 필터 시트), PriceTable 열 메타, PricingFilters 시트, 상세 시트, PriceHistoryModal, 정보가 `title`에만 있는 곳 → `InfoHint`(탭으로 열기) | 8~12 | M0 |
| M3 계산기 | 단계 접기(요약 + 변경), 하단 요약 바(개수·합계·[장바구니]), CartPanel 전체 화면 시트, 안쪽 스크롤 제거, ± 버튼 44px, 할인율 스테퍼 + 숫자 입력, 견적 목록 모달 시트 | 8~10 | M0 |
| M4 챗봇 2종 | 입력창 하단 고정(키보드 보정, safe-area, `enterKeyHint="send"`), `min-h` 정리, 모바일에서 자동 포커스 제거, 이름 바꾸기 저장·취소 버튼, ⋯ 버튼 44px | 5~8 | M0 |
| M5 조달 | 물품·입찰 카드(M2 재사용, BidTable은 직접 구현), 실적 표(제조사·월·연·계약), 필터 시트, 차트 터치(첫 탭은 강조, 다시 탭하면 이동), 범례 칩 | 14~18 (M5a 목록·필터 / M5b 실적·차트로 나눌 수 있음) | M2 |
| M6 홈·설정·공지·검색 | 1열 정리, 글자 크기, 320px | 5~8 | M0 |
| M7 관리자 | Q3 결정 범위 | 6~20 | M0 |
| (PWA) | manifest, 아이콘, theme-color, proxy 예외 — Q2 결정에 따름 | 3~5 | M0 |
- 흐름은 B′입니다: 단계마다 Dev 게이트 → 머지 → :3000 = main → 보고.

## 6. 테스트 전략
- Playwright에 `mobile-chromium`(Pixel 7) 프로젝트를 추가합니다.
  - `testMatch: /.*\.mobile\.spec\.ts/`로 **모바일 전용 spec만** 돌립니다. 기존 데스크톱 spec 201개는 chromium에서만 돌리고, 같은 테스트를 두 번 돌리지 않습니다.
  - 단계마다 1~3개, 전체 15~25개입니다. CI는 +3~5분을 목표로 합니다.
  - WebKit은 넣지 않습니다(다운로드·시간 비용). iOS는 실기기에서 수동으로 확인합니다.
- 공통 헬퍼로 360×740과 320×640에서 다음을 확인합니다.
  1. 문서 가로 넘침 0
  2. 주요 컨트롤의 터치 영역 44px 이상
  3. 표 화면에서 `role=table`은 숨겨지고 `role=list`가 보임
  4. 포커스된 입력의 글자 16px 이상
- 데스크톱 회귀
  - 기존 스위트를 전부 통과해야 합니다.
  - 1280px 불변 단언을 추가합니다: 사이드바가 보임, `role=table`이 있음, 카드가 숨겨짐.
  - 시각 스냅샷은 도입하지 않습니다(flaky).
- 단위 테스트: 열 메타에서 카드 슬롯으로 매핑하는 순수 함수, 카드 렌더(RTL).
- 실기기 수동 확인(Dev 게이트 기록 §3.1): iOS Safari(키보드·입력창, PDF 열고 돌아오기, 노치), Android Chrome(`interactive-widget`).

## 7. 공통 수용 기준
- [ ] 768px 이상 데스크톱의 레이아웃·동작이 바뀌지 않습니다(기존 E2E 전부 통과 + 1280px 불변 단언).
- [ ] 해당 단계 화면에서 360px·320px 가로 넘침이 0입니다.
- [ ] 입력을 눌러도 iOS가 확대하지 않습니다(입력 16px 이상).
- [ ] 터치 영역이 44px 이상입니다.
- [ ] 원가 정보가 카드나 시트에 새로 노출되지 않습니다(권한이 없으면 payload 키 0).
- [ ] 보안 규칙을 지킵니다(매칭 파일, jodari 원본, 원가 금액, 비밀값).
- [ ] Dev 게이트 기록(§3.1). PR에 `ci:run`을 붙여 머지하고, 머지 후 CI가 녹색인지 확인합니다(B′).

## 8. 진행 기록
- 2026-11-06 병렬 검토를 마치고 스펙 초안을 썼습니다. Q1~Q7은 Main에 되묻습니다. M0(기반)은 Q1~Q7과 상관없어서(어느 답이 와도 필요함) 먼저 배정합니다.
