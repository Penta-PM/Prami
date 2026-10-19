# QA 기록 — PR #55 원가 비중·가격 변동 PR-2

- 판정: **통과 / 셀프머지 승인** (2026-10-19)
- 요청: Dev msg_7332a76a87dd
- 스펙: origin/Plan docs/specs/cost-ratio-price-change.md §2.2–2.4·§4·§5 태스크 3–6, Plan Q1·Q2 A
- 증거(로컬 scratchpad): fe55shots/, scripts/fe55*, be55logs/summary.txt

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #55 — 원가 비중·가격 변동 PR-2 (관리 표 원가 비중 열·가격 변동 열·매핑 후보 범위 검사)

검증 SHA: 961b2e4 (961b2e46bf9db064a3237d91aaa5ce68b3192278, base main dbaed4a)
  ※ Dev 게이트 b78b69c는 961b2e4와 E2E 로케이터 1곳이 달라, QA가 961b2e4로 전부 다시 돌렸습니다.
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ rebase하면 규칙 §3.3대로 다음을 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · ci:run 녹색
(참고: #53 머지 dbaed4a = 검증 a5c007d 코드 diff 동일, 문서 0000~0009 3줄만 추가 / #54 머지 be8b30c = 검증 276d4b6 diff 동일 — QA 확인)

## 검증한 내용 (실제 실행 기준)
Frontend/라이브 (실제 Chromium, next dev :3200 / main :3250):
  - DB: 실데이터 prami를 pg_dump로 읽기 전용 복사(qa55fe·qa55main), head까지 마이그레이션
    · UI로 매핑 305건 확정
    · 같은 날짜 원가 2행 매핑 1건, JPY 판매가 2행(화폐 불일치 / 이후 원가만)
  - 원가 비중(ADMIN):
    · 열 순서 판매가 → 원가 비중 → 적용시작일
    · 관리 표 5,887행 118쪽 전체를 독립 SQL과 대조해 불일치 0
      - 값 341, '—' 5,485
      - 사유: 해당 시기 원가 없음 59 / 판매가 0 1 / 화폐 불일치 1
      - 같은 날짜 중복(source_row 387 사용)과 반올림 경계 8건 포함
    · 툴팁 '원가 적용일 YYYY-MM-DD' + 스크린리더 텍스트, 값 대비 4.93:1
    · 헤더 정렬 불가(aria-sort·아이콘 없음). sort=costRatio는 5,887행 전부 기본 순서와 동일
  - 금액 노출 0: 판매가와 겹치지 않는 원가 금액 288종을 모든 페이지 HTML에서 검색해 0(같은 스캐너가 /admin/costs에서는 35/288 검출)
  - 권한:
    · USER: /admin/policies 307 /, /pricing 118쪽 HTML+RSC에서 costRatio·'원가 비중'·'원가 적용일'·'화폐 불일치' 0
    · ADMIN /pricing(조회 모드)도 0
  - 가격 변동: series(품목·가격 유형·분류·화폐·고객) lag SQL과 전 행 대조 불일치 0
    · 범위: 관리·조회 전체 각 5,887, from=2026-01-01 1,317(직전 행이 필터 밖인 981행 포함), WAPPLES+from 681, q=1700 364
    · 접근 텍스트 '이전 대비 N.N% 상승/하락'(화살표 aria-hidden), 변동 없음, —
  - priceChange 정렬(양쪽 표·양방향·전 쪽 RSC):
    · 5,887 고유 id, 단조, '—' 3,829행은 양방향 모두 맨 뒤
    · SQL ORDER BY와 일치. 실제 클라이언트 sortRows도 서버 순서를 그대로 유지
    · aria-sort, 새로고침·2쪽 링크에서 sort/dir 유지
  - main 형식 저장 레이아웃: 원가 비중은 판매가 뒤, 가격 변동은 운영 연도 뒤에 삽입. 기존 순서·폭 유지, 열 초기화 동작
  - 매핑 화면:
    · 후보 밖 확정 재전송(다른 제품군·파츠) → VALIDATION, DB·감사 무변화(main은 ok:true)
    · SQL로 넣은 범위 밖 링크가 '후보 밖 링크' 구역에 표시, 해제 + cost_link.delete 감사
    · Wapples-4700 T2 RAID 오제안 해소
    · 모호 사유 '같은 모델 원가가 여럿 — 직접 선택'
    · dry-run 305(main 306)
  - 비고 열 회귀 없음(sort=remark·기본 정렬이 main과 동일)
  - 접근성: axe 0(/admin/policies·/pricing·정렬 상태, 매핑 화면은 안정 후 0 = main)
  - 대비: ▲ 6.25 / ▼ 5.23 / 변동 없음·— 5.20
  - 반응형 320/768/1024/1440: 페이지 넘침 0(표 내부 스크롤). 다크 테마 없음. 증거: fe55shots/
Backend/테스트 (git archive 사본, 새 DB):
  - lint·typecheck·format PASS
  - unit coverage 2504 passed (lines 96.18)
  - build·prerender·trace·secrets PASS
  - integration 31 passed
  - E2E 전체 1회: SHA 961b2e4, 새 DB qa55be_e2e, 93/93 passed, 0 flaky, 9.1분
  - cost-ratio.spec --repeat-each=3: 15/15, 실행 후 테스트 데이터 0
  - getCostRatios: 실데이터 사본 + 엣지 행에서 전 id 420키를 독립 SQL과 대조해 불일치 0
    · 값 355 / 시기 없음 62 / 판매가 0 2 / 화폐 1
    · .x5 반올림(12.25 → 12.3 등)
    · 같은 날짜 중복은 source_row 최대
    · 이후 원가만 있거나 끝난 원가면 대체 없음
    · 정상판매 외·파츠·범위 밖·삭제 행은 키 없음
    · 원가 종료일 경계 정확
    · 반환 필드 costRatio·costFrom·reason뿐, 200 id 상한
  - 라이브 RSC(프로덕션 빌드, 실데이터):
    · USER /pricing·ADMIN 조회 모드: costRatio 0·금액 0
    · ADMIN 관리: costRatios = SQL과 일치, 금액 0
  - 가격 변동: 11개 시나리오에서 previousPrice·priceChangeRate 불일치 0(삭제된 중간 행 건너뜀 확인)
  - 정렬: priceChange 서버 = 클라이언트, NULL 맨 뒤. 잘못된 입력은 기본 정렬
    · 'priceChange;drop table x'·__proto__·costRatio·잘못된 dir
  - 원가 격리:
    · ESLint로 features/pricing에서 4경로 차단
    · chat → features/costs는 cost-isolation.test가 검출
    · price-ratio 2파일 server-only, 새 Server Action 없음
    · 격리 테스트 변경은 추가만 있고 약화 0
    · 클라이언트 번들에는 열 정의 문자열만 있고 값은 0
  - 매핑 범위(실데이터 사본):
    · 파츠·SS-ATH SA·DCC SA·SG-SAP·혼합 배치 → VALIDATION, 저장·감사 0
    · 범위 안은 저장 + 감사
    · dry-run(읽기 전용 DB) 305 = PR 본문
  - 변이 21건 중 16건 검출: scope join·min source_row·절사·half-even·lag 필터 후·삭제 포함·품목만 lag·NULLS FIRST·cost.read 검사 제거·조회 모드 노출·금액 반환·범위 검증 제거 등

## 수용 기준 대조
- [x] 원가 비중: 정상판매·후보 범위 매핑·같은 화폐·시기 원가, 중복 최대, 대체 없음, NN.N% half-up, 사유 3종 — FE 5,887행·BE 420키 SQL 대조 0 불일치
- [x] pricing.write + cost.read일 때만 표시, 없으면 RSC costRatio 키 0 — USER·조회 모드 실측, cost.read 없는 쓰기 역할은 optional-access 단위·변이 g(실제 역할 2개뿐)
- [x] 원가 금액 미노출 — 288·319종 스캔 0, 반환 필드 3개
- [x] 원가 비중 정렬 불가(sort=costRatio 기본 정렬) — 5,887행 동일 순서
- [x] 가격 변동: series lag(삭제 제외, 필터·페이지 전), ▲/▼ N.N%·변동 없음·—, 조회·관리 모두 — 전 행 대조 0
- [x] priceChange 정렬 서버 = 클라이언트, '—' 마지막 — 양쪽 표 양방향 전 쪽
- [x] 매핑: 확정 시 후보 범위 검사, 후보 밖 링크 구역, RAID 세대 일치만 제안, 모호 사유(Plan Q1·Q2 A) — 라이브·실데이터
- [x] Dev 게이트 기록 + QA E2E 전체 1회(93/93) — 머지 head SHA ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹)
1. [성능] 가격 변동 윈도 함수가 요청마다 전체 표를 정렬합니다.
   - 실데이터 5.9k: 1쪽 51ms(main 18), 마지막 쪽 66ms(main 31)
   - 합성 53k: 1쪽 451ms(main 56), 500쪽 699ms(main 220). external merge sort 3.9MB가 디스크로 넘침
   - 데이터가 늘면 인덱스·물질화 검토가 필요합니다.
