# QA 기록 — PR #50 출력 가드 2차 PR-2 (G1–G7·G10)

- 1차 판정: **보류 / Plan 확인 필요** (2026-10-15) — 새 누설 경계 Q-A(~ 등 \p{P} 밖 기호)·Q-B(USD-500 하이픈 통화 코드)
- 요청: Dev msg_7131a4f00d52
- 스펙: origin/Plan docs/specs/output-guard-coverage-2.md §2 PR-2·§4·§7
- 증거(로컬 scratchpad): fe50shots/, scripts/fe50.mjs, be50logs/{summary.txt,e2e.log,corpus_diff.txt,leak_result.txt,g10probe.txt,benign_result.txt,stream_result.txt,redos.txt,mut-summary.txt}, g50/run.mts(QA 직접 재현)

## Dev에 보낸 보류 통보

```
[판정 보류 / Plan 확인 필요] PR #50 — 출력 가드 2차 PR-2 (G1–G7·G10)

검증 SHA: 5f2102e (5f2102e55b5e77bff730cb5a447758eb8d1c66f5, base main 8e7569f)

요약: §4 수용 기준과 스냅샷 허용 규칙은 모두 충족합니다.
다만 코퍼스 밖에서 'main은 막고 PR은 통과시키는' 새 누설을 찾았습니다.
§7 결정(Q2 B·통화 코드 R 유지)의 범위가 모호해 QA가 해석하지 않고 Plan 결정을 받으려 합니다.
- Plan이 'R이어야 한다'고 하면: CRITICAL 반려입니다. 수정 후 재검증합니다(새 SHA로 단위·chat-guard·E2E 전체 1회).
- Plan이 '수용(백로그)'이라고 하면: 5f2102e 그대로 통과·셀프머지 승인입니다. 재검증은 필요 없습니다.

## Plan에 확인할 질문
아래는 모두 QA가 main 8e7569f와 PR 5f2102e의 guard.ts로 mentionsCostAmount를 직접 다시 돌려 재현했습니다(main R / PR K).

Q-A. G10에서 '원가' 바로 뒤가 \p{P} 밖 기호인 경우 (Q2 B '문장부호'의 범위)
  - 원가는 1,000 원가~        / 원가는 1,000 원가 ~ / 원가는 1,000 원가～
  - 원가는 1,000 원가+  (= < > ^ $ → | 도 같음) / 원가는 1,000 원가 + 배송비 / 원가는 1,000 원가 x 3개
  - 원인: WON_COST_WORD가 '\s*(?:$|\p{P})'만 금액으로 봅니다. 물결표 ~는 유니코드상 Sm(수학 기호)이라 빠집니다.
    · 한글 맞춤법 부록에서는 물결표가 문장부호입니다.
    · 같은 파일의 SCALE_FOLLOW는 [.!?。,)|/~]로 ~를 문장부호처럼 다룹니다.
  - 선택: (가) ~ 등도 Q2 B 문장부호로 보고 금액 유지(R) → 이번 PR에서 수정, CRITICAL
          (나) \p{P}만으로 수용 → 백로그

Q-B. 하이픈으로 붙은 통화 코드 + 숫자 + ' 원가' (G10 제품코드 정의 vs §7 '통화 코드 숫자는 계속 R')
  - 마진 USD-500 원가? / 원가 KRW-1000 원가
  - 문자 그대로는 제품코드(라틴 문자+하이픈에 붙은 숫자)에 해당합니다.
  - 그러나 §7은 '통화 코드가 붙은 숫자(KRW1000 원가? 등)는 계속 R'이라고 정했습니다.
  - 선택: (가) 통화 코드(KRW·USD·JPY·EUR·CNY·GBP)+하이픈은 제품코드에서 제외 → R, CRITICAL
          (나) 제품코드로 수용 → 백로그

Q-C. (참고, 스펙대로라 QA 기본값은 비블로킹) 일반 숫자 + ' 원가' + 한글·조사 → G10에 따라 K입니다. 그런데 문장이 금액처럼 읽힙니다.
  - 원가는 3,000 원가 정도 / 원가: 1000 원가요 / 3,000 원가 됩니다. / 1,000 원가 넘음 / 대략 1,000 원가 정도입니다.
  - §2 G10 문구('숫자 뒤 공백 다음의 원가는 원가 단어')에는 맞습니다.
  - 그러나 R→K 허용 목록은 '제품코드 문장'만 나열합니다.
  - Plan이 별도 지시하지 않으면 백로그로 둡니다.

## 그 밖의 검증 결과 (모두 통과)
Frontend/라이브 (Chromium, next dev fake 미러 키, SSE 원문 캡처, main 8e7569f 대조):
  - §4 R 예문 15개(USER)와 관리자 10행: 전부 역할별 거부 문구
    · 금액이 SSE 원문·token 합·final·말풍선 text/HTML·다음 요청 history에 0회
    · main에서는 15개 중 14개가 누설됩니다.
  - §4 K 예문 14개 + ADMIN 4행: final = token 합 = 말풍선, 원문 그대로
    · main에서는 5개(WAPPLES-500 원가·5 엔진·3 엔드포인트·v2엔·SA-200)가 오거부됩니다.
  - §7 추가: 1,000 원가량 / 3,000 원가까이 / 1,000 원가? / KRW1000 원가? / 수천만입니다 → 거부
    · WAPPLES-500 원가, SA-200 원가는 → 원문
  - 여러 문장 응답(K→R, R→K, K→K): 금액 0회
    · 먼저 나간 깨끗한 문장은 최종 거부 문구로 교체됩니다(기존 설계).
  - 콘솔·하이드레이션 경고 0. 다크 테마 없음(라이트만). 증거: fe50shots/
Backend/테스트 (git archive 사본, 실 Postgres):
  - lint·typecheck·format PASS
  - unit coverage 2241 passed (lines 96.17)
  - build·prerender·trace·secrets PASS
  - integration 30 passed
  - E2E 전체 1회: SHA 5f2102e, 새 DB qa50be_e2e, 73/73 passed, 6.4분
  - 보호 파일 diff 0: COST_WORD·intent COST_RE·프롬프트·거부 문구
    · guard-qa31은 추가만 있습니다. guard-regression은 무변경입니다.
  - 코퍼스 757행을 main/PR guard로 독립 재판정했습니다.
    · PR 본문 표·목록과 행 단위로 일치합니다(K→R 10 = G1–G6 대상, R→K 7 = benign2 새 행).
    · 누설 집합 R→K 0, 정상 집합 K→R 0. 커밋된 스냅샷과 전 행이 같습니다.
  - §4·§7 예문 37개: mentionsCostAmount·guardReplyText(USER/ADMIN) 모두 기대대로입니다.
  - 스트리밍: 775문장 × 감싸기 3종 × 청크 1/2/3/5 = 9,300건
    · 청크 판정이 전체 판정과 100% 일치합니다.
    · R 문장 이후 토큰은 0건 나갔습니다.
  - 변이 실험 27건 중 20건 검출. E2E chat-guard는 G1–G6을 모두 끄면 실패합니다(빈 통과 아님).
  - ReDoS: 지수형은 없습니다. 최악의 2차형은 main에도 있고(10K '1'×n, main 2.7s / PR 3.6s), PR에서 최대 약 3.7배입니다.

## 백로그 (비블로킹, Plan 결정과 무관)
1. [오탐, 우선 권장] '원가 집계는 3일만에 끝났습니다.'가 R입니다.
   - '일만'을 수사 10,000으로 읽습니다. 10일만에·1일만이면·5일만입니다도 같습니다(QA 재현).
   - LLM 답변에 실제로 나올 법한 표현입니다.
2. 그 밖의 새 오탐: '원가 오천 엔티티'(엔티티가 엔 제외 목록 밖), 'one yen coin', '인구 1억이 넘습니다'·'인구는 5천만입니다'(G5/G6 규칙대로), 이천 지명(Plan 수용).
3. 여전히 미탐(main·PR 공통):
   - 3억 이상/이하/미만/초과/남짓/안팎/규모/전후, 3억 넘습니다, '3억 대'(띄어 씀), 3억뿐/밖에
   - 오천 USD·삼억 won(한글 수사+통화 코드), 수천 엔·몇만엔, 5m USD
4. 버전·모델 토큰 제외가 'x'도 라틴 문자로 봅니다. 그래서 '2개 x5000엔'이 K입니다(곱셈 기호 용법).
5. 변이 생존 7건(테스트 공백):
   - WON_COST_WORD 원복(일반 숫자+' 원가'+조사 → K를 고정하는 테스트 없음)
   - SCALE_NUMBER 한글 단어 중간 경계·숫자 lookbehind
   - '대' 단위 제한, 이상/이하/이내 제외, several|few, 영어 수사 'and'
6. 2차형 성능 경로 증가: 10K 입력 기준 'A-1'×n 0.5→116ms, '1천1'×n 1→217ms, 'one-'×n 0.5→82ms.

Plan 결정을 이 메시지에 회신해 주세요. (나)·(나)이면 바로 승인서를 보내겠습니다.
```

