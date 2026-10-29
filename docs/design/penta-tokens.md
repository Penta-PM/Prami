# Penta 디자인 토큰 (Prami 적용본)

Penta 디자인 시스템 v2.0.0 의 **웹(UI) 값**(§1 컬러 ~ §5 그림자, §6 컴포넌트 수치, §7 아이콘 규격)을 Prami 에 옮긴 요약입니다.
구현은 `src/app/globals.css`, 검사는 `tests/unit/tokens.test.ts`(기준표 `tests/fixtures/design-tokens/penta.css`)입니다.
원본 디자인 시스템 문서·아이콘 라이브러리 JSON 은 저장소에 넣지 않습니다(`/design/` 은 `.gitignore`).

- **보충값** = 원본 문서에 없는 단계. Tailwind 표준 팔레트의 대응값으로 채웠고, 디자인팀이 값을 주면 교체합니다.
- 다크 테마는 범위 밖입니다. 의미 토큰(L2)만 다시 정의하면 되도록 층을 나눠 두었습니다.

## 1. 토큰 구조

| 층 | 이름 | 위치 | 쓰임 |
|---|---|---|---|
| L1 원시값 | `--penta-primary-*`, `--penta-neutral-*`, `--penta-{success,warning,error,info}-*`, `--penta-type-*`, `--penta-space-*`, `--penta-radius-*`, `--penta-shadow-*` | 첫 `:root` | 값의 단일 출처. 컴포넌트에서 직접 쓰지 않음 |
| L2 의미 | `--surface-*`, `--border-*`, `--text-*`, `--accent-*`, `--action-bg`·`--action-bg-hover`·`--action-fg`, `--focus-ring`, `--danger-bg`, `--link`·`--link-hover` | `@theme static` (`--text-*` 는 `:root`) | 화면 코드가 쓰는 이름. 다크 테마 시 이 층만 재정의 |
| L3 유틸리티 | `--color-*` | `@theme inline` | `bg-action-bg`, `text-text-secondary`, `bg-primary-50`, `text-neutral-600`, `border-error-500` … |

- `--text-*` 는 Tailwind 의 font-size 네임스페이스와 겹치므로 `@theme` 밖 `:root` 에 둡니다(유틸리티는 `--color-text-*` 별칭으로).
- 기존 반경(`--radius-lg` 8px 등)·간격(`--space-*`)·타이포 shorthand(`--text-h1` 등)는 **값을 바꾸지 않았습니다.** Penta 값은 새 이름으로만 추가했고, 실제 적용은 공용 컴포넌트·화면 PR 에서 합니다.

## 2. 컬러 (L1)

### Primary — Penta Blue

| 단계 | 값 | 비고 |
|---|---|---|
| 50 | `#EBF2FF` | 배경 강조 |
| 100 | `#C2D9FF` | hover 배경 |
| 200 | `#93C5FD` | 보충값 (Tailwind blue-300) |
| 300 | `#60A5FA` | 보충값 (Tailwind blue-400) |
| 400 | `#3B82F6` | 보충값 (Tailwind blue-500) |
| 500 | `#1E6FFF` | 메인 브랜드 — 채움 장식·포커스 고리 전용 |
| 600 | `#1858CC` | 주 동작 배경·링크·강조 글자 |
| 700 | `#124199` | 주 동작 hover·active |
| 800 | `#1E3A8A` | 보충값 (Tailwind blue-900) |
| 900 | `#061433` | 어두운 배경 |

Primary 보충값은 Tailwind blue 의 **한 단계 진한 번호**를 씁니다. 같은 번호(blue-200)는 Penta 100 보다 밝고, blue-800 은 Penta 700 보다 밝아 명도 순서가 뒤집히기 때문입니다(테스트가 순서를 검사).

### Neutral

| 단계 | 값 | 비고 |
|---|---|---|
| 0 | `#FFFFFF` | 기본 배경 |
| 50 | `#F7F8FA` | 서브 배경 |
| 100 | `#ECEEF2` | 구분선·옅은 배경 |
| 200 | `#D9DCE3` | 테두리 |
| 300 | `#D1D5DB` | 보충값 (Tailwind gray-300) |
| 400 | `#9AA1B0` | 비활성 — 글자로 쓰지 않음(2.6:1) |
| 500 | `#6B7280` | 보충값 (Tailwind gray-500) |
| 600 | `#545D70` | 보조 글자·자리표시 글자 |
| 700 | `#374151` | 보충값 (Tailwind gray-700) |
| 800 | `#1F2937` | 보충값 (Tailwind gray-800) |
| 900 | `#111620` | 기본 글자 |

