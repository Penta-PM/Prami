# 스펙: #31 알림 기능 (MVP — 앱 내 알림)

- 요구사항: Main `msg_f2ac899374a8` (2026-10-08). 이슈 본문에 상세 요구사항이 없어 Plan이 정의한다. 사용자 승인을 받았고, 일반 설계 결정은 Plan 권한이다.
- 상태: 확정 → Dev 배정. 착수 순서(2026-10-12 갱신): #32 PR-3 → 모달 오닫힘 → 계산기 소분류 → 출력 가드 2차 PR-1·PR-2 → **#31**(마지막).
- 되묻기는 하지 않았다. 외부 발송 채널(이메일·푸시)과 실시간 인프라(SSE·WebSocket·cron)를 모두 배제했기 때문에 범위를 바꾸는 결정이 없다.

## 1. AS-IS / TO-BE

| 항목 | AS-IS | TO-BE |
|---|---|---|
| 헤더 종 아이콘 | `Header.tsx:41` `<IconButton label="공지사항" icon="bell" />`. onClick이 없는 장식용 버튼 | **알림** 버튼. 안 읽은 개수 배지와 드롭다운 목록 |
| 사용자에게 알리는 수단 | 없음. 공지는 홈 최근 5건과 `/notices`에서만 볼 수 있음. 가격 갱신과 역할 변경은 당사자가 알 수 없음 | 공지 게시, 가격정책 적용, 내 역할 변경을 앱 안에서 알림 |
| 읽음 상태 | 없음(공지에도 사용자별 읽음 상태 없음) | 알림 단위 읽음 처리(개별 클릭, 모두 읽음) |
| 저장소 | 없음 | `notifications` 테이블(마이그레이션 `0008`) |

## 2. 알림 이벤트 (MVP 3종)

공통 규칙: 그 행위를 한 본인은 수신 대상에서 뺀다. 수신 대상은 **활성 사용자**만이다. 알림 insert는 원 행위와 **같은 트랜잭션** 안에서 한다(알림 insert가 실패하면 원 행위도 롤백한다. 감사 로그와 같은 원칙).

| type | 발생 지점 | 수신 대상 | 제목 / 본문 | 이동 |
|---|---|---|---|---|
| `notice.created` | `server/notices/mutations.ts` 신규 생성만(수정 시에는 알리지 않음) | 활성 사용자 전원 | "새 공지: {제목}". 중요 공지는 중요 배지 | `/notices/{id}` |
| `policy.applied` | `server/imports/apply-policy.ts` `finalizeRun` 성공 시(실패는 알리지 않음) | 활성 사용자 전원 | "가격정책이 갱신되었습니다" / "반영 {N}건"(**금액 없음**) | `/pricing` |
| `user.role_changed` | `server/users/mutations.ts` role이 바뀌었을 때(`diffUser`) | 대상 사용자 1명 | "역할이 {관리자/사용자}(으)로 변경되었습니다" | `/settings` |

- 공지를 삭제하면(소프트 삭제) 같은 트랜잭션에서 `ref_type='notice' AND ref_id=id`인 알림 행을 지운다. 목록 조회도 삭제된 공지를 가리키는 알림을 빼서 이중으로 막는다.
- 기능 배포 **전**의 공지로는 알림을 만들지 않는다(소급 없음).
- **후속(비범위)**:
  - 원가 import 적용 알림(ADMIN). 원가 유출 위험이 있어 제외한다.
  - 신규 사용자 가입을 ADMIN에게 알리기.
  - LLM 키 만료 임박. 조회할 때만 판정해서 알림을 만들 발생 시점이 없다.
  - 감사 거부 이벤트.
  - 견적 단가 변동.
- **민감정보 규칙**: 알림의 제목과 본문에 원가나 금액을 넣지 않는다. `type → requiredPermission` 표를 코드에 두고 단위 테스트로 고정한다. 그래야 나중에 type을 추가할 때 원가 계열이 USER에게 가지 않는다.

