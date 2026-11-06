# 챗봇 답변 마크다운 렌더링 (가격 정책·조달)

- 요구: Main msg_67a07d06a573 (2026-10-29). 사용자 "챗봇 둘다 md 형태로 출력 가능하게 만들어줘".
- 검토: UI/UX·기능/기술 병렬 검토 2건(상충 없음, 서로 보완).
- 개정: `ux-four-chat-split.md` §4 "답변은 평문 렌더 유지"(ConversationPane §4.3.10 주석)를 이 스펙으로 대체.
- 미정: ".md 내려받기/복사" 의미 여부는 Main 이 사용자 확인 중 → 확정되면 별 PR(이 스펙 비범위).

## 1. 현재
- assistant 말풍선 본문 1곳만 `{message.text}` + `whitespace-pre-line` 평문(ConversationPane.tsx:209·227). 저장 대화 재열람도 같은 Bubble(`fromStored`, useConversationThread.ts:36-44).
- notice·statusLabel·setup·footnote·action(견적 링크)은 별도 필드·별도 렌더(:217-250).
- 마크다운 의존성 없음. CSP `img-src 'self' blob: data:`(headers.ts:23).
- 출력 가드는 줄 단위 문장 판정(guard.ts:309), 토큰 가드는 줄바꿈·문장부호 단위 방출(:349), REPLY_MAX_LENGTH 1500(:290). 프롬프트 "5문장 이내"(가격)·"6문장 이내"(조달)(graph/prompt.ts:16·29). 조달 도구 외부 문구는 clipText 로 줄바꿈·제어 문자 접힘(procurement/chat/tools.ts:58-72) → 블록 인젝션 이미 차단, 인라인 기호만 남음.

## 2. 결정
### 2.1 렌더링 범위
- 마크다운: **assistant 답변 본문만**. 사용자 말풍선·오류 말풍선·setup·notice·statusLabel·footnote·action 은 평문 그대로(위치도 그대로) → 견적 링크 회귀 없음.
- 스트리밍 중·완료 후·저장 대화 재열람 모두 같은 `ChatMarkdown` 컴포넌트.

### 2.2 라이브러리·보안
- `react-markdown@10.x` + `remark-gfm@4.x` + `remark-breaks@4.x`, **정확한 버전 고정**(lockfile). `rehype-raw` 금지(원문 HTML 은 렌더 안 함 = `skipHtml`). `rehype-sanitize` 불필요(HTML 경로 없음) — 대신 `allowedElements` 허용 목록: p, br, strong, em, del, ul, ol, li, blockquote, code, pre, a, h1~h4(표시는 아래 상한), table, thead, tbody, tr, th, td, hr. 나머지는 `unwrapDisallowed`.
- `remark-breaks`: 옛 평문 답변의 줄바꿈 보존(재열람 회귀 방지).
- 링크(`urlTransform`): **내부 경로(`/` 로 시작, `//` 제외)만 링크**, 같은 탭. http/https 외부 URL·javascript:/data:/vbscript:/mailto: 등은 **링크로 만들지 않고 텍스트로** 표시(조달 외부 문구 속 URL 링크 심기 차단). 외부 링크 허용은 비범위(필요하면 허용 도메인 목록으로 후속).
- 이미지: `img` 미허용 → alt 글자만 표시(원격 로드 0, CSP 이중 방어).
- 클라이언트 전용(`'use client'`), `features/chat` 안에서만 import(조달 격리 ESLint 영향 없음). 번들 증가는 PR 본문에 실측(gzip) 기록.
- 조달 도구 출력의 마크다운 이스케이프는 **하지 않음**(가드 maskTerms 정확 일치를 깨뜨림) — 렌더러 허용 목록 + 가드 기호 제거로 방어.

