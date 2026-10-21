# 가격정책 관리 — 원가 매핑(원자재 코드) 열 + 매핑 수정 모달

- 요구사항: Main msg_1fecd0b502d6 (2026-10-21). 확정(사용자): 위치 /admin/policies, 열 내용 = 매핑된 원자재 코드, 편집 = 관리자 모달. 정상 QA.
- 검토: UI/UX·기능/기술 서브에이전트(main b720e66, 공유 개발 DB SELECT — 금액 미조회). 세부는 요구사항상 Plan 설계 범위라 Main 되묻기 없음.
- 기반: `cost-ratio-price-change.md` §2.1–§2.3·§6·§7, `price-change-history-modal.md`(셀 버튼 패턴·Modal size), `pricing-view-hide-price-change.md`(선행 PR).

## 1. 사실
- `pricing.write`·`cost.read`·`cost.write` 모두 현재 ADMIN 전용 — 조합은 다층 방어 의미.
- 원가 격리(ESLint): `server/cost/**`·`features/costs/**`·`app/(app)/admin/costs/**` 밖에서 `cost_item_links`·`server/cost` import 금지. 원가 비중은 `features/costs` 래퍼 → pricing 쪽 자체 뷰 타입(`CostRatioView`)으로 전달.
- 자재번호·자재명은 cost.read 화면에만 노출(챗봇 가드도 `material_code` 차단) → **cost.read 로 묶는다.** 금액은 어디에도 없음.
- #53 서버 함수 재사용 가능: `listCostLinkView`(read), `confirmCostLinks`(write — 품목 존재·후보 범위·원가표 검사·감사 `cost_link.upsert`), `deleteCostLink`(감사 `cost_link.delete`). 액션 `link-actions.ts` 의 `revalidatePath` 는 `/admin/costs/links` 만. 피커 `MaterialPickerModal` 은 비공개 내부 컴포넌트.
- 데이터: 가격 행 5,885 중 후보 밖 품목 행 3,771(64%). 후보 품목당 가격 행 중앙값 7·최대 19(정상판매 중앙값 2·최대 4). 자재 157개. 링크 305(고아·범위 밖 0).
- 마이그레이션 불필요.

## 2. 결정 (Dev는 이 결정을 따른다)

