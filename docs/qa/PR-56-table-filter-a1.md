# QA 기록 — PR #56 표 열 필터 A-1

- 판정: **통과 / 셀프머지 승인** (2026-10-19)
- 요청: Dev msg_e56fa5dc4b7a (Orca 초기화 후 재전송, 이전 head 8bceae2 → rebase 3d72e51)
- 스펙: origin/Plan docs/specs/table-column-filter.md §1·§2·§4·§5 A-1·§6
- 증거(로컬 scratchpad): fe56shots/, scripts/fe56*.mjs, scripts56/, be56logs/{summary.txt,e2e.log,e2e-tf-r3.log,mut-summary.txt}

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #56 — 표 열 필터 A-1 (공용 필터 모델·팝오버·툴바·칩, 클라이언트 4표)

검증 SHA: 3d72e51 (3d72e513764c278ba0bca1713d0943ce61aaf907, base main d8610ae = c5ad687 + 문서 커밋)
  ※ git range-diff 8bceae2 → 3d72e51: '1: 8bceae2 = 1: 3d72e51'(같은 패치, rebase만)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · ci:run 녹색
  ※ src/components/ui 변경이라 QA가 전부 다시 돌렸습니다.

## 검증한 내용 (실제 실행 기준)
Frontend (실제 Chromium, next dev :3200 / main :3250, 애니메이션 켬):
  - DB qa56fe: migrate·seed·임포트 + SQL로 사용자 42, 공지 43, 파츠 매핑 31, 견적 120(KRW 55/USD 45/JPY 15/통화 없음 5)
  - 4표 필터 결과가 SQL 기대 수와 전부 일치합니다.
    · 사용자: 부서·역할·상태·로그인 범위·이름 eq/has(대소문자 무시)
    · 공지: 제목+중요·작성일 범위·작성자 eq+일반, gte·lte 단독
    · 파츠: has
    · 견적: 통화·통화+금액 범위·복수 통화·번호+제품+일자
  - 표시:
    · 칩 × 제거, '전체 N건 중 M건', 헤더 점(aria-hidden)
    · aria-live '필터 적용 · M건'/'필터 해제 · N건'(새로고침 때는 안내 없음)
    · 빈 상태 2종 문구
  - 초기화:
    · '필터 초기화'는 정렬만 바뀌어도 나오고, 필터와 정렬을 모두 해제(Q1 B)
    · '열 초기화'(리사이즈 후)는 필터·정렬 무영향
  - 키보드만: Tab→＋ 필터→Enter→열→편집기→Enter 적용, enum은 Space+Enter, 적용 후 트리거로 포커스 복귀
    · 한글 IME 조합 중 Enter(isComposing·229)는 적용하지 않음
  - 팝오버:
    · role=dialog, aria-modal 없음, 첫 입력에 포커스
    · 폭: 320→288px, 375·1440→320px(16px 여백), 모달 안 320에서 288
    · Esc는 트리거로 포커스 복귀. 바깥 클릭·트리거 토글·Tab/Shift+Tab 이탈 시 닫힘
    · 터치(390, hasTouch)
    · 애니메이션 scale 0.96·opacity 0→1 약 240ms, 닫힘 약 200ms. reduced-motion은 이동 없음
  - 내 견적 목록 모달:
    · 첫 Esc는 팝오버만 닫고 모달 유지, 두 번째 Esc가 모달을 닫음
    · 팝오버 입력에서 백드롭까지 드래그해도 모달 유지(#47)
    · URL 무변화(상태), '최근 100건 안에서 필터합니다', 통화 JPY·KRW·USD
    · 통화 미선택이면 금액 잠김, 2통화면 '(통화 선택 시 적용)'으로 미적용
    · min>max·비숫자 오류, 다시 열면 초기화
  - URL 표:
    · f.password.eq·f.__proto__.*·f.constructor.has·f.x;drop.has·f.name.like·101자·in 21개·목록 밖 enum·2026-02-30·빈 값 → 해당 조건만 버림(200, 콘솔 0). 100자는 허용
    · page 제거, sort/dir 맨 뒤, 그 밖 파라미터 순서 유지, 새로고침 복원
    · 필터 3번 변경 후 history.length 그대로, 뒤로가기는 필터를 건너뜀(Q3 A replace)
    · 파츠 ?family 유지
  - 접근성:
    · 콘솔·하이드레이션 0(PR·main)
    · axe 새 위반 0(공지·파츠·견적 모달 전 상태 0. 사용자 표 1건은 기존 '비활성' Pill)
    · 대비 4.93~5.23(＋ 필터·필터 초기화·칩·칩 ×·건수·점)
  - 반응형 320/768/1024/1440: 페이지 넘침 0, 툴바 줄바꿈
  - main 회귀:
    · 표 영역 픽셀: 공지·파츠·견적 0px, 사용자는 로그인 시각 셀만
    · 정렬·키보드 리사이즈·Alt+Shift+화살표 재정렬·드래그 재정렬 결과 동일
  - 다크 테마 없음(라이트만). 증거: fe56shots/
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2573 passed(lines 96.27, filter.ts 100%, popover 97.8%)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 3d72e51, 새 DB qa56be_e2e, 96/96 passed, 0 flaky, 5.7분
  - table-filter.spec --repeat-each=3: 9/9
  - 퍼징:
    · URL 코덱 5만 세트: 크래시·속성 위반 0
      - 남는 조건은 전부 화이트리스트·허용 op·한도 안, 조건마다 독립 검증
      - encode(decode) 안정, page 제거, sort/dir 마지막, Object.prototype 무변화
    · 술어 3,000 세트 × 2,000행 = 600만 판정: 참조 구현과 불일치 0
      - ASCII 소문자만(İ·전각·Ä 구분)
      - 날짜는 KST
      - 금액 범위는 단일 통화일 때만
  - 성능 1만 행: 조건 1개 5.9ms ~ 10개 10.4ms, 금액+통화+날짜 26ms
  - 서버 무변경:
    · src/server·app diff 0
    · 사용자·공지 페이지는 searchParams를 읽지 않고, 파츠는 family만 화이트리스트로 읽음
    · f.*는 클라이언트에서만 파싱되므로 SQL 도달 0
  - 변이 26건 중 24건 검출:
    · 화이트리스트·op·hasOwn, 한도, 조건 단위 버림, 대소문자·ASCII, replace, page·sort 위치
    · Esc 가드, 혼합 통화 금액, 필터 초기화 정렬 반영, enum 검사, KST, aria-live, 지수 표기, 빈 값
    · 생존 2건은 아래 백로그입니다(그중 하나는 zod와 동치).
  - 공용 UI 회귀:
    · button ref·chipClass 이동은 추가적 변경이고, server 모드 DataTable은 무변화
    · 다른 표 단위 테스트, pricing·costs·cost-links·cost-ratio·import·items-master·calculator E2E 모두 통과
    · 기존 테스트 diff는 next/navigation mock 필드 추가뿐이고, 단언 약화 0

## 수용 기준 대조 (A-1)
- [x] 필터 모델(연산자·AND·한도 '그 조건만 버림'·ASCII 소문자·단일 통화 금액) — 퍼징 600만 판정, 라이브 SQL 대조
- [x] URL f.<col>.<op>(화이트리스트·sort/dir 맨 뒤·page 제거), router.replace — 주입 키 라이브, history 실측, 퍼징
- [x] 팝오버(비모달·첫 입력 포커스·Esc는 팝오버만·바깥/Tab 닫힘·폭 min(320, 100vw-32)·scaleIn) — 실측
- [x] 툴바(＋ 필터 → 열 → 팝오버 → 적용/Enter, 칩 ×, 필터 초기화 Q1 B), 헤더 점·aria-live, 빈 상태 2종, '전체 N건 중 M건' — 4표 라이브
- [x] 4표: 사용자·공지 관리·파츠 매핑(?family 유지) = URL / 내 견적 목록 = 상태(통화 항목, 최근 100건 안내) — 라이브
- [x] 키보드·axe·대비·반응형·하이드레이션 0 — 실측
- [x] Dev 게이트 기록 + QA E2E 전체 1회(96/96) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. 비활성 버튼(예: 사용자 표의 비활성 '열 초기화')을 클릭하면 팝오버가 열린 채 남습니다.
   - click이 없고 focusout의 relatedTarget도 없어, 포커스는 body로 가는데 팝오버는 그대로입니다.
   - 이 상태에서 Esc가 동작하지 않고(리스너가 패널에 있음), Tab도 그대로 진행합니다. 다음 일반 클릭에서 닫힙니다(dbg-adduser-popover.png).
2. 빈 상태 안의 [필터 초기화] 뒤 포커스가 body로 갑니다. 툴바 버튼은 '＋ 필터'로 정상 복귀합니다.
3. 320px에서 빈 상태 문구·버튼이 표 가로 스크롤 안에서 잘립니다(resp-users-320.png). 툴바 쪽 초기화·건수는 보입니다.
4. 견적 모달 안에서 팝오버가 열린 채 백드롭을 클릭하면 팝오버와 모달이 함께 닫힙니다. 스펙은 Esc만 규정합니다.
5. 기존 문제: '비활성' Pill 3.72:1(#eb001b/#fde0e4, 12px). 필터로 비활성 행만 보일 때 axe가 잡습니다. #54에서 '중요' 배지에 한 것처럼 red-600 보정을 권합니다.
6. 필터 값 경계 처리(현실 입력 영향 거의 없음):
   - 공백 처리 불일치: 숫자 ' 7 '은 허용, 날짜 ' 2026-10-19'는 버림
   - 100자 한도를 trim 전에도 검사해, 공백이 붙은 값은 trim 후 ≤100이어도 버려짐(변이 b2 생존)
   - in 20개 한도를 중복 제거 전에 셈
   - 0000~0099년 날짜 거부
7. replace의 history 누적 없음은 단위 mock으로만 고정돼 있습니다(QA 라이브 확인). '등록된 사용자가 없습니다' 빈 상태는 로그인 관리자가 항상 있어 라이브 재현이 불가해 코드로만 확인했습니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
