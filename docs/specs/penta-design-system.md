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
- 순서: 4a shell·auth·notices·settings → 4b pricing·costs·parts·calculator → 4c admin·users·imports → 4d procurement(수집기 PR-1 머지 후, 맨 끝).
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
- 2026-10-28 Q-D1 = B(사용자 확인, Main msg_b73906ce7c91): 밀집 화면(표·필터·드로어·관리 목록) = BodySmall 14px·SM 36px, 폼·모달·주요 버튼 = Body 16px·MD 44px. 구분은 컴포넌트 `size`/밀도 prop 으로(밀집 화면 컨테이너가 기본 sm 을 지정), 화면별 임의 클래스 덮어쓰기 금지. 나머지 Plan 판단 전부 수용 → PR-2 대기 해제.
- 2026-10-28 Main msg_2b955b6ab258: 사용자 '다 작업해줘' → 수집기 PR-1~3+LAN 가동과 함께 PR-1~6 중간 승인 없이 연속 진행 배정. 교차 순서는 §8, PR-4d 는 수집기 PR 모두 머지 후.
- 2026-10-28 PR-1 #93(bb02584) 머지(CI 40643824639, E2E 195/195, QA 생략). Dev 해석 수용: lime 채움(어두운 글자) → P100(12.65:1), 주요 버튼 action-bg P600+흰 글자, 보충값 Success 800 #166534·Warning 800 #92400E 추가, orange → Warning 500, text-secondary·tertiary 모두 N600(위계는 크기·굵기로 — PR-4 에서 필요 시), 차트 초록 Success 800·경쟁사/자사 대비는 PR-5, Primary 보충 200/300/400/800 = Tailwind blue 300/400/500/900. 사이드바 활성 최종 모양(P50+P700+왼쪽 막대)은 PR-2 에서.
- 2026-10-28 sweep 범위 보완(Dev msg_18d0795c5ba3, 비블로킹): features/settings(LLM 키 카드 등 개인 설정)는 §5 에 없었음 → 4a 에 포함(사용자 공통 화면). notices 공용 부품(NoticeRows·NoticeFormModal 등)은 4a, 4c 는 NoticesAdminTable 만. 4c 커밋 완료(범위 안 원시 색 0), 4b 착수.
- 2026-10-28 PR-2 #94 머지(squash f7e366a): 공용 컴포넌트 Penta 값(버튼·입력·카드·배지·모달·드로어·팝오버·체크박스·세그먼트), 밀도 Q-D1=B, 사이드바 활성(P50·P700·3px P500), 포커스 고리 통일. 게이트 unit 3712·E2E 195/195, CI 녹색(rebase 후 재실행). Dev 해석 수용: 밀도는 React context 대신 상속 CSS 변수 `[data-density]`(서버 컴포넌트·문자열 import 보존) — Table·DataTable·빠른 필터·Drawer = sm 36/14, Modal = md 44/16, 컨트롤 size 선택 사항 / variant 없는 기본 Button 이 회색 → 흰 바탕+파랑 글자·테두리(Secondary) / 표 본문 13→14px, size="sm" 109곳 32·12→36·14 / dense 밖 Segmented(계산기·파츠·조달 관리 탭) 44·16. 이로써 PR-U1·PR-C2 대기 해제.
- 2026-10-28 PR-3 #96 머지(squash 675d780): 아이콘 생성기(사용분 allowlist → JSX, dangerouslySetInnerHTML 0), `<Icon size 20|24>`(기본 aria-hidden, title 있으면 role=img), 사이드바·검색·벨·채팅·경고·범례 눈·닫기 10곳·펼치기 3곳 교체. 게이트 unit 3728·E2E 195/195, CI 녹색. 보류(현 아이콘 유지, `docs/design/penta-tokens.md` 에 라이브러리 추가 요청 후보로 기록): tag, cart, info, ☰, external-link + 조달 헤더 새로고침·수집 중 — 디자인팀 요청은 Main 경유(전체 묶음 완료 보고 때 전달). 작은 크기 예외 수용: 알림 유형 배지 14px(28px 원 안)·조달 헤더 상태 12px(12px 글줄) — 글줄·원 안 장식 아이콘이라 최소 20px 규칙의 예외로 둠.
- 2026-10-29 PR-4c #99 머지(main 2cb5e8a, head fdcbf41, CI 녹색): 관리·사용자·가져오기 화면 의미 토큰·타입 스케일. 마이그레이션 없음. Dev 해석 수용: 13px→BodySmall 14px, 15px 제목→text-h2, 12px Caption·11px 배지 유지, red→text-danger/surface-danger, purple 링크→text-link, gray-75→surface-muted, green/amber→success/warning(글자 700·바탕 50). 전후 스크린샷(합성 1440×900)은 로컬 보관·PR 미첨부(gh CLI 이미지 업로드 불가) — 기본안 수용.
- 2026-10-29 PR-4b #100 머지(main beb5ea7, head 61bc7b6, CI 녹색): 가격 정책·원가·파츠·계산기 화면. 마이그레이션 없음. Dev 해석 수용: 계산기 어두운 요약 패널 bg-ink-900→surface-inverse+text-inverse, 라벨 lime-500→primary-100(PR-1 lime→P100 해석과 일치), 보조 글자 text-inverse/60(어두운 바탕 위 AA 충족), 경고 warning-500 유지(BL-2 대비 근거, 어두운 바탕). 선택 상태: STEP 칩 primary-100+primary-700, 선택 행 primary-600/8, '현재' 배지 primary-50+primary-700, 줄 합계 primary-600. 게이트 unit 3768·integration 31·build, E2E 단독 재실행 196 + items-master fresh DB 2/2. 계산기 STEP 레이아웃 합성 스크린샷 전후 동일.
- 2026-10-29 PR-4a #101 머지(main 5b9541a, head f95f7bf, CI 녹색): 셸·인증·공지·설정·챗봇 화면. 마이그레이션 없음. 게이트 unit 3782·integration 31·E2E 204/204. Dev 해석 수용: 알림 안 읽음 purple→primary-50 바탕·primary-600 점 / 손으로 짠 '다시 시도' 버튼 2곳 → 공용 Button(primary·ghost sm) / 포커스 고리 보강(알림 벨·항목·모두 읽음·검색 필터 칩·Google 버튼) / Google 버튼은 바탕·글자·반경만 토큰, G 로고 4색은 브랜드 예외 / 홈 제품 카드 액센트 hex 는 PR-5 범위. 이로써 4a·4b·4c 완료(4d 는 C3 뒤).
- 2026-10-29 경량 요구(Main msg_b5ccf395966f): 사이드바 '가격정책 관리' 아이콘 shield → file-edit, #102 머지(main 655d932, CI 녹색, 게이트 lint·typecheck·format·unit 3782). 20px 나란히 렌더링에서 file-log·file-text 와 구분돼 대안(list-check) 미사용. shield 는 이 메뉴만 써서 allowlist 에서 제거(19개), penta-tokens.md 매핑 표 갱신. Dev 실수 보고: 4d rebase 를 잘못된 경로에서 실행해 Dev 워크트리(LAN :3000)가 약 5초 rebase 충돌 상태 → 즉시 abort, origin/main·clean 복구, /login 200 확인.
- 2026-10-29 PR-4d #104 머지(main e834798, head d7d1060, CI 녹색): 조달 화면 + chat-pages '스트리밍 중지' E2E 안정화(요청이 가로채진 뒤 중지·해제, 단독 15/15). 마이그레이션 없음. Dev 해석 수용: 표 페이지 이동·xlsx 내려받기·근거 보기 손짠 회색 알약(h-7/8) → Ghost sm(36·14, rounded-control, neutral 테두리) + 포커스 고리, 차트 팔레트는 PR-5. 이로써 PR-4 전부 완료.
- 2026-10-29 PR-5 #105 머지(main 4fd2921, head aab1a07, CI 녹색): 차트 팔레트·슬라이더·PDF/제품 카드/셀 hex. 마이그레이션 없음. 자사 accent-ours=P600(흰 바탕 6.35:1), 경쟁사 series-1 W700(5.02)·2 teal #0D9488(3.74)·3 magenta #BE185D(6.04)·4 brown #78350F(9.07), 나머지 N600. 범례·표식 모양·키보드·표로 보기·툴팁 유지, tokens.test 가 3:1·ΔE 검사. 슬라이더 purple→action-bg/focus-ring/neutral(#89 가운데 드래그 유지). PDF 는 PENTA_COLORS 상수(L1 대조 테스트). Dev 해석 수용: ① 경쟁사 2~4 는 보충값(Penta 안에서 hue 분리 + 3:1 을 넘는 색이 W700 하나뿐) — 차트 밖 사용 금지, 디자인팀 회신 시 교체(라이브러리 추가 요청 후보에 포함) ② 홈 제품 카드 액센트 Primary 600/50 통일(기존 hex 2개가 글자 AA 미달 2.9·3.5:1). E2E: chat.spec ask 헬퍼가 분당 chat 버킷 429 대기 후 재시도(전역 한도 유지).
- 순서 조정: PR-6 이 이미 전체 게이트 중이라 PR-6 → 챗봇 마크다운(PR-MD) 순으로 진행(PR-MD 는 시맨틱 토큰만 써서 영향 없음).
- 2026-10-29 PR-6 #106 머지(main 7411887, head 6ac3426, CI 녹색, E2E 204/204): globals.css Maglo 별칭 28개 + `--color-*` 유틸리티 제거(accent-ours 유지), 남은 사용처 의미 토큰으로, ESLint DESIGN_ALIAS_SYNTAX 를 no-restricted-syntax 5개 목록 전부에 합침, tokens.test 는 별칭 '제거' 검사, penta-tokens.md §5 '제거됨 — 이전 기록'.
- **Penta 디자인 묶음 완료**(#93·#94·#96·#99·#100·#101·#104·#105·#106 + 아이콘 #102). 수용 기준 메모: 전후 스크린샷은 E2E 합성 데이터 로컬 대조(PR 미첨부), 조달 차트 색은 픽스처에 실적이 없어 단위 테스트로 확인. 남은 백로그: 차트 경쟁사 2~4 보충값·보류 아이콘(tag·cart·info·☰·external-link·조달 새로고침/수집 중) 디자인팀 요청 후보, 챗봇 '중지' 대화 생성 중 무시 창.

## 13. 후속 — 제품별 칩 색 (2026-10-29, 사용자 직접 요청)
- 요구: 사용자 "제품별 컬러가 이거인데 칩 색상을 이거로 바꿔줘" — WAPPLES `#FFDCF6` · D.AMO `#C1C9FF` · iSIGN `#FFF0B5` · Cloudbric `#B0E1FF`. 적용 위치(사용자 선택, 4곳 모두): 홈 제품 카드, 챗봇 제품 칩, 계산기 제품 칩, 가격 정책 '제품군' 표시.
- PR-5 의 "제품 카드 Primary 통일" 을 이 절로 대체(제품 구분을 색으로 다시 함).
- 결정:
  - 토큰: L1 `--penta-product-{wapples,damo,isign,cloudbric}` 4개 + 매핑 상수 1곳(`product-cards.ts` 또는 `lib/constants/product-colors.ts`)에서 제품명 → 토큰. `iSIGN PKI` 는 iSIGN 색. 4개 제품 밖 값은 기존 중립 스타일.
  - 색은 **배경 전용**(연한 파스텔). 위 글자·아이콘은 **고정 진한 색 `--penta-neutral-900`**(다크 모드에서도 밝아지지 않게 — 의미 토큰 text-primary 쓰지 말 것). 대비 4색 모두 12:1 이상.
  - 다크 모드: 같은 파스텔 배경 + N900 글자 유지(칩이 작아 눈부심 문제 적음).
  - 홈 카드: 아이콘 사각형 배경(accentSoft) = 제품 색, 아이콘 = N900. "가격 정책 보기 →" 글자는 Primary 600 유지(흰 카드 위 글자에 파스텔 불가).
  - 챗봇·계산기 칩(선택 가능 칩): 기본 = 제품 색 배경 + N900. 선택 = 같은 배경 + 2px N900 안쪽 테두리 + 굵게 + `aria-pressed`(색만으로 구분 금지). hover = 테두리 1px N900/40. 포커스 고리 유지, 크기 sm(36/14) 유지.
  - 가격 정책: 필터 배지 "제품군: …"(PricingFilters familyBadge, 지금 warning-50) → 제품 색 배경 + N900. 표에 제품군이 이미 배지/칩으로 그려지는 곳이 있으면 같은 규칙, 평문 셀은 새 칩을 만들지 않음.
  - PR-6 ESLint(옛 별칭 금지)·tokens.test 통과. tokens.test 에 4색 × N900 대비 ≥ 4.5:1 검사 추가.
- 비범위: 차트 팔레트(제품 색 아님 — 자사/경쟁사 축 유지), 조달 화면, 제품 외 칩(날짜 퀵칩·필터 칩).
- 처리: 경량(병렬 검토 생략 — 색 지정·위치가 사용자 답으로 확정), Dev 게이트(lint·typecheck·unit + 관련 E2E) + CI 녹색 후 셀프머지, QA 생략. PR 본문에 4곳 합성 데이터 스크린샷(라이트·다크) 로컬 대조 기록.
- 2026-10-29 §13 Dev 해석 4건 수용(msg_a1bdfed93989): ① 챗봇 '제품 선택' 칩은 누르면 바로 '<제품> 견적' 을 보내는 일회성 버튼이라 선택 상태 없음 → 제품 색 + N900 + hover 만, aria-pressed 미사용(토글 아님). 선택 표시 규칙은 계산기 칩에만 ② 앱에 다크 모드 자체가 없음(prefers-color-scheme·data-theme·dark: 없음) → 스크린샷 라이트만, 다크 '해당 없음' ③ 가격 정책 표에 제품군 배지 칸 없음(평문) → 필터 배지만 변경, 4개 밖 제품군 배지는 warning-50 유지. 계산기 STEP 2 '대분류' 칩(같은 Chip)도 제품 색 ④ 대비 실측(N900 대비): WAPPLES 14.51 · D.AMO 11.27 · iSIGN 15.86 · Cloudbric 12.99 — 스펙의 '12:1 이상' 문구는 D.AMO 가 미달이나 수용 기준 4.5:1 은 모두 충족.