### 2.3 출력 가드 보강 (필수, 새 누설 0 원칙)
- 판정용 사본 정규화(`normalizeForGuard`)에서 마크다운 기호 제거: `**` `__` `*` `_` `` ` `` `~~`, 링크 `[t](u)`→t, 셀 구분 `|`→공백, 제목·목록 접두. `**1,000**원`·`` `1,000`원 `` 이 금액으로 잡혀야 함.
- **표 블록은 머리행 + 각 데이터 행을 합쳐 한 문장으로 판정**(원가 단어가 머리행, 금액이 데이터 행에 있어도 잡힘). 최종 가드·토큰 가드(push/flush) 모두 동일.
- maskTerms(조달 외부 이름 가림)는 기호 제거 뒤 사본에 적용 → `**품명**` 이어도 가림 유지.

### 2.4 프롬프트 (두 domain 공통 한 줄 + 조달 한 줄)
- "적절하면 마크다운을 쓰세요: 목록, 비교·여러 건은 표. 제목은 꼭 필요할 때만 `###` 이하. HTML·이미지·외부 링크는 쓰지 마세요."
- 문장 상한 개정: "**본문 5문장(조달 6문장) 이내 + 표·목록은 별도, 표는 최대 10행**".
- 조달: "실적·공고·납품 목록은 표(열 4개 이내)로".
- REPLY_MAX_LENGTH 1500 → **2000**(마크다운 기호 몫). 잘림 처리(`… (일부만 표시)`)는 기존 동작 유지, 잘린 표는 렌더 시 깨지지 않으면 됨.
- 규칙 기반 응답(`mode: rule`) 문구에 `*`·`_`·`|` 가 의도치 않게 서식이 되는지 점검·필요 시 이스케이프.

### 2.5 스트리밍
- 토큰마다 렌더(A안). 렌더 직전 **미완성 코드펜스는 닫는 펜스를 임시로 붙임**(작은 순수 함수). 미완성 표 행은 GFM 이 문단으로 보이다 표로 바뀌는 것 허용(토큰 가드가 줄 단위라 행 단위로 옴). `final` 이벤트가 전체 교체.
- 파싱 비용: 렌더 throttle(≈ requestAnimationFrame 또는 50ms) + 완료 메시지는 memo. scrollTo 는 throttle 된 렌더에 맞춤.

### 2.6 UI (Penta 토큰만, 하드코딩 색 금지 → 라이트·다크 자동)
- 본문 14px/1.55 유지. 말풍선 안 제목 상한: h1·h2 → 16px/600, h3·h4 → 14px/600(전역 h1 40px 금지). 문단·목록 간격 6px, 목록 들여쓰기 1.25em, 항목 간격 2px.
- 인라인 코드: surface-card 배경, 13px 모노. 코드블록: 13px 모노, 가로 스크롤.
- 인용: 왼쪽 2px border-subtle + text-secondary. hr: border-subtle.
- 표: 밀집 14px(Q-D1=B), 셀 여백 6px 10px, 머리행 surface-card, `<th scope="col">`. **표만 가로 스크롤** — `overflow-x-auto` 래퍼에 `tabIndex=0 role="region" aria-label="표"` + 포커스 고리. 말풍선 폭(max-w 78%·모바일 90%)은 넓어지지 않음.
- 링크(내부만): text-link + FOCUS_RING_CLASSES.
- role=log·aria-busy·live region·빈/로딩/오류 상태·bubbleEnter 모션 변경 없음(표 래퍼에 layout 애니메이션 금지).