## 2차 (재검증 ff29e70) — **반려 / CRITICAL** (2026-10-15)

- 요청: Dev msg_5010cbd6d1b3 (Plan 결정 msg_17214c7ca947 반영)
- 증거: be50blogs/, fe50bshots/, scripts/fe50b.mjs·g50b.mts

```
[반려 / CRITICAL] PR #50 — 출력 가드 2차 PR-2 재검증 (ff29e70)

검증 SHA: ff29e70 (ff29e702c086c624258644d161298eadb65e2cdb, base main 8e7569f)

## CRITICAL (반드시 수정)
1. 통화 코드 예외가 대문자·소문자 그대로의 형태 + 하이픈 1개에만 걸립니다. 다른 표기는 제품코드로 분류돼 main 대비 새 누설이 됩니다.
   (Plan 원칙 3: 'main 대비 새 누설은 코퍼스 밖이어도 백로그 불가', Q-B 결정 위반)
   재현(라이브):
     1) next dev LLM_VENDOR_MODE=fake에서 USER(또는 ADMIN)로 fake-mirror- 키를 저장합니다.
     2) 챗봇에 `원§가 Usd-500 원§가?` 를 보냅니다.
     3) 응답이 '원가 Usd-500 원가?' 원문 그대로 나옵니다. 거부 문구가 아닙니다.
        · 금액이 SSE 원문 2·token 1·final 1·말풍선 1·HTML 1, 이후 history 5회 나옵니다.
   - USD_500 / KRW_1000 / Krw-1000도 같은 결과입니다.
   - 단위 재현: mentionsCostAmount (main 8e7569f / 5f2102e / ff29e70)
       원가 Usd-500 원가?   R / K / K
       원가 Krw-1000 원가   R / K / K
       원가 USD_500 원가?   R / K / K
       원가 USD-500 원가?   R / K / R  (대문자는 수정됨)
   - 체계 탐색: 통화 코드 계열 12,072문장(main 전부 R) 중 4,008문장이 PR에서 K입니다(K→R 0).
     ① 6개 코드의 대소문자 혼합 36종 + '-' 전부 누설
        · 예: Usd·uSD·Krw·eUR·gbP
        · NFKC로 '-'가 되는 전각 '－'·작은 '﹣', 제거되는 ZWSP·soft hyphen이 낀 형태도 누설
        · 예: 마진 Eur-500 원가. / 원가는 Jpy-500 원가 정도 / 원가 Gbp-500 원가? / 원가 Cny－500 원가
     ② 6개 코드(대소문자 무관) + '_'·'--'·'-_'·'_-'
        · 예: 원가 USD_500 원가? / 원가 KRW_500 원가 / 원가 USD--500 원가? / 원가 USD-_500 원가
   - 원인:
     · CURRENCY_CODE_HYPHEN이 대문자열과 소문자열만 나열합니다. 'u' 플래그만 있고 'i'가 없습니다(같은 파일의 AMOUNT_CURRENCY_DIGIT은 /i).
     · 구분자가 '-' 1개뿐입니다.
     · PRODUCT_CODE의 (?<=[A-Za-z][\w-]*)가 '_'와 연속 하이픈을 받습니다.
   기대: §7·Plan 결정 Q-B — 통화 코드에 붙은 숫자는 제품코드가 아니라 금액(R). main 대비 새 누설 0.
   증거: be50blogs/newleak_ii.txt(전 문장), cur_result.txt, fe50bshots/extra-USER-panel-bottom.png, scripts/g50b.mts

## Plan 확인 필요 (위 수정과 함께 결정 받아 주세요)
- Q-D. 6개 코드 밖의 통화 모양 토큰도 현재 제품코드로 K입니다(main R).
  · W1000 / W-1000 (원화 표기 W)
  · WON1000 / won-500 / Won_500
  · CHF·AUD·HKD·SGD 등 ISO 코드 14종 + 숫자
  · dollar-500 / Yen500 / euro_500 / US-500 / KR-500
  · 예: 원가 W1000 원가? / 원가 CHF-500 원가?
  → (가) 금액(R)으로 막기 (나) 제품코드로 수용
- Q-E (참고). 라벨 모양 접두도 제품코드로 K입니다(main R).
  · max-500 원가 / price-500 원가 / unit-500 원가 / about-1000 원가 / avg-1000 / No-500 / FY2024-1000
  · 곱셈 기호 X1000 원가
  · 콤마 숫자(A-1,000 원가)는 일반 갈래로 R입니다.
  → 제품코드 정의(라틴 문자+하이픈에 붙은 숫자) 그대로라 QA는 Plan 지시가 없으면 백로그로 봅니다.

## 확인은 했으나 통과 (이번 수정분)
- Plan 결정 반영:
  · Q-A 기호 7종·Q-C 5형태·USD-500/KRW-1000(대문자)·일만 원·약 일만 원 → R
  · 3일만에·10일만에·1일만이면·5일만입니다 → K
  · 라이브(SSE·token·final·말풍선·HTML·history)와 단위 모두 확인
  · 회귀 표 F214–F235 고정, 이전 56행 라이브 동일
- '\d' lookbehind 변경으로 생긴 새 누설: 7,448 프로브에서 0
- 새 오탐 0. 남은 오탐은 5f2102e 때부터 있던 것(이천·인구 1억이·one yen coin·오천 엔티티 등)
- 코퍼스 757행: 누설 R→K 0, 정상 K→R 0, 스냅샷 = 독립 판정, 5f2102e 대비 변화 0
- §4·§7 예문 51개(USER/ADMIN guardReplyText 포함) 0 오류
- 스트리밍 9,300건 + 신규 프로브 10,764건: 판정 불일치 0, 금액 송출 0
- ReDoS: 지수형 없음, 5f2102e 대비 회귀 없음
- 게이트:
  · lint·typecheck·format PASS
  · unit 2263 passed
  · build·prerender·trace·secrets PASS
  · integration 30
- E2E 전체 1회: 72 passed / 1 failed (6.5분, SHA ff29e70, 새 DB qa50b_e2e)
  · 실패: quote-share.spec.ts:77 (AC-70/72) — signOutLocally 뒤 loginAs의 test-login 폼 대기 초과
  · main 8e7569f 새 DB에서 같은 줄로 재현돼 이 PR 원인이 아닙니다(가드 무관). 그래서 --repeat-each는 생략했습니다.
  · 직전 #50 1차(5f2102e)에서는 녹색이었습니다. 타이밍 의존 flaky로 백로그에 둡니다.
- 백로그(테스트 공백): 소문자 코드(usd-500)와 '라틴 문자 + 코드'(xUSD-500) 행이 회귀 표에 없습니다(변이 생존). 수정할 때 함께 고정하면 좋겠습니다.

재검증 요청 시 이 메시지에 회신해 주세요.
재검증 범위:
- guard.ts 변경분: 단위·코퍼스·신규 누설 프로브(be50blogs 스크립트 재사용)
- 라이브 chat-guard 행
- E2E 전체 1회(새 SHA)
```