### Semantic

| 계열 | 50 | 500 | 700 | 800 |
|---|---|---|---|---|
| Success | `#F0FDF4` 보충값 | `#22C55E` | `#15803D` | `#166534` 보충값 |
| Warning | `#FFFBEB` 보충값 | `#F59E0B` | `#B45309` | `#92400E` 보충값 |
| Error | `#FEF2F2` 보충값 | `#EF4444` | `#B91C1C` | — |
| Info | `#EFF6FF` 보충값 | `#3B82F6` | `#1D4ED8` | — |

문서의 500·700 은 Tailwind green·amber·red·blue 와 같은 값이라 50·800 도 같은 계열에서 가져왔습니다.
Success·Warning 800 은 기존 화면의 성공·경고 글자 자리에서 700 이 AA 에 못 미쳐(아래 §6) 추가했습니다.

## 3. 타이포그래피·간격·반경·그림자 (L1)

글꼴: **Pretendard** (한글·영문 공통). `next/font/local` 로 셀프 호스트합니다(`src/app/fonts/PretendardVariable.woff2`, 공식 npm `pretendard@1.3.9` 가변 폰트, SIL OFL 1.1 — `src/app/fonts/OFL.txt`). 외부 CDN 요청이 없으므로 CSP 에 폰트 출처가 없습니다. 견적서 PDF 의 NotoSansKR 는 별개입니다.

| 토큰 (`--penta-type-*`) | 크기 / 줄 높이 | 굵기 |
|---|---|---|
| display | 56 / 64 | 700 |
| h1 | 40 / 48 | 700 |
| h2 | 32 / 40 | 700 |
| h3 | 24 / 32 | 600 |
| body-lg | 18 / 28 | 400 |
| body | 16 / 24 | 400 |
| body-sm | 14 / 20 | 400 |
| label | 12 / 16 | 500 |
| caption | 11 / 16 | 400 |

- 간격 (`--penta-space-<px>`): 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 (8pt 그리드)
- 반경 (`--penta-radius-*`): sm 4 (태그·칩) · md 8 (버튼·입력) · lg 12 (카드) · xl 16 (모달·패널) · full 9999 (배지·아바타)
- 그림자 (`--penta-shadow-*`): sm `0 1px 3px rgba(0,0,0,.08)` 드롭다운 · md `0 4px 16px rgba(0,0,0,.06)` 카드 · lg `0 8px 32px rgba(0,0,0,.10)` 모달 · xl `0 16px 48px rgba(0,0,0,.14)` 사이드 패널

새 이름(유틸리티로 바로 쓸 수 있음): `--radius-chip`(4) · `--radius-control`(8) · `--radius-card`(12) · `--radius-modal`(16) · `--height-control-sm/md/lg`(36/44/52) · `--shadow-dropdown`·`--shadow-card`·`--shadow-modal`·`--shadow-panel`.
Tailwind 기본 `shadow-sm/md/lg/xl`·`rounded-full` 은 덮지 않습니다.

## 4. 컴포넌트 수치 (공용 컴포넌트 PR-2 에서 적용)

| 컴포넌트 | 문서 값 | Prami 적용 시 |
|---|---|---|
| Button | 높이 44(MD)/36(SM)/52(LG) · 패딩 16 · 반경 8 · 14 SemiBold | Primary = `--action-bg`(**600**) + 흰 글자, Secondary = 흰 바탕 + 600 글자·테두리, Danger = `--danger-bg`(Error **700**), Ghost = N50 / N700 글자 / N200 테두리 |
| Status Badge | 높이 28 · 패딩 8 · 반경 full · 12 SemiBold · X-50 배경 + X-700 글자 | Info 는 Primary 와 색이 거의 같아(1.2:1) 아이콘을 함께 |
| Input | 높이 44 · 패딩 12 · 반경 8 · 테두리 N200 · focus P500 | 자리표시 글자 N600 |
| Card | 배경 N0 · 테두리 1px N100 · 반경 12 · 그림자 md · 패딩 20 | |

