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

## 4. 컴포넌트 수치 (참고 — 적용은 공용 컴포넌트 PR)

| 컴포넌트 | 문서 값 | Prami 적용 시 |
|---|---|---|
| Button | 높이 44(MD)/36(SM)/52(LG) · 패딩 16 · 반경 8 · 14 SemiBold | Primary = `--action-bg`(**600**) + 흰 글자, Secondary = 흰 바탕 + 600 글자·테두리, Danger = `--danger-bg`(Error **700**), Ghost = N50 / N700 글자 / N200 테두리 |
| Status Badge | 높이 28 · 패딩 8 · 반경 full · 12 SemiBold · X-50 배경 + X-700 글자 | Info 는 Primary 와 색이 거의 같아(1.2:1) 아이콘을 함께 |
| Input | 높이 44 · 패딩 12 · 반경 8 · 테두리 N200 · focus P500 | 자리표시 글자 N600 |
| Card | 배경 N0 · 테두리 1px N100 · 반경 12 · 그림자 md · 패딩 20 | |

문서 표의 Button Primary·Secondary·Danger 는 500 단계를 글자·글자 배경에 씁니다 — 아래 접근성 규칙에 따라 600/700 으로 올려 씁니다.

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
| `--accent-ours` | `#1E3A8A` | (유지) | 조달 차트 자사색 — 차트 팔레트 PR 에서 정함 |

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
