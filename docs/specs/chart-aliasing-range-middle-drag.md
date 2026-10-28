# 차트 계단현상 제거 + 범위 슬라이더 가운데 드래그

- 요청: Main msg_14737165e243 (2026-10-28). 직접 구현 SVG 차트 유지(라이브러리 전환 안 함). QA 생략 모드.
- 검토: UI/UX·기능/기술 병렬 검토. 원인 진단 일치, 세부 차이는 보완 관계 → Plan 결정. Main 되묻기 없음.
- 우선순위: 진행 중인 `jodari-csv-lan-preload` 를 먼저 끝내고 이 작업 착수(PR-A·PR-B 는 서로 독립).

## 1. 차트 원인 진단 (코드 확인)
`shape-rendering`·`preserveAspectRatio`·CSS transform·filter 는 차트에 없음 → "crispEdges 제거" 는 해당 없음.
- **A. viewBox 너비 반올림**: `ComboChart.tsx:57-58`, `YearlyLineChart.tsx:36-37` 의 `W = Math.round(width)` + `width="100%"` → 640.4px 컨테이너에서 640.4/640 배 스케일 + meet 가운데 정렬로 모든 좌표가 화소 격자에서 어긋남(DPR 1 에서 가장 심함).
- **B. 1px 격자선 소수 y**: Combo 가로 격자, `YearlyLineChart.tsx:180-186` → 2px 흐린 띠.
- **C. 막대 소수 x·width·y·height + 1px 테두리**(Combo 막대) → 가장자리 번짐.
- **D. 연도별 선을 구간마다 `<line>` 으로 그림**(`YearlyLineChart.tsx:229-245`), cap/join 기본값 → 꺾임점마다 V자 틈(체감 "계단" 의 주원인), 점선 패턴 구간마다 재시작.
- **E. 슬라이더 핸들 `radial-gradient` 하드 스톱**(`globals.css` ≈305-330) → 원 가장자리 계단.

## 2. 기술 결정 — PR-A 차트 렌더링
1. viewBox 너비 = 측정한 실수 너비 그대로(반올림 제거). svg 는 `width="100%"` 유지(SSR 첫 화면 넘침 방지) — viewBox 와 실제 너비가 같아 배율 1. 높이는 정수 유지.
2. 가로·세로 1px 격자선·축: 좌표 `Math.round(v) + 0.5`, `shapeRendering="crispEdges"` — **격자·축에만**.
3. 막대: 경계(x, 오른쪽 끝, 위, 아래)를 정수로 스냅해 x·width·y·height 계산(1px 테두리면 +0.5 보정). crispEdges 는 주지 않음.
4. 연도별 선: 값이 이어지는 구간마다 `<path>` 하나, `strokeLinejoin="round"`·`strokeLinecap="round"`(Combo 누적선 방식과 동일). 점선(금액 0) 구간은 별도 path.
5. 선·곡선·표식(Marker)은 기본 렌더링 유지(필요 시 `geometricPrecision` 명시 가능). **곡선 보간 금지**(데이터 왜곡) — 누적선의 평평한 달은 데이터 그대로.
6. 툴팁 x 위치·`band.indexAt` 포인터 계산·키보드·표로 보기 회귀 없음.