## 3. 기존 공지 기능과의 관계

- 공지(`notices`)는 **콘텐츠**이고 그대로 유지한다. 알림은 공지가 게시됐다는 **사건 통지**다. 공지 목록·상세·관리 화면은 바꾸지 않는다.
- 종 버튼의 의미가 "공지사항"에서 "알림"으로 바뀐다. 원래 동작하지 않던 버튼이라 기능 손실은 없다. 공지 진입점은 홈 카드("전체 보기" → `/notices`)와 알림 항목이다.

## 4. 기술 결정 (Dev는 이대로 구현)

### 데이터 모델 — `notifications` (마이그레이션 `0008_notifications`)
| 컬럼 | 정의 |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid not null → `users`, on delete cascade |
| `type` | **text** not null. 코드 상수 `NOTIFICATION_TYPES`. pgEnum은 쓰지 않는다(type을 추가할 때마다 ALTER가 필요해지므로) |
| `title` | text not null, ≤200 |
| `body` | text null, ≤500 |
| `ref_type`, `ref_id` | text null |
| `actor_user_id` | uuid null → `users`, on delete set null |
| `created_at` | timestamptz default now() |
| `read_at` | timestamptz null |

- 인덱스: `(user_id, created_at desc)`, 부분 인덱스 `(user_id) where read_at is null`.
- **link 컬럼은 두지 않는다.** 이동 경로는 서버의 `notificationHref(type, refId)`가 계산하고, 결과는 `/notices/{uuid}`·`/pricing`·`/settings` 중 하나다. 이렇게 해서 open redirect를 구조적으로 막는다.
- 브로드캐스트는 **사용자별 행 fan-out**으로 처리한다. 활성 사용자를 대상으로 `INSERT … SELECT` 한 문장이다. 사용자 수는 수백 명 규모다.
- 함께 갱신할 고정 목록: `tests/fixtures/sales-prices-columns.ts` `EXPECTED_TABLES`, `server/ops/data-verify.ts` `ZERO_TABLES`.

### 보관
- **최근 30일**만 조회하고 셈한다(조회 시 필터). 드롭다운에는 최근 20건을 보여 준다. 물리 삭제와 cron은 후속으로 미룬다(cron은 `CRON_SECRET`과 env 1:1 테스트가 따라오는 인프라 추가다).

### API
- `GET /api/notifications?limit=20` → `{ unreadCount, items[] }`. `runRoute`를 쓰고 `Cache-Control: no-store`. 본인 알림만 반환한다. 각 item에는 `href`(서버가 계산)와 `createdAt`(ISO)이 들어간다.
- 서버 액션 `markNotificationRead(id)`, `markAllNotificationsRead()`. `runAction`을 쓰고 항상 `WHERE id=? AND user_id=<세션 사용자>` 조건을 건다(IDOR 방지). 0행이면 조용히 성공한 것으로 처리한다.
- 권한: `PERMISSIONS`에 `notification.self: ['USER','ADMIN']`을 추가한다.
- 알림 조회와 읽음 처리는 감사 로그에 남기지 않는다. 알림 생성은 원 행위의 감사 로그가 이미 남는다.
- 점검 모드(503)와 일시적 오류일 때 폴링은 에러 UI를 띄우지 않는다. 드롭다운을 연 상태일 때만 에러를 표시한다.

### 전달 방식 — 폴링 (실시간 인프라 없음)
- 마운트할 때 1회, 탭이 visible이면 **60초** 간격, `focus`·`visibilitychange`가 visible로 바뀔 때와 드롭다운을 열 때 즉시 조회한다. 탭이 hidden이면 interval을 멈춘다. 선례는 `useChatStatus.ts`다.
- 배지는 SSR하지 않는다. 클라이언트 fetch로만 그려서 하이드레이션 위험을 없애고 layout에 DB 호출을 늘리지 않는다.
- CSP(`connect-src 'self'`)와 env는 바꾸지 않는다. SSE·WebSocket·LISTEN/NOTIFY는 쓰지 않는다(`neon-compat.test.ts`가 LISTEN을 금지한다).

