# QA 기록 — PR #59 가격 변동 이력 모달

- 판정: **통과 / 셀프머지 승인** (2026-10-20)
- 요청: Dev msg_d75cb3b1371a
- 스펙: origin/Plan docs/specs/price-change-history-modal.md (Q-H1 B, §6 Plan A)
- 증거(로컬 scratchpad): fe59shots/, scripts/fe59*.mjs, be59logs/{summary.txt,e2e.log,e2e-ph-r3.log,ident-*.json,hist-*.json,live.json,perf.txt,mut/}, scripts59/

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #59 — 가격 변동 이력 모달

검증 SHA: eabc866 (eabc8667ffc2c8dd5e5ba0ea9b8fcb5744f69d20, base main 53433c9)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · ci:run 녹색
  ※ src/components/ui 변경이라 QA가 전부 다시 돌렸습니다.
(참고: #58 머지 53433c9 = 검증 5c63b0b diff 동일 — QA 확인)

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, next dev :3200 / main :3250, 애니메이션 켬, 실데이터 prami 읽기 전용 사본):
  - 여는 경로:
    · 가격 변동 셀 클릭 604/604 → 모달만 열림(드로어 0). Enter·Space로도 열림
    · Esc·닫기·백드롭 → 셀 버튼으로 포커스 복귀
    · 드로어 '변동 이력 보기' → 드로어 위 모달(같은 행 id 강조)
    · Esc·닫기·백드롭 모두 모달만 닫고 드로어 유지, 포커스는 버튼으로
    · aria-haspopup=dialog, 라벨 '{품명} {단가유형} 가격 변동 이력', aria-describedby = 보이는 변동 텍스트
  - 내용: 19품목·302행 × ADMIN(/admin/policies)·USER(/pricing), 118 계열에서 불일치 0
    · 계열 길이 1~6, 고객별·JPY/USD·단가 유형 null·0원 포함
    · 대조: 요약 6항목, 행 집합·최신순, 가격, 변동액(부호 + 통화, 첫 행 '—'), 변동률(SQL lag = 표 셀 텍스트), 상태·출처·비고, aria-current 1행
    · 페이지·필터에 걸친 계열 85개(56개가 걸침) 불일치 0
    · soft delete 행 제외 + 재계산(표 셀과 모달 일치), 수동 행 '수동 등록'
  - 비고·노출:
    · ADMIN 'ERP 비고(품목)'는 요약에 1회이고 마스터와 일치. 표 비고 열은 행별 remark(양 역할)
    · USER 서버 액션 응답 604건: erpRemark 0, 마스터 비고 235종 0(ADMIN 응답에서는 43건 검출 → 스캐너 유효)
    · 원가·작성자 키 0(양 역할)
  - 크기: lg 760(1440·1024), md 모달(공지 삭제·가격정책 삭제) 520 = main. 375/320 가로 스크롤 0, 표는 모달 안에서 가로 스크롤
  - 드래그 억제: 놓는 지점에 click이 가는 경우를 재현하면 main은 드로어가 6/6 열리고 PR은 0. 100ms 뒤 일반 클릭·헤더 정렬 정상
  - 애니메이션: lg 열림 약 230ms, md 약 240~250ms(main 동일), 닫힘 160~190ms. reduced-motion은 opacity만
  - #47 백드롭 규칙 유지(안→밖·밖→안 드래그 비닫힘)
  - 접근성: axe 페이지 0. 모달 대비 4.9~16.1, ▲ 6.25 / ▼ 5.23. 콘솔·하이드레이션 0
  - 회귀: 표 픽셀 차이는 가격 변동 열 점선 밑줄뿐. 정렬·페이지·행 클릭 드로어 무변화
  - 로딩·오류(다시 시도)·단일 행 안내·NOT_FOUND 문구 확인. 증거: fe59shots/
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2684 passed (lines 96.43)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - 빌드 CSS: md min(520px,100vw-32px) / lg min(760px,100vw-32px)
  - E2E 전체 1회: SHA eabc866, 새 DB qa59be_e2e, 112/112 passed, 0 flaky, 7.9분
  - price-history.spec --repeat-each=3: 30/30
  - SQL 추출 동일성: 33개 URL 상태(priceChange 정렬·#57 필터 포함) × 66쿼리
    · main과 SQL 텍스트·params·총수·행 id/순서·직전가/변동률 바이트 동일(덤프 md5 같음)
  - 이력 액션:
    · 실데이터 5,885 id·3,810 계열·11,565행: 독립 SQL(자연 5열 그룹, 상관 서브쿼리 직전가)·표 값과 불일치 0
    · soft delete 541행 사본에서 9,312행 불일치 0
    · 응답 키 화이트리스트: USER erpRemark 키 없음, ADMIN 요약 1회, 원가·비율·created_by 없음
  - 라이브 Next-Action 재전송:
    · USER·ADMIN 200
    · 삭제·없는 id → NOT_FOUND
    · 0·음수·소수·문자·1e20·2^53+1·null·객체·[]·SQL 문자열 → VALIDATION, 500 0
    · 미인증 307 /login
  - 성능: 실데이터 이력 0.2~0.7ms, 앱 중앙값 2.2ms / p95 6.0ms. 5만 행 합성 5,000행 계열 43~59ms
  - DataTable onClickCapture: 드래그가 끝날 때만 플래그를 세우고 setTimeout(0)으로 해제. 다른 DataTable 사용처 테스트 32파일·329건 통과
  - 기존 테스트 파일 수정 0
  - 변이 17/17 검출:
    · erpRemark 누출·키 상시 노출
    · 계열 키 누락, 삭제 포함·lag 삭제 포함·삭제 id 조회
    · 반올림·절사·부호·정렬
    · 드래그 억제 제거·미해제·상시 삼킴
    · Modal 기본 lg·lg 520
    · 권한·입력 검증 제거

## 수용 기준 대조
- [x] 가격 변동 셀 클릭 → 이력 모달, 드로어 비열림 — 604/604
- [x] 드로어 '변동 이력 보기'(Q-H1 B) → 드로어 위 모달, Esc는 모달만·포커스 버튼 — 라이브
- [x] 같은 계열 이력(직전 대비·변동률·출처), 표 변동률 = 모달 변동률 — 실데이터 전 계열 SQL·표 대조 0 불일치
- [x] §6 Plan A: 마스터 비고는 요약에 ADMIN만 1회, 표 비고는 행별 remark 모든 역할, USER 응답 erpRemark 없음 — 604건 스캔·키 검사
- [x] 375px 가로 스크롤 없음, Modal lg 760·md 520 무변화 — 실측
- [x] 열 리사이즈·재배치 드래그가 셀 위에서 끝나도 모달·드로어 안 열림 — 라이브(main 대조)·변이
- [x] 공용 가격 변동 SQL 추출 = 기존 생성 SQL 동일 — 66쿼리 바이트 동일
- [x] Dev 게이트 기록 + QA E2E 전체 1회(112/112) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. 모달 안 상태 Pill 대비 미달(운영중 #3075FF 4.11:1, 미사용 #797C85 4.17:1, 12px). axe가 모달에서 잡습니다. 기존 공용 Pill 색을 그대로 쓴 것으로, #57의 red-600처럼 보정을 권합니다.
2. dev에서 lg 모달 첫 프레임이 클릭 후 약 250ms입니다(md 약 90ms). 모달 열림 상태가 가격 페이지 컴포넌트에 있어 50행 표 전체가 다시 렌더링됩니다. 닫힘 1회 438ms 표본도 있습니다. 프로덕션 빌드 확인과 상태 위치 조정을 권합니다.
3. 입력 coercion이 느슨합니다: ["25264"]·[[25264]]도 id로 받습니다(기존 getPriceRowDetailAction과 같은 패턴, 무해).
4. 이력 행 상한이 없습니다(실데이터 최대 6행. 5,000행 계열이면 전부 반환).
5. main과 같은 것들:
   - dialog Tab 순환에서 16번 중 1번 BODY
   - 좁은 화면 모달이 브라우저 기본 max-width로 6px 좁음
   - 드로어를 닫으면 포커스가 BODY

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
