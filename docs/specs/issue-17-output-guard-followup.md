# 스펙: #17 출력 가드 미탐·오탐 후속 (PRAMI-002)

- 요구사항: Main `msg_6896adc87bb0` · 되묻기 답변: `msg_0afe5fe36223` (Q1 A, Q2 B, 사용자 확인 완료) · 2026-10-06
- 상태: 확정 → Dev 배정. I-2는 Plan 문서 `PRAMI-002-errata.md`로 처리한다.

## 제약
출력 가드는 2차 방어다. 1차 방어(컨텍스트에 원가가 없음, `intent.ts` `COST_RE`, prompt)는 건드리지 않는다.

## L-A 미탐 — 금액 패턴 보강
- `src/server/chat/graph/guard.ts` `AMOUNT`를 세 갈래로 나눈다. `mentionsCostAmount`는 `isAmount`를 쓴다.
  1. **숫자 + (한글 단위) + 통화**: `\d[\d,.]*\s*[십백천만억조]*\s*(원|엔|달러|[$₩€£¥]|(KRW|USD|JPY|EUR|CNY|GBP|dollars?|won|yen|euros?)(?![a-z]))`(i)
  2. **통화 코드·기호 + 숫자**: `(\b(KRW|USD|JPY|EUR|CNY|GBP)|[$₩￦€£¥])\s*\d`(i)
  3. **한글 수사**(L-B 참조)
- 스트리밍(`createTokenGuard`)은 같은 판정 함수를 쓰므로 자동으로 적용된다. 청크 분할 케이스를 고정한다.
- 맨숫자('원가는 1,000입니다')는 범위 밖이다.

## L-B 오탐 — 수사 없는 단위 + 단어 경계 (Main 결정 B: 같은 원인 함께 수정)
- 원인: 한글 수사 갈래의 수사는 선택이고 단위는 한 글자만 있어도 되며, 단위와 '원' 사이에 `\s*`를 허용한다. 그래서 '조원'(구성원), '구조 원칙'('구'+'조'+' 원'), '강조 원칙'이 금액으로 잡힌다.
- 규칙:
  - (a) 마지막 단위가 `조`·`억`이면 앞에 수사나 다른 단위가 있어야 한다. `조원` 단독은 금액이 아니다. `천원`·`만원`·`백원`·`십원`은 단독으로도 금액이다.
  - (b) 단위와 '원' 사이에 **공백이 있으면**, '원' 뒤가 끝·공백·구두점·숫자이거나 조사·서술어 허용 목록(`이`, `은`, `을`, `의`, `에`, `도`, `만`, `과`, `으로`, `이다`, `입니다`, `대`, `정도`, `가량`, `씩`, `짜리`)으로 시작할 때만 금액으로 본다. '원칙', '원리', '원인', '원래', '원본', '원장', '원만'처럼 '원'으로 시작하는 일반 명사는 금액이 아니다.
  - (c) 공백이 없는 형태(`삼천원`, `오천만원`)는 지금처럼 금액이다.
- 구체적인 정규식은 Dev가 설계한다. 아래 회귀 표가 기준이다.

## I-1 COGS — 포함
- 출력 가드의 원가 단어 목록에 **대문자** `\bCOGS\b`를 추가한다. 대소문자를 구분하는 별도 정규식이다. 소문자 `cogs`(톱니)는 오탐 방지를 위해 제외한다.
- `cost of goods sold`는 기존 `\bcost\b`로 이미 잡힌다. intent `COST_RE`는 바꾸지 않는다.

## I-2 R-16 — 정정 문서
`docs/specs/PRAMI-002-errata.md`(Plan 브랜치, Plan이 작성)에 기록한다. 코드 변경은 없다.

## I-3 자격증명 삭제 시 기본 벤더 정리 — 정리함
- `deleteOwnCredential`(`src/server/llm/credentials/service.ts:307-342`)의 **같은 트랜잭션 안에서** 처리한다.
  - `update user_settings set chat_default_vendor=null, chat_default_model=null where user_id=? and chat_default_vendor=<삭제한 vendor>`.
  - 실제로 행이 바뀐 경우에만 `AUDIT_ACTIONS.llmDefaultUpdate` 감사를 남긴다(before는 이전 vendor·model, after는 null).
- `repository.deleteOwn`에는 넣지 않는다. 키를 교체하는 `storeSealed` 경로에서 기본값이 지워지면 안 된다.
- 반환 타입 `{deleted:true}`는 유지한다.
- 클라이언트: `LlmSection`의 onDelete에서 `defaults.vendor === vendor`이면 `setDefaults({vendor:null, model:null, modelReplaced:false})`.
- 마이그레이션 없음. 이미 남아 있는 잔존 행은 정리하지 않는다(런타임 폴백이 처리).