### UI — `NotificationBell` (client, `Header.tsx:41` 교체)
- 위치는 기존 종 자리(챗봇 버튼과 사용자 영역 사이)다.
- 접근성 이름
  - 안 읽은 알림이 없으면 "알림"
  - N개면 "알림 N개 안 읽음"
  - 99개를 넘으면 "알림 99개 이상 안 읽음"
  - `aria-haspopup="dialog"`, `aria-expanded`
- 배지: 0이면 렌더하지 않고, 99를 넘으면 "99+"로 표시한다. 숫자는 `aria-hidden`이고 색은 중요 배지 계열이다.
- 드롭다운: 버튼에 고정하고 `role="dialog"`, `aria-label="알림"`.
  - 데스크톱: 폭 360px, 최대 높이 min(480px, 70vh), 내부 스크롤.
  - 모바일(<768px): 헤더 아래 전체 폭, 좌우 16px 여백. 320px에서도 가로 스크롤이 생기지 않아야 한다.
  - z-index 40(챗 패널 30보다 위, Modal·Drawer 50보다 아래).
- **챗 패널과 동시에 열리지 않는다.** 알림을 열면 챗 패널이 닫히고, 챗 패널을 열면 알림이 닫힌다.
- 항목: 유형 아이콘, 제목(1줄), 본문 요약(1줄, 말줄임), 시각(`formatDateTime`, `YYYY-MM-DD HH:mm`). **상대시간은 쓰지 않는다.** 중요 공지는 `ImportantBadge`를 재사용한다. 텍스트만 렌더한다(`dangerouslySetInnerHTML` 금지).
- 안 읽은 항목: 점 + semibold + 옅은 배경으로 표시한다(색만으로 구분하지 않는다). sr-only로 "안 읽음"을 붙인다.
- 동작
  - 항목을 클릭하면 읽음 처리한 뒤 `href`로 이동하고 드롭다운을 닫는다.
  - 헤더의 "모두 읽음" 버튼은 안 읽은 알림이 0이면 disabled다.
  - 개별 읽음 버튼과 삭제 기능은 두지 않는다.
- 상태
  - 로딩: "불러오는 중…" + `aria-busy`
  - 빈 상태: "새 알림이 없습니다."
  - 에러: "알림을 불러오지 못했습니다." + "다시 시도", `role="alert"`
