# 가격 변동 이력 모달 — 가격 변동 셀 클릭

- 요구사항: Main msg_7c98cc48f9e7 (2026-10-20). 확정(사용자): 진입 = 가격 변동 셀 클릭 → 모달, 내용 = 가격 변동 관련 테이블.
- 검토: UI/UX·기능/기술 서브에이전트(main 5b3fd6d, 공유 개발 DB SELECT/EXPLAIN 실측). 기반: `cost-ratio-price-change.md` §2.4.

## 1. 사실
- 같은 계열 이력 조회는 이미 있다: `getPriceRowDetail`(`server/pricing/queries.ts:280-311`) — `series_key`(STORED 생성 컬럼) 기준, 삭제 제외, `effective_from desc`. 드로어 "계열 이력"(`RowDetailDrawer.tsx:126-146`)이 쓰지만 직전가·변동률은 없음.
- 실데이터 계열 3,810개: 1행 2,233 / 2행 1,282 / 3행 136 / 4행 135 / 5행 4 / 6행 20 — **최대 6행**.
- 성능: 한 계열 조회(인덱스 `(series_key, effective_from)` + 그 계열 안 lag) **0.24ms**. #55 의 전체 윈도(페이지 로드당 약 47ms 추가)와 무관 → 모달은 기존 비용을 키우지 않는다.
- 변경 출처로 쓸 수 있는 정보: `source`(erp/manual), `import_batch_id` → `import_batches.file_name`. ERP 적용은 전체 삭제 후 재삽입이라 행 단위 변경자·시각은 없음. 수동 행 `created_by` 는 사용자 이메일(개인정보).
- 행 클릭은 RowDetailDrawer 를 연다(`DataTable.tsx:651`). 행 클릭 비전파는 `type:'none'` 열만(`:657-660`). 가격 변동 열은 `number`(정렬·필터 대상).
- 공용 Modal 폭은 `min(520px, 100vw-32px)` 고정(`modal.tsx:198`).

## 2. 결정 (Plan 기술 결정 — Dev는 이 결정을 따른다)

### 2.1 조회
1. `getPriceHistory(db, priceRowId)` (`server/pricing/queries.ts`): 입력은 **가격 행 id(양의 정수)만** — series_key 를 클라이언트에서 받지 않는다.
   ① id 로 `series_key` 조회(삭제 행·없는 id → NOT_FOUND) ② `where series_key=$1 and deleted_at is null` 에서 `lag(unit_price) over (order by effective_from)` + **#55 와 같은 변동률식**.