## 회귀 표 (`tests/unit/chat/guard-qa31.test.ts`에 고정, R=교체 / K=유지·바이트 동일)
| 구분 | 문장 | 기대 |
|---|---|---|
| L-A | `원가는 KRW 1,000입니다.` | R |
| L-A | `The cost is USD 500.` | R |
| L-A | `The cost is 1,000 won.` | R |
| L-A | `원가 JPY500` / `cost €500` | R |
| 계속 차단 | `원가는 천원입니다.` / `원가 만원` / `원가는 삼천원` / `원가는 오천만 원입니다.` / `원가는 오천만 원` | R |
| 계속 차단 | `원가 1조원` / `원가는 일조원입니다.` / `원가는 2천억원` / `원가는 억원대입니다.` | R |
| L-B | `마진 보고는 조원 모두에게 공유합니다.` | K |
| L-B | `원가 구조 원칙을 설명합니다.` / `원가 절감을 강조 원칙으로 삼습니다.` | K |
| 경계 | `cost 1,000 wonderful` / `USB 3.0 cost` / `cost in 2026` / `cost KRW` | K |
| I-1 | `COGS is $500.` / `COGS margin 30%` | R |
| I-1 | `What is COGS?` / `The gear cogs margin is not set, 3 pcs` | K |
| 스트리밍 S07 | 청크 `['원가는 KRW', ' 1,000입니다.']` | 출력 `''`, blocked |

기존 G01~G31, X01~X13, S01~S06과 `guard-regression.test.ts`, `graph-units.test.ts:215`에 회귀가 없어야 한다.

## 수용 기준
- [ ] 위 회귀 표 전부 통과. 기존 표에 회귀 없음.
- [ ] I-3: (1) 기본 벤더의 키를 삭제하면 vendor·model이 null이 되고, 감사 2건(credential delete, default update)이 남는다. (2) 다른 벤더 키를 삭제하면 기본값이 그대로다. (3) 키를 교체하면 기본값이 그대로다. (4) 삭제한 뒤 같은 벤더 키를 다시 등록해도 기본값이 되살아나지 않는다. (5) 정상 키가 하나도 없으면 설정에 빈 상태 문구, 챗봇에 MISSING 배너가 나온다. 단위 테스트(`credentials-actions.test.ts`)와 통합 테스트(`settings.pg.test.ts`)로 확인한다.
- [ ] `intent.ts` `COST_RE`, 컨텍스트 구성, prompt의 diff가 0이다.
- [ ] Dev 게이트 기록 + QA E2E 전체 1회 + 머지 head SHA의 `ci:run` 녹색.
- [ ] PR 본문에 `Closes #17`.

## 태스크
1. [BE] guard.ts 금액 패턴(L-A, L-B), COGS, 회귀 표 테스트.
2. [BE+FE] I-3 정리 로직, 감사, LlmSection 상태, 테스트.

PR 1개, 커밋 2개.

## 구현 중 결정 (Dev 되묻기 `msg_e0e7538a13d8` → Plan 결정, 2026-10-08)

- **Q1 `조원대` → B (R, 차단)**: 누설 방지를 우선해 `억원대`와 같이 다룬다. 공백 없는 `조원대`·`억원대`는 금액으로 본다. 단 바로 뒤에 `표`가 오면(`조원대표`, 구성원 대표) 금액이 아니다. 공백이 있는 `조원 대표`는 규칙 (a)에 따라 원래 유지다. 회귀 표 추가: `원가는 조원대입니다.` R / `마진은 조원대표가 보고합니다.` K.
- **Q2 `만`·`대` 충돌 → A 승인**: `만`·`대` 바로 뒤에 `[하한히해]`가 오면 일반어로 본다. `오천만 원만하게` K / `오천만 원만 받습니다` R / `오천만 원대` R을 회귀 표에 고정한다.
- **Q3 숫자 + 공백 + '원'으로 시작하는 일반어 → B (함께 수정)**: Main 결정 B("같은 원인의 오탐 함께 수정")의 범위에 든다. 원인은 같다(공백이 단어 경계를 넘어 다음 단어의 '원'을 잡음). 갈래 1(숫자+통화)에서 통화가 `원`이고 숫자와 `원` 사이에 공백이 있으면, 규칙 (b)와 같은 뒤 문자 판정을 적용한다. 회귀 표 추가: `원가 3 원칙을 설명합니다.` K / `원가는 3 원입니다.` R / `원가 1,000 원` R / `원가 1,000원칙`은 공백이 없으므로 기존대로 R.
- **Q4 I-3 감사 after → A**: 기존 `llmDefaultUpdate` 형식에 맞춰 `{vendor:null, model:null}`로 기록한다. 스펙의 "after = null"은 이 뜻으로 정정한다.