문서 표의 Button Primary·Secondary·Danger 는 500 단계를 글자·글자 배경에 씁니다 — 아래 접근성 규칙에 따라 600/700 으로 올려 씁니다.

### 밀도 규칙 (Q-D1 = B)

| 밀도 | 쓰는 곳 | 컨트롤 높이 · 글자 |
|---|---|---|
| `md` (기본) | 폼 · 독립 버튼 · 모달(주요 버튼 포함) | 44 · Body 16 |
| `sm` | 밀집 컨테이너 — 표(`Table`·`DataTable`) · 빠른 필터 바 · 드로어 · 관리 목록(`DensityScope`) · 필터 칩 | 36 · BodySmall 14 |

- 컨테이너가 `data-density` 를 달고(`densityAttrs()`·`DensityScope`), Button·Input·Select·Segmented 는 `size` 를 주지 않으면 가장 가까운 컨테이너를 따릅니다(CSS 변수 `--density-control-height`·`--density-font-size` 상속 — 서버 컴포넌트에서도 동작, 중첩 시 가까운 쪽 우선). 모달은 `md` 로 되돌립니다.
- 예외는 컨트롤의 `size` prop(`sm`·`md`·`lg`)으로만 정합니다. 화면별 크기 클래스(`h-8`·`text-[12px]` …)로 덮지 않습니다.
- 문서의 Button "14 SemiBold" 는 `sm` 에 해당하고, `md` 버튼은 사용자 결정(Q-D1)에 따라 16 SemiBold 입니다.

아이콘: 24px · 1px 선 · `icon/<이름>` 규칙. 아이콘 적용은 별도 PR 입니다.

## 5. Maglo 별칭표 (L1 재지정)

기존 화면의 원시 클래스(`bg-lime-400`, `text-ink-900` …)가 한 번에 Penta 색이 되도록 **이름은 남기고 값만 Penta 로** 바꿨습니다. 새 코드는 쓰지 마세요 — 화면 sweep 뒤 정리 PR 에서 제거합니다.

| 기존 이름 | 이전 값 | Penta | 근거 |
|---|---|---|---|
| `--white` | `#FFFFFF` | Neutral 0 | |
| `--gray-50`, `--gray-75` | `#FAFAFA`, `#F8F8F8` | Neutral 50 | 사이드바·입력·hover 띠 |
| `--gray-100` | `#F5F5F5` | Neutral 100 | 옅은 구분선·회색 배지 |
| `--gray-150` | `#F2F2F2` | Neutral 200 | 테두리·스크롤바 |
| `--gray-200` | `#F1F1F3` | Neutral 100 | 슬라이더 트랙 등 옅은 배경 |
| `--slate-700` | `#929EAE` | Neutral 400 | 장식 전용(글자 아님) |
| `--slate-600`, `--slate-600-aa`, `--slate-700-aa`, `--gray-600` | 회색 글자 | Neutral 600 | 보조 글자 AA |
| `--ink-900` | `#1B212D` | Neutral 900 | 기본 글자·어두운 패널 |
| `--ink-950` | `#292D32` | Neutral 800 | |
| `--purple-ink-900`, `--purple-ink-800` | 어두운 보라 | Primary 900 | (미사용) |
| `--purple-ink-700` | `#282541` | Primary 800 | (미사용) |
| `--lime-400`, `--lime-500` | 라임 | **Primary 100** | 선택·강조 배경 + 어두운 글자(12.6:1), 어두운 패널 위 강조 글자. 주 버튼은 `--action-bg` 로 옮김 |
| `--purple-500` | `#7B61FF` | **Primary 500** | 포커스 고리·틴트·선택 테두리(채움 장식) |
| `--purple-600` | `#6C55E0` | **Primary 600** | 강조 글자·체크박스·선택 표시 |
| `--blue-600` | `#2563EB` | Primary 600 | 운영중 글자 |
| `--green-600` | `#29A073` | Success 500 | 틴트 배경 |
| `--green-700` | `#1E7353` | Success 800 (보충값) | 성공 글자 |
| `--amber-500`, `--orange-500` | 앰버·주황 | Warning 500 | 틴트 배경·임박 배지(어두운 글자 8.4:1) — Penta 에 주황 없음 |
| `--amber-700` | `#8F5A00` | Warning 800 (보충값) | 경고 글자 |
| `--red-500` | `#EB001B` | Error 500 | 틴트·테두리·차트 |
| `--red-600` | `#C40018` | Error 700 | 오류 글자·빨간 배지 |
| `--accent-ours` | `#1E3A8A` | Primary 600 | 조달 자사색(차트 계열·범례·표 글자·자사 행 8% 틴트) — 차트 PR-5 |