## 3. 기술 결정 — PR-B 범위 슬라이더 가운데 드래그
대상: 공용 `src/components/ui/range-slider.tsx` `RangeSlider` 하나 → 판매가(pricing)·계약단가(procurement items)·조회기간(`MonthRangeSlider` → `PeriodFilter.tsx`)·원가(costs)·장바구니(calculator) **모두 적용**(요청 "모든 dual-range 슬라이더, 공용이면 한 번에" 에 해당). 통화 미선택 비활성 슬라이더·단일 핸들 슬라이더(`QuoteSteps.tsx`)는 제외.
1. 트랙 안 `data-range-middle` 영역: 좌우 = `pct(lower)`~`pct(upper)`, 높이 44px(터치 영역), `aria-hidden`, hover `cursor-grab`, 드래그 중 `grabbing`. 핸들 thumb(44px)이 우선(위에 있음).
2. pointerdown → `setPointerCapture`, 시작 칸 `[l0,u0]` 저장. pointermove → `stepFromPointer` 로 칸 차이 δ, δ 를 `[-l0, steps-u0]` 로 제한 → `[l0+δ, u0+δ]`. **폭은 칸(step) 공간에서 유지**(로그 눈금에서 화면상 폭 유지, 월 단위 스냅 자연 적용). 경계에서 멈춤(반대편으로 밀리지 않음).
3. 탭(드래그 없음) 호환: 포인터 이동이 4px 이하로 끝나면 손 뗄 때 **기존 동작**(가까운 핸들을 그 칸으로) 실행 — 기존 단위 테스트 `range-slider.test.tsx:168-169` 유지.
4. `onChange` 의 handle 인자를 `0 | 1 | 'both'` 로 확장. `MoneyRangeEditor` 는 `'both'` 면 두 핸들 모두 "움직임" 표시(옛 URL 값 잔존 방지).
5. 금액 양 끝(칸 0·MAX = "제한 없음"): 구간을 끝까지 밀면 그쪽이 "제한 없음"이 되는 것 **허용**(핸들을 끝까지 끈 것과 같은 의미). 끝에 붙은 구간을 반대로 끌면 구체 금액이 됨 — 허용.
6. `onCommit` 은 pointerup/pointercancel 에 1회. 기존 400ms 디바운스·R1/R2·flush 경로 변경 없음.
7. 폭 0(두 핸들 같은 칸)·전체 범위 선택·구간이 핸들 터치 영역보다 좁음 → 가운데 드래그 없음(커서 default), 기존 핸들 동작만.
8. 키보드: 가운데 영역은 포커스 대상 아님 — 기존 두 핸들 키보드 조작 유지(WAI-ARIA multi-thumb). 별도 구간 이동 키는 비범위.
9. 스크린리더: 드래그 후 두 핸들 `aria-valuetext` 갱신(기존). 금액 범위 텍스트 p 를 `<output>` 으로 바꿔 월 모드와 맞춤.
10. 같은 PR 에 원인 E: 핸들 `radial-gradient` 색 경계마다 0.5~1px 섞임 구간.

## 4. 수용 기준
공통: Dev 게이트(§3.1) + 머지 head SHA `ci:run` 녹색(§3.3) — QA 생략. 조달이 원본 데이터는 테스트·스크린샷·PR 에 넣지 않음(합성 값).

PR-A 차트
- [ ] 측정 너비 640.4 흉내 시 viewBox 너비 640.4(반올림 없음) — 단위 테스트
- [ ] 가로 격자 y 가 `.5` 로 끝나고 격자·축에만 `shape-rendering=crispEdges` — 단위 테스트
- [ ] Combo 막대 x·width·y·height 가 정수(또는 테두리 보정 .5) — 단위 테스트
- [ ] 연도별 차트 `[data-line]` 안 `line` 요소 0개, `path` 1개 이상, round join/cap — 단위 테스트(`yearly-line-chart.test.tsx:30-31` 을 path 기준으로 수정)
- [ ] 툴팁 위치·키보드 이동·표로 보기 기존 테스트 통과
- [ ] Dev 자체 확인(LAN): 라이트/다크 × DPR 1/2 × 너비 3종(280 미만·≈480·1280)에서 격자 1px 선명, 꺾임점 틈 없음, 막대 가장자리 번짐 없음, 표식 원형 유지 — PR 본문에 체크 기록

PR-B 슬라이더
- [ ] 가운데 드래그로 두 값이 같은 칸 수만큼 이동, 폭(칸 수) 유지, 경계에서 멈춤 — 단위 테스트(금액·월 각 1)
- [ ] 드래그 1회에 `onCommit` 1회
- [ ] 4px 이하 탭은 기존처럼 가까운 핸들 이동(기존 테스트 유지)
- [ ] 금액 모드 가운데 드래그 후 두 값 모두 URL 에 반영(옛 값 잔존 없음)
- [ ] 폭 0·전체 범위·좁은 구간에서 가운데 드래그 없음
- [ ] 핸들 드래그·키보드·트랙 바깥 클릭 기존 테스트 통과, 터치(pointerType touch) 동작
- [ ] E2E 1건: 계약단가 슬라이더 가운데를 `page.mouse` 로 드래그 → 두 값 이동, 표 갱신
- [ ] 핸들 가장자리 계단 없음(Dev 자체 확인 DPR 1/2)

## 5. 태스크
1. [FE] PR-A 차트 렌더링(§2) — 작음
2. [FE] PR-B 슬라이더 가운데 드래그 + 핸들 그라데이션(§3) — 중간
의존: 둘 다 CSV 선이관 완료 후 착수. 1·2 독립(순서 무관).

## 6. 비범위
- 차트 라이브러리 전환, 곡선 보간, 키보드 구간 이동 단축키, 단일 핸들 슬라이더.

## 7. 진행 기록
- 2026-10-28 PR-A #88(04a454d) 머지(CI 40622003574, QA 생략). Dev 해석 수용: 점선 끝 butt(round 면 대시 틈이 메워짐), 앱에 다크 테마 없음 → 라이트만 확인, YearlyLineChart 는 현재 미마운트라 단위 테스트로만 확인, 너비 280 미만 최소 viewBox 280 유지.
