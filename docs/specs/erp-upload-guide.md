# ERP 업로드 안내 — 공통 설명 + 업로드별 ERP 경로 토글팁

- 요구사항: Main msg_988d0f9679f5 (2026-10-22). 문구는 사용자 원문(띄어쓰기·화살표 표기 정리만 허용). QA 생략 모드.
- 검토: UI/UX·기능/기술 서브에이전트(main 042e029). 기밀 매칭 파일은 열지 않음.

## 1. 사실
- 업로드 칸은 3개, 모두 공용 `ImportFileRow`:
  - 가격정책 관리 `ImportPanel`: ① 판매단가 파일(`kind="sales"`) → 항목 1, ② 품목상태 파일(`kind="items"`, 1~5개 한 칸) → 항목 2
  - 원가 관리 `CostImportPanel`: 원가 파일(`kind="costs"`) → 항목 3 (기존 note "구매단가등록 12컬럼…" 있음)
- 항목 4(품목-원가 매칭)는 업로드 기능 없음. 매핑 화면 `/admin/costs/links`.
- 아이콘 패키지 없음 — 자체 SVG 세트(`features/shell/icons.tsx`). Tooltip 프리미티브 없음, 비모달 `Popover`(열 필터)는 있음.
- 기존 임포트 파이프라인은 파싱 행을 `stg_*` 에 `raw` 로 적재 → 기밀 매칭 파일에는 재사용 불가(항목 4 업로드를 만든다면 별도 설계).

## 2. 결정 (Plan)
1. **공용 토글팁 `InfoHint`**(`components/ui/info-hint.tsx`): ⓘ 아이콘 버튼(자체 SVG 세트에 info 아이콘 추가, 유니코드 ⓘ 금지) + `Popover`.
   - `<button type="button" aria-haspopup="dialog" aria-expanded aria-controls>`, 접근성 이름 "{칸 라벨} ERP 메뉴 경로". 클릭·탭·Enter·Space 로 열기, **hover 로 열지 않음**(터치 이중 토글 방지). Esc·바깥 탭·Tab 이탈로 닫힘, 포커스 복귀(Popover 기존 동작).
   - 시각 아이콘 16px, 터치 영역 24px 이상. 라벨과 `inline-flex` 로 묶어 줄바꿈 순서 유지.
   - 팝오버 내용: **항목명(굵게) + 경로** — 예: "가격정책 관리 품목 업데이트" / "기본정보 > 품목단가 > 판매단가등록"(원문 그대로).
   - 스크린리더: Popover 에 `aria-describedby` 를 넘길 수 있게 선택형 prop 추가(본문 낭독) — 필터 팝오버 회귀 테스트 통과 필수. 업로드 버튼에도 `aria-describedby` 로 sr-only 경로 텍스트 연결(팝오버를 열지 않아도 들림).
   - 앞으로 `title` 툴팁 대신 이 컴포넌트를 표준으로.
2. `ImportFileRow` 에 `erpHint?: { item: string; path: string }` prop 추가 → 세 칸에 적용(신규 업로드·기존 파일 재사용 두 모드 모두 표시). 원가 칸 기존 note 는 유지(용도 다름).
3. **공통 설명 `ErpDataGuide`**: 각 업로드 패널(`ImportPanel`·`CostImportPanel`) 맨 위. 제목 앞 같은 ⓘ 아이콘(장식, aria-hidden). 단계는 `<ol>` 인라인, `->` → `→`(aria-hidden), `[EXCEL로 전송하기]` 는 대괄호 유지 + 굵게. 형태·"/" 처리는 §4 Q-E1·Q-E2.
4. 문구 상수 `lib/constants/erp-guide.ts` 에 모음(원문 그대로).
5. 권한: 업로드 패널이 보이는 곳(이미 `pricing.write`/`cost.write`)에만 — 별도 분기 없음. 조회 화면 노출 없음.
6. 토큰만 사용(`bg-surface-card`·`text-text-tertiary` 등), 라이트·다크 대비 4.5:1+.
7. 항목 4: §4 Q-E3 답 전 기본 **(b)** — `/admin/costs/links` 제목·설명 옆 `InfoHint`("품목 - 원가 매칭 업데이트" / "기본정보 > 품목 > 품목조회(추가정보)"). 그 화면에는 업로드가 없으므로 공통 박스는 넣지 않음.

## 3. 수용 기준
- [ ] 두 업로드 패널 맨 위에 "PRAMI ERP 데이터" 제목·본문이 원문(Q-E2 반영)으로 표시, 대비 4.5:1+.
- [ ] 판매단가·품목상태·원가 칸 라벨 옆 ⓘ → 각각 항목명 + 원문 경로. 두 모드(신규·기존 재사용) 모두 표시.
- [ ] ⓘ: Tab 포커스, Enter·Space 열기, `aria-expanded` 토글, Esc 닫힘·포커스 복귀, 바깥 탭 닫힘, hover 로 열리지 않음. 접근성 이름에 칸 라벨 포함. 팝오버 본문이 스크린리더에 읽힘(describedby).
- [ ] 업로드 버튼 `aria-describedby` 가 해당 경로 텍스트를 가리킴.
- [ ] 375px 폭에서 팝오버가 좌우 16px 안, 가로 스크롤 없음.
- [ ] (Q-E3 = b) `/admin/costs/links` 에 항목 4 ⓘ, 공통 박스 없음.
- [ ] 필터 팝오버·기존 임포트 단위·E2E 무회귀.
- [ ] Dev 게이트(§3.1) + 머지 head SHA `ci:run` 녹색(§3.3) — QA 생략 모드.

## 4. Main 되묻기
- **Q-E1 공통 설명 형태** (두 검토 상충): A 항상 펼친 박스(문장이 짧고 매번 필요한 절차 — UI/UX) / B 접기, 기본 접힘(화면이 덜 붐빔 — 기술) / C 접기, 기본 펼침 + 사용자별 기억. Plan 의견: A.
- **Q-E2 본문 중간 줄 구분**: 원문 "…조회한 후" 다음 줄의 "전체 리스트 드래그 → …"를 두 줄로 표시(줄바꿈은 원문 형태 유지로 봄). Plan 의견: 두 줄.
- **Q-E3 항목 4**: (b) 지금은 매핑 화면에 안내 토글팁만, 업로드는 별도 요구 — Plan 의견 / (a) 매칭 파일 업로드 신설(브라우저에서 파싱해 품목코드·품번 쌍만 서버로, 원본은 서버·DB·로그에 남지 않게, 미리보기 → 확정, 이번 §9 규칙 재사용, 약 8~10파일) — 진행 시 매칭 파일 헤더명(내용 제외) 필요.
- 참고 리스크(백로그 후보): "품목조회(추가정보)" 파일을 실수로 ② 품목상태 칸에 올리면 모르는 헤더는 경고만 나고 통과할 수 있음 — 그 파일이 '사용' 품목만 담고 있으면 나머지 품목이 빠지는 병합 경고로 이어질 위험. 툴팁으로 두 경로를 구분해 안내하고, 필요하면 후속으로 업로드 시 열 구성 검사 강화.

## 5. 태스크 (PR 1개)
1. [FE] info 아이콘·`InfoHint`·Popover describedby prop·`ErpDataGuide`·상수.
2. [FE] `ImportFileRow` `erpHint`, 패널 3칸·패널 상단·(b) 매핑 화면 연결.
3. [TEST] InfoHint 단위(열기·Esc·포커스·aria·describedby), 패널 렌더, 필터 팝오버 회귀, E2E 1건.