L2 재연결: `--surface-page/card` N0 · `--surface-sidebar/muted` N50 · `--surface-inverse` N900 · `--border-subtle` N100 · `--border-default/button` N200 · `--accent-primary` P600 · `--accent-primary-strong` P700 · `--text-primary` N900 · `--text-secondary/tertiary/placeholder` N600 · `--text-on-accent`·`--text-inverse` N0 · `--text-danger` E700 · `--surface-danger` E500 8% · `--border-danger` E500.

## 6. 접근성 규칙

**500 단계는 채움 장식·포커스 고리·아이콘·그래픽에만 씁니다. 글자와 글자 배경은 600/700(성공·경고 글자는 800)을 씁니다.**
흰 바탕 기준 500 단계 대비: Primary 4.40 · Error 3.76 · Info 3.68 · Success 2.28 · Warning 2.15 — 모두 글자 AA(4.5:1) 미달입니다.

`tests/unit/tokens.test.ts` 가 Penta 값으로 계산해 검사하는 주요 짝:

| 짝 | 대비 |
|---|---|
| 흰 글자 on `--action-bg`(P600) / hover(P700) | 6.35 / 9.37 |
| 흰 글자 on `--danger-bg`(E700) | 6.47 |
| N600 보조 글자 on 흰색 / N50 / N100 | 6.61 / 6.22 / 5.69 |
| N900 on lime 별칭(P100) | 12.65 |
| P600 on P500 12% 틴트 | 5.44 |
| E700 on E500 10% 틴트(N50 위) | 5.36 |
| Success 800 on S500 12% 틴트 / Warning 800 on W500 15% 틴트 | 6.43 / 6.31 |
| X-700 on X-50 (Status Badge) | Success 4.79 · Warning 4.84 · Error 5.91 · Info 6.16 |
| 포커스 고리 P500 on 흰색 / N50 / P100 (그래픽 3:1) | 4.40 / 4.14 / 3.07 |
| 차트 계열 색 on 흰색·N50 (그래픽 3:1) | 전부 3:1 이상 |
| N900 / N600 / P600 글자 on 자사 행 틴트(P600 8%) | 16.12 / 5.89 / 5.65 |

### 조달 차트 팔레트 (디자인 PR-5)