## 3. 수용 기준
공통: Dev 게이트 + 머지 head `ci:run` 녹색(QA 생략). 마이그레이션 없음. 테스트 데이터는 합성(조달 실데이터·사용자 대화 내용 미사용).
- [ ] 두 챗봇 assistant 답변에서 `###`·굵게·목록·GFM 표·인라인/블록 코드·인용이 각 요소로 렌더(E2E 1건 이상 각 domain, fake 모델 응답)
- [ ] 저장 대화 새로고침 후 재열람에도 같은 요소로 렌더(E2E)
- [ ] 사용자 말풍선에 `**x**`·`| a |` 를 보내도 평문 그대로(E2E 또는 단위)
- [ ] 원문 HTML(`<script>`, `<img onerror>`, `<a href>`)은 요소로 렌더되지 않음, `javascript:`/`data:`/`vbscript:`/외부 http(s) 링크는 `<a>` 없이 텍스트, `![](http…)` 은 `<img>` 없음, 내부 `/…` 링크만 `<a>` — 단위
- [ ] 미완성 코드펜스·미완성 표(스트리밍 중간 문자열)가 예외 없이 렌더되고 뒤 텍스트를 삼키지 않음 — 단위
- [ ] 옛 평문 답변(줄바꿈 1개 포함) 재열람 시 줄바꿈 유지 — 단위
- [ ] 가드: 표 머리행 `| 품목 | 원가 |` + 행 `| A | 1,000원 |` 차단, `**1,000**원`·`` `1,000`원 `` 금액 인식, 원가 단어 강조 우회 차단, `**품명**` 조달 외부 이름 가림 유지(오탐 없음) — 최종·토큰 가드 각각 단위
- [ ] 조달 도구 결과 외부 문구에 `[x](https://evil)`·`|`·백틱(합성)이 있어도 링크 생성 없음·표 구조 깨짐 없음 — 단위
- [ ] 견적 링크(action)·setup·footnote·statusLabel 기존 E2E 통과(회귀 없음)
- [ ] 표 래퍼 가로 스크롤(768px 미만 말풍선 폭 불변), 키보드로 래퍼 포커스 가능 — E2E 1건
- [ ] 의존성 정확한 버전 고정, PR 본문에 번들 증가(gzip) 실측 기록

## 4. 비범위
.md 내려받기·답변 복사 버튼(Main 확인 후 별건), 외부 링크 허용, 이미지 표시, 코드 하이라이트, 수식, 사용자 메시지 마크다운.

## 5. 순서
- 단일 PR(PR-MD). 디자인 PR-6(alias 제거·ESLint) 이 이미 게이트 중이라 PR-6 머지 뒤 머지(착수는 바로 가능) — 새 코드는 시맨틱 토큰만 쓰고 PR-6 ESLint 규칙을 통과해야 함.

## 6. 진행 기록
- 2026-10-29 Dev 구현 해석 5건 수용(msg_99243219dbb5): ① 조달 외부 문구 `|` → clipText 에서 전각 `｜` 치환(이스케이프 아님, 표 칸 분리 방지), 가드 NFKC 가 판정용 사본에서 `|` 로 되돌려 maskTerms 일치 유지 ② 말풍선 제목 요소 자체 강등 h1·h2→`<h3>`(16px/600), h3·h4→`<h4>`(14px/600) — 페이지 h1 계층 보호 ③ 규칙 응답은 ruleAnswer 출력에 한 번 escapeMarkdownText(품명·품번·사용자 검색어의 마크다운 기호) ④ 가드 판정 사본에 HTML 문자 참조 디코드·태그 모양 제거 추가(react-markdown 이 `&#50896;` 를 글자로 풀고 skipHtml 이 태그만 지우는 우회 차단), 태그 아닌 꺾쇠 글은 유지 ⑤ E2E fake 모델은 질문에 '마크다운'이 있을 때만 합성 마크다운 요약, 픽스처 관리자 사용. 의존성 react-markdown 10.1.0·remark-gfm 4.0.1·remark-breaks 4.0.0 정확 고정.
- 2026-10-29 PR-MD #107 머지(main 5742131, head ffac6e2, CI 녹색). 마이그레이션 없음. 게이트 unit 3921·integration 31·E2E 207/207, #106 위 rebase 후 PR-6 ESLint 포함 lint·typecheck·unit 통과. 번들 gzip /pricing/chat·/procurement/chat 각 +45.7 KB, 다른 화면 0. LAN :3000: Dev 워크트리에서 `pnpm install --frozen-lockfile --offline`(재시작 없음, HMR) → 조달 챗봇 전송 200, 확인용 픽스처 관리자 합성 대화 2건 삭제. 비범위 유지: .md 내려받기·복사(사용자 확인 대기), 외부 링크·이미지·하이라이트.