2. [테스트 공백] 코드는 맞습니다(QA 실 DB 확인).
   - 범위 밖 분류의 본품 링크
   - 후속 없이 끝난 원가
   - 부동소수 오차 입력의 epsilon(예: 23/80 → epsilon 없으면 28.7, 기대 28.8)
   - 200 id 상한
3. 약 100억 원 이상 판매가에서 .x5 경계 1원 아래가 0.1 틀리게 반올림될 수 있습니다(현재 최대 16.5억). SQL numeric으로 반올림하면 사라집니다.
4. 원가 비중 헤더 실제 폭 67px. 스펙은 최소 약 72px이고, minWidth 72는 리사이즈 하한에만 적용됩니다.
5. 툴팁이 title + 스크린리더 텍스트라 셀에 포커스가 가지 않습니다. 보는 키보드 사용자는 원가 적용일·사유를 볼 수 없고, 행 드로어에도 없습니다.
6. 모호 사유 문구가 스펙 §6의 '모호함'이 아니라 '같은 모델 원가가 여럿 — 직접 선택'입니다(dry-run 열 이름만 '모호함').
7. /pricing 클라이언트 청크에 '원가 비중' 열 정의 문자열이 들어 있습니다(값 없음, USER에게 렌더링 안 됨).
8. 매핑 화면에서 dev 하이드레이션 속성 불일치 경고 1회(이후 7회 재현 안 됨). 로드 직후 약 1.2초 리사이즈 핸들 aria-valuenow 없음은 main에도 있습니다.

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
