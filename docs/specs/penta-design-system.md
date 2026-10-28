# Penta 디자인 시스템 + 펜타 아이콘 전면 적용

- 요청: Main msg_13e4e995dbf1 (2026-10-28). 사용자: "디자인에 대한 전체적인 손을 볼 필요가 있는데 design 폴더에 첨부한 디자인 시스템과 아이콘을 적용해줘".
- 자료(미추적, Main 체크아웃에만): `/home/plan1/Desktop/Prami/design/penta-design-system.md`(v2.0.0), `/home/plan1/Desktop/Prami/design/pentaicon-library.json`(383개). 절대경로로 읽음.
- 모드: QA 생략. 직접 구현 SVG 차트 유지, #88 렌더링·#89 가운데 드래그 유지.
- 검토: UI/UX·기능/기술 병렬. 원인·구조 진단 일치, 상충 없음. 사용자 범위 질문 1건(§9 Q-D1 밀도) — PR-2 만 대기.

## 1. 원칙
1. **접근성이 문서 값보다 우선.** Main 제약("접근성·대비 회귀 금지") 근거. 문서 500 단계는 흰 바탕 글자·흰 글자 배경에서 AA 미달(Primary 4.40, Error 3.76, Success 2.28, Warning 2.15, Info 3.68) → 글자·글자 배경은 600/700, 500 은 채움 장식·포커스 고리·아이콘·그래픽에만.
2. **브랜드 축 전면 교체**: 현재 lime(`--accent-primary`)·purple(포커스·선택) → Penta Primary Blue. 일부 lime 유지 없음.
3. **문서에 없는 값은 보충값**: Neutral 300/700/800, Primary 200~400·800, 시맨틱 50 단계는 Tailwind 표준 대응값으로 보충하고 `docs/design/penta-tokens.md` 에 "보충값" 표시. 디자인팀 회신 시 교체.
4. **다크 테마 비범위**: 문서에 다크 토큰 없음. 의미 토큰 층(L2)을 유지해 나중에 `[data-theme=dark]` 로 L2 만 재정의하면 되도록 구조만 열어 둠.
5. **원본 자료는 저장소에 넣지 않음**: md 에 Figma URL·사내 아카이브 언급·PPT 규칙이 있음 → 웹 §1~§7 값만 요약한 `docs/design/penta-tokens.md`(Figma 링크·PPT 제외)를 커밋. JSON 원본(526KB)도 미커밋, 생성된 TSX(사용분만)만 커밋. `/design/` 을 `.gitignore` 에 추가.

## 2. 토큰 구조 (PR-1)
- 현재: Maglo 토큰 85개, `@theme inline { --color-*: initial }` 로 Tailwind 기본 팔레트 꺼짐, `tests/unit/tokens.test.ts` 가 Maglo fixture 와 대조.
- **L1 원시값**: `--penta-primary-50…900`, `--penta-neutral-0…900`, `--penta-{success,warning,error,info}-{50,500,700}`, 타입 스케일, 간격, 반경, 그림자(sm/md/lg/xl).
- **L2 의미 토큰**(기존 이름 유지·재연결): `--surface-*`, `--border-*`, `--text-*`, `--accent-*`, 신규 `--action-bg`(P600)/`--action-bg-hover`(P700)/`--action-fg`(white), `--focus-ring`(P500), `--danger-bg`(Error700), `--link`(P600), placeholder 글자 N600.
- **L3**: `@theme inline --color-*` 매핑. 원시 클래스 이름(`primary-*`, `neutral-*`, `success-*` …) 제공.
- 반경·높이는 **새 이름 추가만**(`--radius-card` 등), 기존 `--radius-lg` 값은 PR-1 에서 바꾸지 않음(조용한 전역 변경 방지). 실제 적용은 PR-2.
- 기존 Maglo 원시 이름(lime/purple/ink/gray-75 …)은 PR-1 에서 **Penta 값으로 재지정한 별칭**으로 남겨 화면이 한 번에 Penta 색으로 바뀌게 함(사이드바만 파랗고 버튼은 라임인 기간 없음). 별칭 제거는 PR-6.
- `tokens.test.ts`·fixture 를 Penta 기준으로 재작성. **대비 검사는 유지**(Penta 값 기준 AA 4.5·차트 3:1).
- 폰트: `next/font/local` + `PretendardVariable.woff2`(전체 글리프, ≈2MB, LAN 캐시 전제) 를 `src/app/fonts/` 에 커밋 + OFL 전문. jsdelivr `<link>`·preconnect 제거, CSP(`server/security/headers.ts`)에서 jsdelivr 제거. PDF 용 NotoSansKR 는 그대로.

