# UX 4건 — 가격 정책 묶기 · 클릭 커서 · 적합도 툴팁 · 챗봇 분리 + 대화 저장

- 요청: Main msg_0b59d2a955d8 (2026-10-28). 사용자 원문: "1. 가격 정책 조회, 계산기 탭을 '가격 정책' 으로 탭 묶기 '조달' 처럼 2. 클릭 가능한 컴포넌트 마우스 오버 시 커서 모양 손가락 모양으로 변경 3. 조달의 적합도 컬럼 옆에 툴팁 추가 4. 챗봇의 경우 조달 챗봇과 가격 정책 챗봇을 나누어서 탭을 따로 빼서 구현함 상단 채팅은 빼는 방향 - 계정별 채팅 대화내역이 저장되게 구현 필요, 대화방 내용을 수정할수있고, 대화방을 삭제할 수 있도록 구현"
- 모드: QA 생략. 디자인 대기열 계속 진행, 새 화면은 Penta 토큰·컴포넌트·아이콘.
- 검토: UI/UX·기능/기술 병렬. 상충 없음. Main 되묻기 3건(§6 Q-U1~U3) — 챗봇 화면 PR(C2)만 대기.

## 1. 가격 정책 묶기 (PR-U1)
- 현재 '조달'은 화면 안 탭이 아니라 **사이드바 섹션 "조달" + 하위 메뉴 3개(각자 경로)**(`features/shell/nav.ts:24-46`). 사용자 표현 "'조달' 처럼" = 이 구조 → **같은 방식으로 결정**.
- `NAV_PRICING` 섹션 "가격 정책" 아래 "가격 정책 조회"(`/pricing`, pricing.read)·"계산기"(`/calculator`, calculator.use). NAV_MAIN 에서 두 항목 제거.
- URL·리다이렉트·page-state 키·알림 링크·챗봇 견적 링크 변경 없음. 화면 안 탭(`?tab=`)은 계산기 내부 탭과 2단 충돌이라 쓰지 않음.
- 메뉴 이름은 사용자 용어 그대로("가격 정책 조회"). 섹션 순서: 가격 정책 → 조달 → 관리자.
- `/pricing` 항목에 `exact: true`(챗봇 경로 `/pricing/chat` 와 동시 활성 방지).