## 3차 (재검증 369db68) — **반려 / CRITICAL** (2026-10-15)

- 요청: Dev msg_8ace68276f70 (Plan 결정 msg_335fbc44273e 허용 목록)
- 증거: be50clogs/, fe50cshots/, scripts/fe50c.mjs, g50/run3.mts

```
[반려 / CRITICAL] PR #50 — 출력 가드 2차 PR-2 3차 재검증 (369db68)

검증 SHA: 369db68 (369db68a65a6eab2ef8acecf354581b7ed035ede, base main 8e7569f)

## CRITICAL (반드시 수정)
1. 허용 목록 접두 바로 뒤에 '.' 또는 ','가 오고 숫자가 이어지면 그 뒤 원화 금액이 전부 통과(K)합니다.
   main과 ff29e70은 모두 막던 것을 369db68이 새로 엽니다. '원가'가 아니라 '원'으로 끝나는 명백한 금액도 마찬가지입니다.
   재현 (QA 직접, mentionsCostAmount: main 8e7569f / ff29e70 / 369db68):
     원가는 H.500원입니다.            R / R / K
     원가는 SA,1,000원입니다.         R / R / K
     원가는 WAPPLES.5,000 원입니다.   R / R / K
     원가는 KMS.1,000 원가량입니다.   R / R / K
     원가: h.900원                    R / R / K
     원가는 sa.500원이다              R / R / K
     (대조) 원가는 H500원입니다.      R / R / R
   - guardReplyText(USER)와 글자 단위 createTokenGuard 스트림도 같습니다. main은 송출 0, 369db68은 문장 전체를 송출합니다.
   - 범위:
     · 접두 14종 × 구분자 12종('.' ',' '-.' '_,' ' .' 등) × 템플릿 7종 = 1,176문장 중 924문장이 R→K
     · 단위가 붙은 형태(500만 원)와 '.-' 순서만 R로 남습니다.
     · 허용 목록 대량 프로브(1,209,553문장)에서 규칙 밖 R→K 15,400건이 전부 이 형태('접두 + . 또는 , + 숫자')입니다.
     · 뒤에 무엇이 오든(원·원가량·원가격·?·정도) 같습니다. 량/까/치/격 예외와 '원가 한정'도 우회합니다.
   - 원인(guard.ts AMOUNT_DIGIT_WON):
     · 첫 갈래의 부정 lookbehind (?<!${PRODUCT_PREFIX}[\d,.]*)가 '접두 + [.,]+' 뒤의 숫자를 일반 숫자 갈래에서 빼 버립니다.
     · 그런데 둘째 갈래 (?<=${PRODUCT_PREFIX})\d는 숫자가 접두(+[-_ ]?) 바로 뒤일 때만 맞습니다.
     · 그래서 '접두 + [.,] + 숫자'는 어느 갈래에도 걸리지 않습니다.
   기대: Plan 원칙 — main 대비 새 누설 0(코퍼스 밖 포함). 허용되는 R→K는 '허용 목록 접두 + 숫자 + 공백 + 원가(량·까·치·격 아님)'뿐입니다.
   증거: be50clogs/dot_hole_evidence.txt, al_classify.txt, scripts/g50 run3.mts
   제안:
     · 회귀 표에 '접두 + . / , + 숫자 + 원/원가량/원가?' R 행을 고정해 주세요.
     · 같은 계열 F236–F265처럼 대소문자·구분자 조합도 함께 넣어 주세요.
     · 이번 회차 변이 10건은 모두 검출됐지만, 이 구멍을 덮는 테스트는 없었습니다.

## Plan 참고 (현재 규칙 문구 그대로라 QA 기본값 비블로킹 — Plan이 달리 정하면 따름)
- 'H' + 공백 + 숫자가 K입니다. 예: 'H 1,000 원가', '원가 H H H … H 1 원가'
  · 한 글자 접두 H와 '공백 구분자 0~1개'의 조합입니다.
- 접두 앞이 '-'·'_'·'.'·'/'·ZWSP일 때도 토큰 경계로 봅니다.
  · 예: 'SG--KMS-500 원가', '원가는 USD-SA-200 원가'
- 접두 앞이 비ASCII 라틴(Ü·é)이나 전각 숫자일 때도 경계로 봅니다.
  · 예: 'ÜSA-500 원가', '１SG-KMS 1,000 원가'
  · Plan 문구 '라틴 문자·숫자에 붙으면 매칭 아님'을 ASCII로만 구현했습니다.

## 확인은 했으나 통과 (이번 수정분)
- 지난 회차 누설: Usd-500·Krw-1000·USD_500·KRW_1000·USD--500·USD-_500·Cny－500 등은 단위와 라이브 모두에서 거부됩니다.
  · 라이브: SSE·token·final·말풍선·HTML·history 금액 0
  · 통화 코드 프로브 12,072문장의 규칙 밖 R→K는 0
- Q-D·Q-E: W1000·WON1000·CHF-500·dollar-500·US-500·price/max/FY2024·X1000·USA-500·WH500·xSA-200 → R
- 허용 목록 K: wapples-500·Sa-200·WAPPLES 500·SG-KMS_1700·iSIGN+ 1700·Wapples-CC-2700 → 원문 그대로(라이브 일치)
- 닮은 접두(WAPPLESS-·SAA-·HH500·KMSS-·iSIGNX-·그리스·키릴 동형 문자)는 R입니다.
- 회귀 표 F236–F265는 Dev 목록과 일치합니다. ff29e70 대비 추가만 있습니다.
- 코퍼스 757행: 누설 R→K 0, 정상 K→R 0, 스냅샷 = 독립 판정, ff29e70 대비 diff 0
- §4·§7 예문과 F236–F265, 허용 접두 전부: 89/89(USER/ADMIN guardReplyText 포함)
- 라이브 145행(USER 100 / ADMIN 45) 모두 기대대로입니다.
- 새 오탐: 'X1000 원가 정보는 없습니다.' 1건(목록 밖 제품코드 오탐, Plan 수용)
- 스트리밍 7,452문장 × 감싸기 3 × 청크 4종: 불일치 0, 금액 송출 0
- ReDoS: 허용 목록 입력 ≤0.8ms. 기존 2차형('1'*n)은 main과 같은 수준입니다.
- 게이트:
  · lint·typecheck·format PASS
  · unit coverage PASS(guard.ts 98.4%)
  · build·prerender·trace·secrets PASS
  · integration 30
- E2E 전체 1회: SHA 369db68, 새 DB qa50c_e2e, 73/73 passed, 268초(다른 E2E와 순차)
- main 2df55d9과 merge-tree 충돌 없음. guard.ts는 main 2df55d9 = 8e7569f 동일입니다.
- 참고: 확인 시점에 gh pr view 50의 headRefOid가 ff29e70으로 늦게 보였습니다(ls-remote는 369db68). 머지 전에 PR head를 다시 확인해 주세요.

재검증 요청 시 이 메시지에 회신해 주세요.
재검증 범위:
- guard.ts 변경분: 단위·코퍼스·허용 목록 프로브 전체(be50clogs 스크립트 재사용)
- 라이브 행
- E2E 전체 1회(새 SHA)
```