- 키보드
  - 열면 포커스가 드롭다운의 첫 요소로 간다.
  - Escape를 누르거나 바깥을 클릭하면 닫히고, 포커스는 종 버튼으로 돌아간다(#30 패턴 재사용).
  - Tab으로 드롭다운을 벗어나면 닫힌다. 포커스 트랩은 없다(비모달).
  - Modal이 열려 있으면 Modal의 Escape가 우선한다.
- 모션: 기존 토큰 `fadeUp`/`fade`와 `transition.exit`를 쓴다. reduced-motion에서는 Motion §3.5대로 이동 없이 fade만 한다. 이 드롭다운이 Motion 스펙 §2에서 말한 "드롭다운 신설은 별도 요구사항"에 해당한다.
- 사용자 설정(알림 끄기, 유형별 설정)은 MVP에 넣지 않는다. 후속으로 미룬다.

## 5. 비범위
- 이메일·브라우저 푸시·SSE·WebSocket·cron.
- 전체 알림 페이지(`/notifications`).
- 알림 설정.
- 알림 삭제.
- 상대시간.
- 공지 수정·중요 전환 재알림.
- 예약 게시.
- 후속 이벤트(§2).
- 공지 기능 변경.

## 6. 수용 기준
- [ ] ADMIN A가 공지를 게시하면 USER B에게 폴링 주기 안(최대 60초) 또는 새로고침 뒤 배지 "1"이 보이고 버튼 이름이 "알림 1개 안 읽음"이 된다. A에게는 생기지 않는다. 비활성 사용자에게는 행이 만들어지지 않는다.
- [ ] 배포 전 공지로는 알림이 0건이다. 공지를 수정해도 새 알림이 생기지 않는다. 공지를 삭제하면 해당 알림이 목록과 배지에서 사라진다.
- [ ] 가격정책 적용이 성공하면 실행자를 뺀 활성 사용자 전원에게 알림이 생기고, 클릭하면 `/pricing`으로 간다. 본문에 금액이 없다. 적용에 실패하면 알림이 생기지 않는다.
- [ ] B의 역할을 바꾸면 B에게만 알림이 생기고 `/settings`로 이동한다. 역할 외의 필드만 바꾸면 생기지 않는다.
- [ ] 원자성: 공지 insert가 실패하면 알림이 0건이다(PGlite 통합 테스트).
- [ ] IDOR: 다른 사용자의 알림 id로 읽음 처리해도 그 알림은 바뀌지 않는다. API는 본인 알림만 반환한다.
- [ ] `notificationHref`는 내부 경로 3종만 반환한다(단위 테스트). `type → requiredPermission` 표가 단위 테스트로 고정돼 있다.
- [ ] 드롭다운: 항목을 클릭하면 읽음 처리 후 이동하고 배지가 줄어든다. "모두 읽음"을 누르면 배지가 0이 되고 새로고침해도 유지된다. 100개 이상이면 "99+"와 "알림 99개 이상 안 읽음"이 된다. 빈 상태, 에러 상태와 다시 시도가 동작한다.
- [ ] 30일이 지난 알림은 목록과 배지에서 빠진다(시각을 고정해 테스트).
- [ ] 키보드: Enter로 열고 Escape로 닫으면 포커스가 종 버튼으로 돌아간다. 바깥 클릭과 Tab 이탈로 닫힌다. Modal이 열려 있으면 Modal의 Escape가 우선한다.
- [ ] 챗 패널과 알림 드롭다운이 동시에 보이는 순간이 없다.
- [ ] 375px과 320px에서 가로 스크롤이 0이고, 1280px에서는 종 기준 오른쪽 정렬이다. reduced-motion에서 이동이 없다. axe 색 대비를 통과한다.
- [ ] 탭이 hidden이면 폴링 요청이 멈춘다(E2E 또는 단위 테스트에서 fetch 호출 수 확인).
- [ ] 회귀: `shell.test.tsx` 종 버튼 단언이 "알림"으로 갱신됐다(fetch는 mock). `schema.pg.test.ts`, `unit/db/schema.test.ts`, `data-verify.test.ts`, `neon-compat.test.ts`를 통과한다. CSP·env·`vercel.json`의 diff가 0이다.
- [ ] Dev 게이트 기록 + QA E2E 전체 1회 + 머지 head SHA의 `ci:run` 녹색(`docs/pipeline/verification.md`). `drizzle/**`가 바뀌므로 QA가 직접 다시 실행해야 하는 조건에 해당한다.
- [ ] PR-1 본문에 `Part of #31`, PR-2 본문에 `Closes #31`.

## 7. 태스크
1. **[PR-1 BE]**
   - 스키마와 `0008` 마이그레이션
   - `server/notifications/{types,href,audience,queries,mutations}.ts`
   - Route Handler와 서버 액션, 권한 키
   - 이벤트 3곳 훅과 공지 삭제 정리
   - 고정 목록 갱신, PGlite·단위 테스트
2. **[PR-2 FE]**
   - `NotificationBell`, 드롭다운, 폴링 훅
   - 챗 패널 상호 배타, 키보드, 모바일
   - `shell.test` 갱신, E2E `notifications.spec.ts`

의존 관계: 2 → 1. 착수는 #32 다음이다. CI PR-C(PGlite 템플릿)와 #32(`components/ui`) 이후라 간섭이 없다. 텍스트 충돌이 나는 파일은 없다.
