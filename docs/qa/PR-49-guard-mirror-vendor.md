# QA 기록 — PR #49 출력 가드 2차 PR-1 (미러 fake 벤더 + 코퍼스 고정 + chat-guard E2E)

- 판정: **통과 / 셀프머지 승인** (2026-10-15)
- 요청: Dev msg_238e8ff14418 (재부팅 재전송, 원 msg_b705524d34da)
- 스펙: origin/Plan docs/specs/output-guard-coverage-2.md §2·§4 PR-1
- 증거(로컬 scratchpad): fe49shots/, scripts/fe49.mjs, fe49*.log, be49logs/

## Dev에 보낸 승인서

```
[통과 / 셀프머지 승인] PR #49 — 출력 가드 2차 PR-1 (미러 fake 벤더 + 코퍼스 고정 + chat-guard E2E)

검증 SHA: 5f24411 (5f2441106845210fda97d76bddfabec1b9b9bea5, base main 1c7205e)
SHA 대조: 검증 SHA = 머지 head SHA = ci:run 녹색 run 의 head SHA
  ※ #47·#48이 머지돼 main이 9a5b850입니다. rebase하면 규칙 §3.3에 따라 아래를 기록해 주세요.
    · rebase로만 SHA가 달라졌다는 사실
    · diff가 같은지
    · rebase 후 head SHA의 ci:run 녹색
  ※ 파일은 겹치지 않습니다.
  (참고: #48은 4e8bb97 → ffde11e rebase 머지였고, QA가 diff 동일을 직접 확인했습니다.)

## 검증한 내용 (실제 실행 기준)
Frontend/라이브 (실제 Chromium, /api/chat SSE를 fetch tee로 원문 캡처):
  - 실행: next dev :3200
    · LLM_VENDOR_MODE=fake / live 각각, 새 DB qa49fe
    · main은 :3250, qa49fem
  - fake-mirror- 키 저장(Anthropic 카드): 일반 사용자·관리자 모두 '정상', 힌트 fake-…XXXX
  - R행, 일반 사용자 8건:
    · 1,000원 / 12,345원 / KRW 1,000 / USD 500 / 오천만 원 / 2천억원 / €500 / JPY500
    · 전부 final mode=llm에서 사용자 거부 문구로 교체됐습니다.
    · 금액 문자열이 SSE 원문·말풍선 텍스트·말풍선 outerHTML·대화 기록(13요청, assistant 50항목)에 0회
  - R행, 관리자 4건(1,000원 / 35% / KRW 50,000 / 일조원): 관리자 거부 문구, 금액 SSE·DOM·기록 0회
  - K행 6건(두 문장짜리 포함): final·token 합·말풍선 모두 § 제거 원문과 정확히 일치
  - 청크:
    · '원가는 1,000원입니다.' → ["원가는"," 1,","000","원입니","다."]
    · 금액이 3청크에 걸쳐도 UI에서 차단됩니다.
    · 이모지 서로게이트는 쪼개지지 않습니다.
  - 키 마스킹:
    · 설정 HTML에는 fake-…XXXX만 보입니다.
    · 키 본문은 응답·서버 로그(fake·live·main)·pg_dump에서 모두 0회
  - live 모드에서 fake-mirror- 키를 저장하면 거부되고, 형식 오류 문구가 나오며 DB는 바뀌지 않습니다.
  - fake-echo-(AC-204): 저장 상태·경고·마스킹·채팅 응답 모두 main과 동일
  - 채팅 UI: 열기, Esc 닫기 후 포커스 복귀, 콘솔 에러 0, 다크 테마 없음(라이트만). 스크린샷 fe49shots/
Backend/테스트 (git archive 사본, 실 Postgres):
  - lint·typecheck·format PASS
  - unit coverage 2134 passed
  - build·prerender·trace·secrets PASS
  - integration 30 passed (qa49be_int)
  - E2E 전체 1회: SHA 5f24411, 새 DB qa49be_e2e, 69/69 passed, 4.5분
    · chat-guard 3건, settings-llm(AC-204) 포함
  - 보호 파일 diff 0줄: guard.ts·intent.ts·respond.ts(거부 문구)·prompt.ts·compose.ts·stream.ts·env.ts·registry.ts·log.ts
    · 변경된 파일은 7개뿐입니다.
  - 코퍼스:
    · 원본 8집합을 재직렬화한 sha256 6749a7d1…e0c3이 스펙과 일치합니다.
    · 집합 크기는 스펙·#43 QA 기록과 같습니다.
    · benign2는 69문장(전부 고유·숫자 포함·전부 K)입니다.
  - 스냅샷: main 1c7205e의 guard.ts로 744행을 독립 판정했고, 스냅샷과 차이 0건입니다.
  - 게이팅:
    · fake-mirror- 키는 fake 모드에서만 받고, live에서는 거부합니다.
    · NODE_ENV=production·VERCEL_ENV=preview면 팩토리와 bindTools가 throw합니다.
    · env.ts도 prod에서 LLM_VENDOR_MODE=fake 기동을 거부합니다(실행 확인).
    · 프로덕션 번들에 미러 코드가 들어 있지만, 런타임 이중 차단으로 막힙니다(스펙 허용).
    · 키 경계: 256자 허용, 257자 거부, 빈·공백·§·한글 접미사 거부. 크래시 0
  - 변이 실험(단위·E2E 13건):
    · 단위: 가드 정규식 약화·PERCENT 제거·미러 § 유지·청크 크기·prod assert 제거·VERCEL_ENV 미검사·fake.ts 목록 제거를 모두 잡았습니다.
    · E2E chat-guard: § 유지·mentionsCostAmount 무력화·token guard push/flush 무력화 4건을 모두 잡았습니다.
    · 생존은 UTF-16 청크화 1건뿐입니다(아래 백로그).

## 수용 기준 대조
- [x] fake-mirror- 키 fake 모드 한정 / live 거부 / production·VERCEL_ENV 팩토리 throw — 단위 + tsx 독립 실행 + 라이브 UI
- [x] 미러 응답 = § 제거 입력, 3자 청크 스트리밍 — 단위, tsx, SSE 원문
- [x] fake-echo-(AC-204) 동작·마스킹 무변화, fake-mirror- 키 로그 미노출 — FE main 대조, 단위 50/50, 로그·pg_dump 0회
- [x] guard-corpus.json 커밋(sha256 일치 + benign2 69) + main 판정 스냅샷 통과 — 독립 재계산·재판정 0 diff
- [x] E2E chat-guard: R 거부 문구(일반·관리자) + SSE·DOM·기록 금액 0회, K 원문 일치, 청크 경계 1건 이상 — 69/69, E2E 변이 4/4 검출
- [x] guard.ts diff 0
- [x] Dev 게이트 기록 + QA E2E 전체 1회(69/69) — 머지 head SHA의 ci:run 녹색은 Dev가 머지 전에 확인

## 백로그 (비블로킹, 이번 머지 안 막음)
1. 로그 마스크 정규식(log.ts `\bfake-[a-z0-9]+-[A-Za-z0-9_.-]{8,}`)이 접미사 8자 미만을 가리지 못합니다.
   - 예: 키 최소 16자를 맞춘 fake-mirror-abcd
   - 모든 fake 접두사에 공통인 기존 문제이고, fake 모드 한정이며 실제 비밀값이 아닙니다.
2. '코드포인트 단위 청크'를 고정하는 테스트가 없습니다(UTF-16 단위 변이 생존). 구현은 맞습니다.
3. SSE 원문 단언만으로는 청크에 쪼개진 금액을 못 잡습니다. token 합 단언(spec.ts:165)이 보완하고 있어 실효는 있습니다.
4. 클라이언트 history는 최근 assistant 약 5개만 유지합니다.
   - 'R행 수 = 기록 속 거부 수' 단언은 역할별 R행이 5개 이하라서 성립합니다.
   - R행을 늘리면 깨집니다.
5. 스펙 주석의 'discard' 언급이 실제 이벤트 흐름과 다릅니다.
   - 실제 흐름: 첫 문장 token → final 교체. discard 이벤트는 없습니다.
   - 누출은 없습니다.
6. serial 모드라 USER 테스트가 실패하면 ADMIN 테스트가 실행되지 않습니다(진단성만 해당).
7. live 모드에서 fake- 키를 넣으면 '테스트 전용' 안내 대신 일반 형식 오류가 나옵니다(기존).

머지 진행하셔도 됩니다. (머지는 Dev가 수행)
```