### 2.1 열
1. 키 `costLink`, 헤더 **"원가 매핑"**, `cost: true`. 기본 위치 **'원가 비중' 바로 왼쪽**(원인 → 결과 읽기 순서; 사용자는 #32 로 재배치 가능). 최소 폭 약 120px.
2. 노출 = 관리 모드 + `pricing.write` + `cost.read`(원가 비중과 같은 서버 판정). 없으면 열 정의·prop·RSC 키 0. /pricing 없음. 행 상세 드로어에 넣지 않음.
3. 정렬·열 필터 **없음**(공용 가격 쿼리에 `cost_item_links` 조인 금지 — 격리). `sort=costLink`·`f.costLink.*` 무시.
4. 셀 상태:
   | 상태 | 표시 | 편집(cost.write) |
   |---|---|---|
   | 매핑됨 | `W코드` + 자재명(작은 글자, 말줄임, title 전체명) | 모달 |
   | 매핑됐으나 원가표에 자재 없음 | `W코드 (원가표에 없음)` 경고색 | 모달 |
   | 후보 범위 안·미매핑 | "미매핑"(보조색) | 모달 |
   | 후보 범위 밖·링크 없음 | "—" + title "원가 매핑 대상 아님" | 없음(텍스트) |
   | 후보 범위 밖·링크 있음 | `W코드` + 경고 title "후보 밖 — 원가 비중에 쓰이지 않음" | **해제 전용** 모달 |
5. 같은 품목의 **모든 가격 행**에 같은 값·같은 셀 버튼(어느 행에서 열든 같은 품목 매핑을 수정).
6. 셀 버튼은 #59 `PriceChangeButton` 패턴: `<button aria-haspopup="dialog">`, `stopPropagation`(드로어 비열림), 드래그 직후 클릭 무시(기존 DataTable 처리), 열기 전 focus. `aria-label="{품명} 원가 매핑 수정"`. `cost.write` 없으면 텍스트만.

### 2.2 데이터
1. `server/cost/item-links.ts` 에 `getItemLinkCells(access, db, itemCodes)` — 현재 페이지 품목코드만(최대 200), `{itemCode → {inScope, link: {materialCode, materialName|null, inCostTable} | null}}`. 금액 없음.
2. `features/costs` 래퍼를 `loadPolicyCostColumns` 로 확장해 원가 비중과 매핑 셀을 **한 번의** `optionalCostReadAccess` 로 함께 로드. 실패 시 `failed` → 두 열 모두 '—' + 기존 관리자 안내(화면은 살림).
3. pricing 쪽 자체 뷰 타입 `CostLinkCellView`(`features/pricing/types.ts`) — `server/cost` 타입 import 금지.

### 2.3 모달
1. 공용 Modal(`size="md"`). 제목 "원가 매핑".
2. 열 때 새 읽기 액션 `loadCostLinkPickerAction({ itemCode })`(`cost.read`, `requireCostAccess('read')`): 품목 요약(품명·품번·제품군·소분류·상태), 현재 매핑, 제안 + 사유(#53 휴리스틱, 제안 없으면 `noSuggestion` 사유 — S/W 업그레이드 등), 자재 목록(코드·자재명, 금액 없음), 영향 건수(가격 행 N·정상판매 M). 로딩·오류(+다시 시도) 상태는 #59 패턴.
3. 피커: `MaterialPickerModal` 을 `features/costs/CostLinkPicker`(공용)로 추출해 #53 매핑 화면과 함께 사용(#53 회귀 없음). 검색 + 목록, 초기 선택 = 현재 매핑 → 없으면 제안.
4. 영향 안내: "이 품목의 가격 행 N건에 같은 매핑이 적용되고, 원가 비중은 정상판매 M건에 반영됩니다(해당 시기 원가가 없으면 '—')."
5. 버튼: 취소 / **매핑 해제**(링크 있을 때만, 2단계 확인, danger) / **확정**(선택 없음·현재와 같음이면 비활성). 후보 밖·링크 있음이면 해제만.
6. 저장·해제는 기존 `confirmCostLinksAction`·`deleteCostLinkAction` 그대로(후보 범위·원가표 검사·감사). 두 액션에 `revalidatePath('/admin/policies')` 추가. 서버 오류는 모달 안 `role="alert"`.
7. 저장 중 버튼 대기(중복 제출 방지), 성공 시 모달 닫기 → `router.refresh()`(원가 비중·매핑 열 서버 재계산, URL 필터·페이지 유지) → 표 위 `aria-live` "P… 원가 매핑 변경 — 가격 행 N건" → 포커스 트리거 셀로. 낙관적 UI 없음.
8. 모달 하단 링크 "매핑 화면에서 보기"(`/admin/costs/links`).
9. 동시 편집: 마지막 저장 우선(#53 과 같음, 감사로 추적).

## 3. 비범위
- 매핑 열 정렬·필터, 표에 제안 직접 표시, 드로어 표시, 일괄 편집, 동시 편집 충돌 감지.

## 4. 수용 기준
- [ ] `pricing.write`+`cost.read` 사용자만 "원가 매핑" 헤더(관리 화면). 하나라도 없거나 /pricing 이면 헤더·RSC 키 0, 원가 금액 0(USER·권한 조작 단위).
- [ ] 기본 위치 '원가 비중' 왼쪽, 기존 저장 레이아웃에 자동 삽입. 정렬 아이콘·열 필터 없음, `sort=costLink`·`f.costLink.*` 무시.
- [ ] 셀 5상태 표시(§2.1-4). 같은 품목의 모든 가격 행 동일.
- [ ] 셀 클릭·Enter → 모달만(드로어 비열림), 닫으면 포커스 셀 복귀. `cost.write` 없으면 버튼 없음. 후보 밖·링크 없음은 버튼 없음.
- [ ] 모달: 품목 요약·현재 매핑·제안(또는 사유)·검색 목록·영향 건수 안내, 금액 필드 0(액션 응답 단위).
- [ ] 확정·변경·해제 각각 감사 1건, 모달 닫힘 후 같은 화면 원가 비중·매핑 열 갱신(정상판매 행 % ↔ '—'), aria-live 안내(E2E).
- [ ] 후보 밖 품목 확정·원가표에 없는 코드 확정 → 모달 안 오류, 저장 안 됨.
- [ ] `/admin/costs/links` 동작 무변화(피커 추출 회귀 없음), `/admin/costs/links` 와 `/admin/policies` 양쪽 revalidate.
- [ ] ESLint 원가 격리 규칙·격리 테스트 통과(`features/pricing` 에서 `server/cost` import 0).
- [ ] Dev 게이트 기록(`docs/pipeline/verification.md` §3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3)

## 5. 태스크 (PR 1개)
1. [BE] `getItemLinkCells`, `loadCostLinkPickerAction`(영향 건수 포함), 두 액션 revalidate 추가.
2. [BE] `features/costs` 래퍼 `loadPolicyCostColumns`, `PricingSection` 품목코드 전달, `CostLinkCellView`.
3. [FE] `CostLinkPicker` 추출(#53 회귀 없이), `costLink` 열·셀 버튼, 모달(해제 확인·영향 안내·링크), refresh·aria-live.
4. [TEST] 단위(PGlite: 권한별 키 0·금액 0·VALIDATION·감사), ESLint 격리, E2E(매칭→비중, 변경, 해제→'—', USER·/pricing 열 없음, 무시 URL).
의존: 2 → 1, 3 → 2, 4 → 3. **선행: `/pricing` 가격 변동 비노출 PR 머지**(같은 파일 수정). 마이그레이션 없음.