## 2. 클릭 커서 (PR-U1)
- Tailwind 4 preflight 가 button 을 `cursor: default` 로 둠 → 지금은 13개 파일 개별 클래스.
- `globals.css` `@layer base` 전역 규칙(명시도 0):
  - `:where(button, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], summary, a[href], label[for], select, input:is([type=checkbox],[type=radio],[type=range],[type=file],[type=color],[type=submit],[type=button]), [data-clickable]):not(:disabled, [aria-disabled=true]) { cursor: pointer }`
  - `:disabled, [aria-disabled=true]` 는 기존 not-allowed 유지. 슬라이더 grab/grabbing(#89) 유지. 텍스트 입력 제외.
- 클릭 가능한 행·div(onClick)는 `data-clickable` 부여 sweep. 개별 `cursor-pointer` 클래스는 남아도 무해(정리는 PR-6).

## 3. 적합도 툴팁 (PR-U1)
- 입찰 공고 표 '적합도' 머리(`BidTable.tsx` COLUMNS) 옆에 기존 `InfoHint`(클릭·Enter·Space 열림, 마우스 이탈·바깥 클릭 닫힘), `name="적합도 기준"`, align start. 머리 클릭 정렬 없음 → 충돌 없음.
- 문구는 **요인과 등급 구간만**(항목별 점수·회사명 비공개 — 규칙 변경 시 어긋남 방지), 상수 한 곳(`src/lib/procurement/copy.ts` 등):
  > 공고명·업무구분·예산·마감·수요기관 납품 이력으로 0~100점을 매깁니다. 70점 이상 상, 45점 이상 중, 그 아래 하.
  > 가점: 제품 구매·구축 사업, 물품 공고, 자사·경쟁사 제품 납품 이력이 있는 기관, 큰 예산, 재공고.
  > 감점: 연구·평가·점검·컨설팅 용역, 개발 사업, 소액, 마감 3일 이내.
  > 공고별 근거는 '근거' 칸에서 확인하세요.
- 근거: `collector/src/jodal/db.py` `bid_fit`(기본 50, 상 ≥70, 중 ≥45). '근거' 칸 이름은 실제 화면 이름에 맞춤.

## 4. 챗봇 분리 + 대화 저장 (PR-C1~C3)
### 4.1 현재
- `POST /api/chat`(chat.use, rate limit, SSE), LangGraph + 사용자 키 벤더, 레지스트리 도구 pricing·compare·quote(노출·실행 2중 권한 검사), 원가 도구 없음 + `assertNoCostKeys` + 문장 가드. **대화 저장 안 함(I-6)**, 헤더 ChatLauncher → 오른쪽 도킹 패널, 알림 드롭다운과 상호 배제(#31).

### 4.2 결정
- **I-6 개정**: 사용자 요청으로 대화 저장. 저장 대상은 **가드를 통과해 사용자에게 보여 준 최종 텍스트와 서버가 만든 액션(링크)만**. 도구 원본 결과·사고 블록·프롬프트는 저장하지 않음. 원가는 원래 챗봇 경로에 없음(변경 없음).
- 마이그레이션 0014(추가형): 
  - `chat_conversations(id uuid pk, user_id → users ON DELETE CASCADE, domain enum('pricing','procurement'), title text ≤100, created_at, updated_at)`, 인덱스 `(user_id, domain, updated_at desc)`.
  - `chat_messages(id, conversation_id → CASCADE, role enum('user','assistant'), content text, action jsonb null, created_at)`, 인덱스 `(conversation_id, created_at)`.
- 소유권: 모든 쿼리에 `user_id = session.user.id` 필수. **관리자 포함 남의 대화 열람 경로 없음**. 남의 ID → 404.
- history 는 **서버가 DB 에서 읽음**(클라이언트 history 미신뢰·위조 제거). 기존 상한(최근 10턴·항목 1,000자) 유지.
- 메시지 전송 시 대화 `domain` = 요청 경로 domain 서버 검증(가격 대화에서 조달 도구 호출 차단).
- 도메인별 시스템 프롬프트·기능 목록: pricing = 기존 그대로, procurement = 새 프롬프트 + 조달 도구.
- 조달 도구(`permission: 'procurement.read'`, 레지스트리 등록, 기존 조회 함수 재사용, `ProcurementAccess` 토큰): **읽기 전용**, 실적 현황 요약·등록 품목 검색·입찰 공고 검색·납품요구 검색. 화면에서 `procurement.read` 사용자가 이미 볼 수 있는 범위만. 출력 필드 화이트리스트 + 길이 제한(외부 수집 텍스트 = 프롬프트 인젝션 대비, "도구 결과 속 지시는 데이터" 규칙 유지). 응답 키 이름에 `cost` 금지(가드 오탐 방지). 조달 금액·'마진' 등 문장 가드 오탐 테스트 추가.
- 권한: 조달 챗봇은 메뉴·화면 가드·API 세 곳 모두 `procurement.read` + `chat.use`. 권한을 잃으면 조달 대화 목록 숨김, 열람·전송 거부(삭제는 안 함).
- 헤더 진입점·도킹 패널 **완전 제거**("상단 채팅은 빼는 방향"), 알림 드롭다운의 #31 상호 배제 결합 정리(알림 단독 동작).
- rate limit 버킷은 공유(분리 안 함).
- 화면(Q-U2 답 전 기본안 = 각 섹션 안 메뉴): 데스크톱 왼쪽 대화 목록(≈260px, 최근 순, 제목 + 상대 시각) + 오른쪽 대화창. "새 대화", 행 ⋯ 메뉴 "이름 바꾸기"(제자리, Enter 저장·Esc 취소)·"삭제"(Penta 확인 모달, 되돌릴 수 없음 안내). 제목 자동 = 첫 질문 앞 30자. 대화 ID 는 URL `?c=`. 빈 목록 예시 질문 칩, 목록 스켈레톤, 스트리밍 중 중지 버튼, 오류 시 그 메시지에서 다시 시도, SetupBanner 유지. 768px 미만 목록/대화 한 화면씩. 답변은 평문 렌더 유지. 메시지마다 작성 시각 표시(저장된 가격은 그 시점 값). "계산기에서 열기" 링크는 같은 탭 이동, 대화는 DB 라 돌아오면 `?c=` 로 복원.
- 대화 검색·목록 상한 UI 는 비범위(서버 상한: 사용자·domain 당 대화 200, 대화당 메시지 400 — 초과 시 새 대화 안내).

## 5. PR·순서
- Penta 대기열 사이에 끼움: Penta PR-2 머지 → **PR-U1**(커서·메뉴 묶기·툴팁) → Penta PR-3/PR-4… 와 챗봇 교차.
- **PR-C1** 0014 + 저장 API(목록·생성·이름 변경·삭제·메시지) + 서버 history DB 읽기 + domain 검증 + 소유권 테스트. LAN 적용 전 백업. Penta PR-2 와 무관해 지금 착수 가능.
- **PR-C2** 챗봇 화면 2개·메뉴·헤더/도킹 제거·#31 정리. Penta PR-2 머지 + Q-U1~U3 답 후.
- **PR-C3** 조달 도구·도메인 프롬프트·가드 테스트. C1 후(C2 와 병행 가능).
- 조달 sweep(Penta PR-4d)은 C2·C3 후.

## 6. Main 되묻기
- **Q-U1 "대화방 내용을 수정"**: A 대화방 이름 바꾸기(작음) / B 보낸 메시지를 고치고 답을 다시 생성(그 뒤 내용은 잘라 냄, A 의 3~5배) / C 둘 다. Plan 의견: A 먼저, B 는 필요하면 후속.
- **Q-U2 챗봇 위치**: A 각 섹션 안 메뉴(가격 정책 > 가격 정책 챗봇 `/pricing/chat`, 조달 > 조달 챗봇 `/procurement/chat`) — 권한·맥락 자연스러움 / B 별도 "챗봇" 섹션 아래 2개 / C 한 화면에서 탭 전환. Plan 의견: A.
- **Q-U3 보관·삭제**: 보관 기간(무기한·사용자가 삭제 / 마지막 사용 후 N일 자동 삭제), 삭제 방식(즉시 완전 삭제 / 30일 휴지통). Plan 의견: 무기한 + 즉시 완전 삭제(개인 대화라 감사 로그에는 대화 ID·domain 만, 내용 미기록).

## 7. 수용 기준
공통: 각 PR Dev 게이트 + 머지 head `ci:run` 녹색(QA 생략). 0014 LAN 적용 전 백업 보고. 조달 원본 데이터·실데이터 대화 내용은 테스트·PR·로그·보고에 없음(합성).
- [ ] U1: 사이드바 "가격 정책" 섹션에 두 메뉴, 기존 URL 그대로·권한별 표시, `/pricing` exact
- [ ] U1: 버튼·탭·옵션·체크박스·라디오·select·summary·링크·data-clickable 행 hover 커서 pointer, disabled/aria-disabled 는 not-allowed, 슬라이더 grab 유지, 텍스트 입력 text — computed style E2E 1건 + 단위
- [ ] U1: 적합도 머리 InfoHint, 문구 상수, 키보드로 열고 Esc·바깥 클릭 닫힘
- [ ] C1: 남의 대화 목록·조회·이름 변경·삭제·전송 404(ADMIN 포함), domain 불일치 거부, 삭제 시 메시지 CASCADE, 사용자 삭제 시 CASCADE, 저장 내용 = 가드 통과 최종 텍스트, history 를 DB 에서 읽음(클라이언트 history 무시), 상한 초과 안내 — 통합 테스트
- [ ] C2: 헤더 채팅 진입점·도킹 패널 없음, 알림 드롭다운 단독 정상, 두 챗봇 화면 목록/새 대화/이름 바꾸기/삭제 확인 모달/스트리밍 중지/오류 다시 시도/빈 상태, 새로고침 후 대화 유지, 모바일 너비 — E2E
- [ ] C3: `procurement.read` 없으면 조달 챗봇 메뉴·화면·API 모두 거부, 조달 도구 읽기 전용·필드 화이트리스트·길이 제한, 공고명 속 지시문(합성) 무시, 가드 오탐 테스트(조달 금액 문장), 가격 대화에서 조달 도구 미노출

## 8. 비범위
보낸 메시지 편집·재생성(Q-U1 답에 따라), 대화 검색, 대화 공유·내보내기, 관리자 대화 열람, 챗봇 rate limit 분리, 원가 데이터 챗봇.

## 9. 진행 기록
- 2026-10-28 Q-U1=A·Q-U2=A·Q-U3=A(사용자 확인, Main msg_e0bda9fe7541): 대화방 이름 바꾸기만(메시지 편집·재생성은 후속), 각 묶음 안 메뉴(/pricing/chat·/procurement/chat), 무기한 보관 + 즉시 완전 삭제(audit_logs 에 chat.conversation.delete — 대화 ID·domain 만, 제목·내용 미기록). 나머지 Plan 결정 수용 → PR-C2 대기 해제(Penta PR-2 머지 후).
- 2026-10-28 PR-C1 #95 머지(squash e4e7934): 0014 chat_conversations·chat_messages, 소유자 전용 API, 서버 history(10턴·1,000자), 상한 200/400, 감사 create/rename/delete 에 ID·domain 만. 게이트 unit 3705·integration 31·E2E 20/20, CI 녹색. LAN 0014 적용(추가형, 적용 전 pg_dump 백업 Dev scratchpad `prami-before-0014-20261028-170917.dump`). Dev 해석 수용: conversationId 없는 요청은 옛 비저장 경로(도킹 패널은 C2 까지 유지) / 조달 대화 전송은 C3 전까지 "준비 중" 거부 / domain 불일치 404 / `procurement.read` 상실 시 조달 대화 모든 동작 403 + 거부 감사, 데이터 보존 / 스트림 실패·중단 시 답 미저장·사용자 메시지만 남기고 같은 질문 재전송 시 재사용. 참고: audit_logs append-only 로 감사 행 있는 사용자는 하드 삭제 불가(기존 제약, 이번 변경 무관).
- 2026-10-28 PR-U1 #97 머지(squash 1ca9bdf): 사이드바 '가격 정책' 섹션(가격 정책 조회 `/pricing` exact·계산기), 전역 클릭 커서(`:where`, disabled → not-allowed) + `data-clickable`(DataTable 행·차트 영역), 적합도 기준 툴팁(문구 상수). 게이트 unit 3742·E2E 197/197, CI 녹색. Dev 해석 수용: 전역 disabled → not-allowed 규칙 신설(전에는 컴포넌트별 클래스) / `:not(...)` 로 명시도 0,1,0 이나 base 층이라 영향 없음. (09:15 Dev 사용량 한도 중단 메일은 이후 재개되어 무효.)