`src/features/procurement/charts/palette.ts` 가 매핑하고 렌더링(#88)은 바꾸지 않습니다. 계열마다 표식 모양(원·사각·삼각·마름모·역삼각·십자)과 범례·툴팁·표의 이름이 색과 함께 구분합니다.

| 계열 | 토큰 | 값 | 흰색 / N50 대비 |
|---|---|---|---|
| 자사 | `--accent-ours` | Primary 600 `#1858CC` | 6.35 / 5.98 |
| 경쟁사 1 | `--chart-series-1` | Warning 700 `#B45309` | 5.02 / 4.73 |
| 경쟁사 2 | `--chart-series-2` | 보충값 teal `#0D9488` | 3.74 / 3.52 |
| 경쟁사 3 | `--chart-series-3` | 보충값 magenta `#BE185D` | 6.04 / 5.68 |
| 경쟁사 4 | `--chart-series-4` | 보충값 brown `#78350F` | 9.07 / 8.54 |
| 나머지 | `--penta-neutral-600` | Neutral 600 `#545D70` | 6.61 / 6.22 |
| 최근 연도 선 | `--penta-neutral-900` | Neutral 900 `#111620` | 18.1 / 17.0 |

- 선택 근거: 자사 파랑·나머지 회색과 색상(hue)이 겹치지 않는 주황·청록·자홍·갈색. Primary·Info 파랑 계열은 경쟁사에 쓰지 않습니다(예전 문제: 경쟁사 1 = 밝은 Primary 500 이 자사 남색과 같은 파랑, 대비 2.35:1).
- 색차(OKLab ΔE×100): 자사 ↔ 경쟁사 1~4 = 32.9 · 22.1 · 30.6 · 29.5, 경쟁사·나머지끼리 최소 14.4(경쟁사 1↔3). 적록 색각(deutan·protan) 모의에서도 자사 ↔ 경쟁사 최소 18.5.
- 모든 계열이 흰색 3:1 이상이어야 해서 **계열끼리 3:1 은 불가능**(4단계 명도 분리 불가) → 표식 모양으로 보완합니다. `tokens.test.ts` 가 3:1·ΔE 를 검사합니다.
- 보충값 3색은 디자인팀 회신 시 교체합니다. 의미색(성공·경고·오류)과 헷갈리지 않도록 차트 밖에서는 쓰지 않습니다.

### CSS 변수를 못 쓰는 곳 (디자인 PR-5)

React-PDF 견적서(`QuotePdf.tsx`)는 `src/lib/design/penta-colors.ts` 의 `PENTA_COLORS`(L1 hex)를 씁니다. 값은 globals.css L1 과 같아야 하며 `tests/unit/design/penta-colors.test.ts` 가 대조합니다. 견적서: 본문 N900 · 보조 N600 · 선 N200 · 표 머리 N100 · 합계 P600 · "가견적" 배지 Warning 50 + 700.

## 7. 아이콘 (디자인 PR-3)

Penta 아이콘 라이브러리(383개, 24×24, 1px 선, currentColor) 중 **화면에서 쓰는 것만** 생성 파일로 커밋한다.
원본 JSON 은 저장소에 넣지 않는다(`/design/` gitignore). CI·앱은 생성 결과만 쓴다.

### 생성

```bash
pnpm exec tsx scripts/gen-penta-icons.ts /절대/경로/pentaicon-library.json   # 기본: design/pentaicon-library.json
```

- `scripts/gen-penta-icons.ts` 의 `PENTA_ICON_ALLOWLIST` = 사용 아이콘 목록. 아이콘을 늘리면 여기에 이름을 더하고 다시 생성한다.
- 출력 `src/components/icons/penta.tsx` — SVG 를 **JSX 요소**로 옮긴 typed 맵(`PENTA_ICONS`, `PentaIconName`). `dangerouslySetInnerHTML`·문자열 HTML 없음.
- 원본 좌표·`viewBox`·선 두께 그대로. 속성 없는 `<g>` 를 풀고, 같은 부모 안에 겹쳐 그린 똑같은 path 는 하나만 남긴다.
- allowlist 이름이 라이브러리에 없거나, 허용하지 않은 요소(script 등)·속성(on* 등)·색(currentColor·none 외)이 있으면 **실패**한다.

### API

```tsx
import { DisclosureIcon, Icon } from '@/components/icons/Icon';

<Icon name="search" />                     // 장식: aria-hidden="true" focusable="false", 20px
<Icon name="warning" size={24} title="경고" /> // 의미 전달: role="img" + <title> + aria-label
<DisclosureIcon open={expanded} />         // 펼치기(▾)·접기(▴) = chevron-right 90°·-90° 회전
```

### 규칙

- **선 두께 원본(1px) 유지** — stroke 덮어쓰기 prop 없음.
- **렌더링 최소 20px** — `size` 는 타입에서 `20 | 24` 만. 16px 이하는 1px 선이 0.67px 로 흐려진다(#88 회귀). `shrink-0` 기본.
- **색은 currentColor** — 부모 글자색(`text-*`)으로 준다.
- **aria** — 기본 장식(`aria-hidden`). 아이콘만 있는 버튼은 버튼에 `aria-label` 을 주고 아이콘은 장식으로 둔다. 아이콘 자체가 의미를 전달할 때만 `title`.
- 라이브러리에 없는 아이콘을 직접 그리지 않는다 — 아래 "라이브러리 추가 요청 후보"로 올린다. 회전(chevron)은 그리기가 아니므로 허용.

### 매핑 (구현)

| 자리 | 기존 | Penta | 비고 |
|---|---|---|---|
| 사이드바 HOME | home | `home` | 일치 |
| 사이드바 계산기 | calc | `calculator` | 일치 |
| 사이드바 가격정책 관리 | shield | `file-edit` | 대체(정책 문서 편집 — file-log·file-text 와 연필로 구분) |
| 사이드바 사용자 · 권한 | users | `users` | 일치 |
| 사이드바 등록 품목 | list | `list` | 일치 |
| 사이드바 감사 로그 | log | `file-log` | 일치 |
| 사이드바 입찰 공고 | doc | `file-text` | 일치 |
| 사이드바 조달 실적 현황 | chart(막대) | `chart-line` | 대체 |
| 사이드바 원가 관리 | box | `won-note` | 대체(파츠와 구분) |
| 사이드바 파츠 관리 | box | `blocks-2` | 대체(원가와 구분) |
| 사이드바 솔루션 그룹 관리 | group | `grid` | 대체 |
| 헤더·필터 검색 입력 7곳 | search 16px | `search` 20px | 일치 |
| 헤더 알림 버튼 | bell 16px | `bell` 20px | 일치 |
| 헤더 챗봇 버튼 | chat 16px | `message` 20px | 대체 |
| 회사 API 키 주의 안내 | 경고 삼각형 16px | `warning` 20px | 대체(원 + 느낌표 + 양옆 호 — 경고 의미 확인) |
| 조달 범례 표시/숨김 | 인라인 눈 svg 14px | `eye` / `eye-off` 20px | 일치 |
| 닫기 ×·✕ — 모달 CloseButton, 챗봇 패널, 과금 안내, 파츠 선택 칩, 조달 품목 안내, 장바구니 줄 삭제, 키워드 칩, 빠른 필터 해제, 계약 목록 "닫기", 모바일 메뉴(열림) | 글리프 | `close` 20px | 일치 |
| 펼치기 ▾▴ — 빠른 필터 필드 버튼, 범례 "+N", 제조사 표 "전체 펼치기/접기" | 글리프 | `chevron-right` 90°/-90° | 대체(회전) |

### 라이브러리 추가 요청 후보 (보류 — 기존 아이콘 유지)

Penta 라이브러리에 대응 아이콘이 없어 `src/features/shell/icons.tsx`(`LegacyIcon`)·기존 표시를 그대로 둔다. Main 경유 디자인팀 요청.

| 필요 아이콘 | 쓰는 자리 | 비고 |
|---|---|---|
| tag(가격표) | 사이드바 가격 정책 조회·공지사항 관리, 알림 "정책 적용" 유형 | |
| cart(장바구니) | 사이드바 조달 관리 | |
| info(원 안 i) | InfoHint 트리거(16px), Pill info 톤(14px), ERP 안내 | `help-circle`·`alert-circle` 은 의미가 달라 쓰지 않음 |
| menu(☰) | 모바일 메뉴 열기 버튼 | 닫힘 상태 글리프만 유지(열림 = `close`) |
| external-link | 입찰 공고 원문 링크(14px) | |
| refresh / 진행 중 | 조달 헤더 "수집 중" 표시(12px) | 라이브러리 `refresh` 는 있으나 매핑 미결정 + 12px 자리 |

### 작은 크기 유지 자리 (20px 가 들어가지 않음 — 기존 표시 유지)

| 자리 | 크기 | 이유 |
|---|---|---|
| 알림 목록 유형 배지(bell·users·tag) | 28px 원 안 14px | 배지 여백이 4px 로 줄어 배지 디자인이 깨지고, 보류 tag 와 한 목록에 섞인다 |
| 조달 헤더 수집 상태(진행 중·실패) | 12px | 12px 문구 줄 안 인라인 표시 |
| Pill info 톤 아이콘 | 14px | info 보류 + 알약 높이 |
| InfoHint 트리거 | 16px | info 보류 |
| 입찰 공고 원문 링크 | 14px | external-link 보류 |

아이콘 범위 밖(컨트롤 표시·데이터 표현, 교체하지 않음): 정렬 삼각형, 체크박스 ✓/−, 차트 마커·범례 견본, 상태 점, Google 로고, 가격 변동 ▲▼, 본문 화살표(→), 수량 표기 "× N".