2. #55 의 변동률식(`PRICE_CHANGE_RATE`)·삭제 제외 조건을 **공용 상수로 추출**해 표 쿼리와 모달 쿼리가 함께 쓴다. 클라이언트 재계산 금지(반올림 차이).
3. 반환: 계열 헤더(품명·품번·단가유형·단가구분·화폐·거래처 코드/명) + 행 배열(id, effectiveFrom, effectiveTo, unitPrice, previousPrice, 변동액(numeric 문자열), changeRate, operationStatus, source, batchFileName, ADMIN 일 때만 erpRemark). 정렬 `effective_from desc`.
4. 액션 `getPriceHistoryAction(id)` — `runAction` + `pricing.read`(USER·ADMIN). 원가 관련 키 0, 원가 모듈 import 0. 응답의 `erpRemark` 는 서버에서 역할로 분기(USER 응답에 키 없음, #55 와 같은 규칙).
5. **마이그레이션 없음.** #55 전체 윈도 성능 개선(`previous_unit_price` 파생 컬럼 등)은 이번 범위 아님 — 백로그 유지.

### 2.2 트리거
1. 조회(`/pricing`)·관리(`/admin/policies`) 표 **모두**.
2. 가격 변동 셀 내용을 `<button type="button" aria-haspopup="dialog">` 로 감싼다. 표시·색은 #55 그대로, 밑줄·hover 배경만. 열 폭·정렬 영향 없음.
   - `aria-label="{품명} {단가유형} 가격 변동 이력"`, 보이는 변동 텍스트는 `aria-describedby` 로 보존.
   - 클릭 이벤트 **`stopPropagation`** — 드로어가 함께 열리면 안 된다. 열 타입은 `number` 유지(`none` 으로 바꾸지 않음).
   - 열 리사이즈·재배치 드래그 끝의 click 이 버튼을 누르지 않게 DataTable 의 드래그 중 클릭 억제를 확인(없으면 추가).
3. **'—' 셀(첫 시기·이전가 0)도 버튼**(모든 셀 같은 동작 — 이후 시기가 있으면 거기서도 이력 확인 가능).

### 2.3 모달
1. 공용 Modal 재사용. Modal 에 **`size` prop 추가**(`'md'` = 기존 520px 기본값, `'lg'` = `min(760px, 100vw-32px)`). 기존 모달 무변화.
2. 제목 "가격 변동 이력". 본문 상단 `<dl>` 요약: 품명·품번·단가유형·단가구분·화폐·거래처(`'0'` → "전체 고객").
3. 표: 공용 `Table` 프리미티브(최대 6행 — DataTable 의 정렬·열 재배치·레이아웃 저장은 쓰지 않음, 시각 토큰은 data-table 과 동일). **고정 정렬: 적용시작일 최신 순.**
   열: 적용기간 · 판매가 · 직전 대비 금액(부호+통화, 첫 행 '—') · 변동률(#55 `PriceChange` 표시 재사용) · 운영상태 · 출처("ERP 임포트 (파일명)" / "수동 등록") · (ADMIN) ERP 비고.
4. 클릭한 행: `aria-current="true"` + 기존 강조 배경(`RowDetailDrawer` 패턴).
5. 상태: 로딩("불러오는 중…"), 오류(`role="alert"` + [다시 시도]), 1행 계열(표 아래 "이 계열의 첫 가격입니다. 이전 변동 이력이 없습니다."), NOT_FOUND("삭제되었거나 찾을 수 없는 가격입니다."). 열릴 때 1회 요청, 겹치면 이전 요청 무시.
6. 닫기: Esc·닫기 버튼·백드롭(누름·놓음 모두 백드롭) — 공용 Modal 규칙. 닫힌 뒤 포커스는 클릭한 셀 버튼.
7. 모바일: 표는 `overflow-x-auto`, 페이지 가로 스크롤 없음.
8. 비포함: 원가 비중(관리+cost.read 여도 — #55 §2.3-4 드로어 제외와 같은 이유), 변경자(개인정보·ERP 데이터 없음), 차트·스파크라인, 모달 안 행 → 드로어 이동.

### 2.4 드로어 "계열 이력"과의 관계 — **Main 되묻기(Q-H1)**
- 답 전 기본: 드로어 목록 유지(A). 답이 B 면 드로어 목록 끝에 "변동 이력 보기" 버튼을 추가해 같은 모달을 연다(드로어는 닫지 않고 모달이 위에 — 닫으면 포커스는 그 버튼으로).

## 3. 수용 기준
- [ ] 조회·관리 표의 가격 변동 셀 클릭 또는 포커스 후 Enter/Space → 모달 열림, 드로어는 열리지 않음. 같은 행의 다른 칸 클릭은 기존처럼 드로어(E2E).
- [ ] 트리거는 `button`, `aria-haspopup="dialog"`, 라벨 "{품명} {단가유형} 가격 변동 이력". '—' 셀도 동작.
- [ ] 열 리사이즈·재배치 드래그가 셀 위에서 끝나도 모달이 열리지 않음.
- [ ] 모달 헤더 요약 6항목('0' → 전체 고객), 표는 같은 계열의 삭제되지 않은 행 전부 최신 순.
- [ ] 각 행 변동률이 표 셀(#55) 값·표기와 일치(PGlite 단위: 같은 데이터로 `getPriceRows` 와 `getPriceHistory` 비교), 직전 대비 금액 부호·통화, 가장 오래된 행 '—'.
- [ ] 클릭한 행 `aria-current="true"` + 강조.
- [ ] 출처 열 "ERP 임포트 (파일명)" / "수동 등록". 변경자 미표시.
- [ ] USER 응답에 `erpRemark`·`costRatio`·원가 키 0. 존재하지 않거나 삭제된 id → NOT_FOUND. 권한 없음 → 거부. series_key 입력 경로 없음.
- [ ] 로딩·오류(+다시 시도)·1행 안내·NOT_FOUND 상태.
- [ ] 닫기 3경로 + 포커스 복귀. 375px 폭에서 페이지 가로 스크롤 없음.
- [ ] Modal 기본 폭 520px 유지(기존 모달 회귀 없음), `size="lg"` 760px.
- [ ] 가격 목록 쿼리 결과·성능 무변화(공용 상수 추출 후 #55 회귀 테스트 통과), 마이그레이션 없음.
- [ ] 챗봇 회귀 1건(가격 변동 이력·원가 미노출).
- [ ] Dev 게이트 기록(`docs/pipeline/verification.md` §3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3)

## 4. 태스크 (PR 1개)
1. [BE] 변동률식·삭제 제외 공용 상수 추출, `getPriceHistory`·액션, PGlite 단위.
2. [FE] Modal `size` prop, 셀 버튼(stopPropagation·드래그 억제 확인), 이력 모달·상태, (Q-H1=B 면) 드로어 버튼.
3. [TEST] E2E(조회·관리 각각, 드로어 비열림, 닫기·포커스), 챗봇 회귀.
의존: 2·3 → 1. 순서: 열 필터 A-2 재검증 → T2(마이그레이션 재발 방지) → **본 PR**.

## 5. Main 되묻기
- **Q-H1** 드로어의 기존 "계열 이력" 목록과 모달의 관계 (두 검토 의견 상충)
  - A: 드로어 목록 그대로 두고 모달 추가(범위 최소, 같은 이력이 두 곳에 — 드로어는 직전가·변동률 없음)
  - B: 드로어 목록에 "변동 이력 보기" 버튼을 달아 같은 모달로 연결(진입점 일원화, 작업 약간 추가)
  - Plan 의견: B