## 3. 공용 컴포넌트 (PR-2, Q-D1 답 후)
- 대상: `components/ui` button·input·select·card·pill/badge(Status Badge 4종 신설 또는 Pill 정리)·modal·drawer·popover·checkbox·radio·segmented·table.
- 문서 §6 값: Button radius 8·14 SemiBold·패딩 16(Primary=action-bg, Secondary=흰 바탕+P600 글자·테두리, Danger=Error700, Ghost=N50/N700/N200), Input radius 8·패딩 12·테두리 N200·focus P500, Card N0·1px N100·radius 12·shadow md·패딩 20, Badge 높이 28·radius full·12 SemiBold·X50 배경/X700 글자, 모달 shadow lg·radius 16, 드로어 shadow xl.
- Info 배지·안내는 Primary 와 거의 같은 색(1.2:1) → Info 는 700 + 아이콘 동반.
- 높이·본문 크기는 §9 Q-D1 답에 따름.
- 사이드바 활성: P50 바탕 + P700 글자 + 왼쪽 3px P500 막대(문서에 내비 정의 없음 → Plan 결정).

## 4. 아이콘 (PR-3)
- 생성기 `scripts/gen-penta-icons.ts`: 입력 = 로컬 `design/pentaicon-library.json`(gitignore 경로, 절대경로 인자 가능), **사용하는 아이콘만 allowlist** → path 를 JSX 로 변환한 typed TSX `src/components/icons/penta.tsx` 생성·커밋. 중복 path 제거(SVGO 수준). `dangerouslySetInnerHTML` 금지. CI 는 생성 결과만 사용(JSON 불필요).
- API: `<Icon name size={20|24} title? />`. 기본 `aria-hidden`, `title` 있으면 `role="img"`.
- **선 두께 원본 유지(1px), 렌더링 최소 20px.** 16px 이하로 줄이지 않음(0.67px 흐림 = #88 회귀). stroke 오버라이드 금지. 20px 가 안 들어가는 자리는 기존 표시 유지하고 목록화.
- 교체 대상: `features/shell/icons.tsx` 16종 + 인라인 `<svg>` 12개(10파일) + `×`/`✕` 닫기 글리프.
- 매핑 결정:
  | 현재 | Penta | 결정 |
  |---|---|---|
  | home·calc·shield·users·search·bell·list·eye | home·calculator·shield·users·search·bell·list·eye/eye-off | 일치 |
  | log | file-log | 일치 |
  | doc(입찰 공고) | file-text | 일치 |
  | chart(조달 실적) | chart-line | 대체 |
  | chat | message | 대체 |
  | group(솔루션 그룹) | grid | 대체 |
  | box(원가) / box(파츠) | won-note / blocks-2 | 대체(둘 구분) |
  | 경고 | warning | 대체(모양 확인) |
  | ×·✕ 닫기 | close | 일치 |
  | ▾▴ 펼치기 | chevron-right 90°/-90° 회전 | 대체(회전은 그리기 아님 → 허용) |
  | tag(가격 조회·공지·알림) | 없음 | **보류 — 기존 유지** |
  | cart(조달 관리) | 없음 | **보류 — 기존 유지** |
  | info(InfoHint·ERP 안내) | 없음(help-circle·alert-circle 은 의미 다름) | **보류 — 기존 유지** |
  | ☰ 모바일 메뉴 | 없음 | 보류 — 기존 유지 |
  | external-link | 없음 | 보류 — 기존 유지 |
- 아이콘 범위 밖(컨트롤 표시·데이터 표현): 정렬 삼각형, 체크박스 ✓/−, 차트 마커, 상태 점, Google 로고, 본문 화살표 글리프(→).
- 보류 목록은 `docs/design/penta-tokens.md` 에 "라이브러리 추가 요청 후보"로 기록 → Main 경유 디자인팀 요청.

## 5. 화면 sweep (PR-4a~c) — 원시 클래스 566곳(128파일)
- 변환표 기반 codemod + **의미 판단 수작업**(예: `ink-900` 이 글자면 `text-primary`, 어두운 패널이면 `surface-inverse`). 기계적 1:1 치환 금지.
- 순서: 4a shell·auth·notices → 4b pricing·costs·parts·calculator → 4c admin·users·imports → 4d procurement(수집기 PR-1 머지 후, 맨 끝).
- 타이포 스케일(H1~Caption) 적용도 이 단계.
- 색 클래스 단언 테스트(25파일·77줄) 함께 갱신.

## 6. 차트·슬라이더·기타 hex (PR-5)
- 차트: 자사 = Primary 600, 경쟁사 4계열 = 차트 전용 토큰 `--chart-series-1..4`(값은 Penta 700 계열 중 서로·흰 바탕 3:1 이상, 의미색과 혼동 피하도록 범례 마커 모양 병행 유지), 기타 = Neutral 600. 렌더링 로직(#88) 무변경, `palette.ts` 매핑만.
- 슬라이더: purple → `--focus-ring`/`--action-bg`, gray → neutral. 가운데 드래그·핸들 섞임 구간(#89) 유지.
- 견적 PDF(`QuotePdf.tsx`) 색·제품 카드 액센트(`product-cards.ts`)·`pricing/cells.tsx:15` hex → Penta 값(PDF 는 CSS 변수 불가라 상수 모듈). `GoogleButton` 브랜드색은 예외.

## 7. 정리 (PR-6)
- Maglo 별칭 제거, ESLint 로 옛 원시 이름 className 금지(`eslint.config.mjs` 기존 패턴 재사용).

## 8. 순서·충돌
- 수집기 작업 우선: 수집기 PR-1(메일 보고 탭·헤더)이 머지된 뒤 디자인 PR-1 착수. 수집기 PR-2/3·OPS(Python·운영)는 디자인과 파일이 겹치지 않아 교차 진행 가능.
- 의존: PR-1 → PR-2(Q-D1) → PR-4 → PR-5 → PR-6. PR-3 은 PR-1 뒤 독립.

## 9. Main 되묻기
- **Q-D1 밀도**: 문서는 본문 16px·버튼/입력 44px 인데 표·빠른 필터·드로어 같은 밀집 화면 규칙이 없음.
  - A: 전 화면 문서 그대로(16/44) — 문서 충실 / 표·필터 세로 길이 크게 늘고 한 화면 정보량 감소, E2E 레이아웃 영향 큼
  - B: 밀집 화면(표·필터·드로어·관리 목록)은 BodySmall 14·SM 36, 폼·독립 버튼·모달 주요 버튼은 MD 44·Body 16 — 정보량 유지 / 문서에 없는 구분 규칙을 Prami 가 정의
  - Plan 의견: B

## 10. 수용 기준
공통: 각 PR Dev 게이트 + 머지 head `ci:run` 녹색(QA 생략). **전후 스크린샷은 E2E 합성 데이터 화면에서만**(LAN 조달 실데이터 화면 캡처를 PR·이슈에 올리지 않음). design/ 원본·Figma 링크 미커밋.
- [ ] PR-1: L1/L2/L3 토큰, `tokens.test` Penta 기준 재작성(AA 4.5·차트 3:1 검사 유지), lime/purple 이 화면에 남지 않음(별칭 재지정), Pretendard 셀프호스트·jsdelivr 제거(CSP 포함)·네트워크 탭에 외부 폰트 요청 0, `.gitignore /design/`, `docs/design/penta-tokens.md`(보충값 표시, Figma·PPT 제외)
- [ ] PR-2: §3 값 반영, Q-D1 규칙 반영, 포커스 고리 모든 컨트롤 표시, 모달 Esc·포커스 트랩·드로어 회귀 없음
- [ ] PR-3: 생성기·`Icon`·allowlist, 원본 1px·최소 20px, aria 규칙, §4 매핑, 보류 목록 문서화, `dangerouslySetInnerHTML` 없음
- [ ] PR-4: 원시 클래스 → 의미 토큰, 영역별 전후 스크린샷(합성), 표 가로 스크롤·빠른 필터 칩 줄바꿈·계산기 STEP 레이아웃 정상
- [ ] PR-5: 차트 팔레트 3:1, 범례 마커·키보드·표로 보기·툴팁 유지, 슬라이더 가운데 드래그·안티앨리어싱 유지, PDF 색 변경 확인
- [ ] PR-6: 옛 이름 grep 0, ESLint 금지 규칙
- [ ] Dev 자체 확인 목록(UI/UX 검토 F): Tab 순회 포커스, 표·필터·계산기·조달·관리·알림·빈/로딩/에러·모바일 너비

## 11. 비범위
다크 테마, 디자인 시스템 PPT 규칙, 라이브러리에 없는 아이콘 직접 그리기, 차트 라이브러리 전환, 시각 회귀 자동화(스크린샷 테스트) 도입.

## 12. 진행 기록
