# 조달이 수집기 Prami 이전 — LAN 자동 수집 + 보고 메일(수신처 관리)

- 요청: Main msg_32014cccb90d (2026-10-28, 본문 재전송분). 사용자: "그거 실시간으로 수집할 수 있도록 수정해줘".
- 모드: QA 생략(Dev 게이트 + 머지 head `ci:run` 녹색 → 셀프머지). LAN DB 변경은 백업 규칙(verification.md §3).
- 검토: UI/UX·기능/기술 병렬. 상충 없음(보완). 사용자 범위 질문 1건(§8 Q-C1, 실발송 전까지 비블로킹).
- 수집기 원본: `/home/plan1/Desktop/Prami/jodari/jodari_deliver_20261028/collector/` (Python ≈4,300줄).

## 1. 원본 수집기 요약 (코드 확인)
- 등록물품: data.g2b 리포트를 Playwright Chromium 으로 열어 엑셀 다운로드(openpyxl). 납품요구: 포털 Playwright 스크래핑. 입찰공고: urllib, 페이지 간 1초. 실패 시 1분 간격 3회 재시도(`server/run_daily.sh`).
- DB: psycopg3 직접 SQL, **스키마 접두어 없음** → `search_path=procurement` 로 연결하면 SQL 무수정. 열·충돌 키 모두 0012 와 호환.
- job_runs(running→ok/failed), app_state `daily {last_end_date,last_run}`·`bids {last_checked}` — Prami 조회 형식과 동일(#87). `last_run` 은 tz 없는 시각 → 실행 환경 `TZ=Asia/Seoul` 필수.
- 빠진 기간: `daily.last_end_date` 기준 자동 포함(최대 90일) → CSV 선이관 상태(10-26)에서 그대로 따라잡음.
- 사람 편집 보호: items 는 신규만 INSERT, 변경은 '기타'+pending 을 제품으로 올리는 UPDATE 뿐. deliveries 는 충돌 시 무시(excluded·편집 보존). bid_notices 는 Prami 편집 화면 없음.
- 메일: 일일 보고 1종(smtplib STARTTLS). 수신자 = `--email-to` → `JODAL_EMAIL_TO` → **코드에 박힌 실제 주소 3개**(`cli.py:66`).
- 공휴일 처리 없음(평일 예약 + 따라잡기) — 원본 그대로.
- 참조 데이터 `plan/reference/*`(분류 CSV·경쟁사 목록)를 상대 경로로 읽음 → **기밀 자료로 취급, 저장소에 넣지 않음**.

## 2. 설계 결정
### 2.1 코드 위치·언어 — Python 그대로 Prami 저장소 `collector/` 로 편입
- 자체 `pyproject.toml`(Python ≥3.12, openpyxl·playwright·psycopg). TS 포팅은 위험이 커서 하지 않음, 별도 패키지는 "Prami 이전" 취지와 맞지 않음.
- 옮기기 전 정리(필수): `cli.py:66` 하드코딩 이메일 **삭제**, `JODAL_EMAIL_TO`/`--email-to` 수신자 경로 제거, Google Sheets 경로(시트 I/O·monthly) 제거 — DB 경로가 쓰는 헬퍼만 남김, GitHub Actions 워크플로·`plan/`·`plan/reference/` 는 옮기지 않음.
- 참조 데이터 경로 = env `JODAL_REF_DIR`(필수, 없으면 시작 시 오류). LAN 값 = 원본 위치(`…/collector/plan/reference`) 제자리 읽기, 복사 금지.
- 편입 전 Dev 가 코드 전체에서 이메일·키·토큰·실데이터 리터럴 재스캔(위치만 보고).

### 2.2 DB 연결
- env `COLLECTOR_DATABASE_URL` = 기존 LAN DB 계정 + `options=-csearch_path=procurement`. 전용 최소권한 역할은 운영 배포 때(비범위).
- 원본 GitHub Actions·Supabase 는 건드리지 않음.

### 2.3 수신처 — 새 표 + 관리 탭
- 마이그레이션 0013(추가형): `procurement.mail_recipients(id bigserial pk, email text not null, created_by text, created_at timestamptz default now())`, `unique(lower(email))`.
- 수집기는 발송 시점에 `select email from mail_recipients` 를 읽음. **0건이면 발송 안 함**(env·기본값 폴백 없음).
- 발송은 원본대로 한 통, 단 수신자는 **Bcc**(수신자끼리 주소 비공개). To 는 발신 주소.
- 제목 앞에 `[Prami]` 를 붙여 원본 Actions 메일과 구분(원본 메일은 원작자 쪽에서 계속 갈 수 있음).

### 2.4 메일 결과 기록
- 원본은 SMTP 미설정·실패가 조용히 넘어감 → `job_runs.summary` 에 `mail: sent | skipped_no_recipients | skipped_no_smtp | failed` + `mail_recipient_count` 기록(주소·본문은 기록하지 않음).
- 보고 기준일(`last_end_date`)은 원본대로 발송 후 저장 — 실패 시 다음 실행이 빠진 기간 포함 메일을 보냄(원본 의도 유지).

### 2.5 이력
- 수집기의 '기타' → 제품 승격 UPDATE 는 같은 트랜잭션에서 `item_changes` 에 `changed_by='system'` 행 기록(원본 시스템 이력 트리거 대체). 신규 INSERT 는 신규 검토 카드에 나오므로 이력 행 없음.

### 2.6 실행 형태 — systemd 사용자 타이머
- 실행 체크아웃 = **main 고정 별도 체크아웃** `/home/plan1/prami-collector`(Dev 워크트리·:3000 과 분리, 갱신은 `git pull --ff-only` 수동).
- venv 는 체크아웃 안 `.venv`(gitignore), `playwright install chromium`.
- 타이머(`TZ=Asia/Seoul`, 평일, `Persistent=true`):
  - daily: 09:00 + 원본 재시도 시각, `--skip-if-done`.
  - bids: 08:30~18:30 매시 30분.
- 중복 실행 방지: 잡별 `flock`(daily·bids 각각). systemd 단일 인스턴스와 병행.
- `OnFailure=` → 실패 기록만(journald). 실패 가시화는 화면(§3.2).
- env 파일 `~/.config/prami-collector/collector.env`(권한 600, 저장소 밖): `COLLECTOR_DATABASE_URL`, `JODAL_REF_DIR`, SMTP 값, `TZ`.
- 작업 데이터(다운로드 엑셀)·로그는 `~/.local/share/prami-collector/` — 30일 지난 파일 삭제(엑셀 포함).
- sudo 가 필요하면(`loginctl enable-linger`, Chromium 시스템 라이브러리) Dev 가 Main 에 요청, 임의 실행 금지.
- 컨테이너(prami-postgres-1)는 건드리지 않고 호스트 포트로 접속.

### 2.7 재이관 정책
- 수집기 가동 후 LAN 에서 `procurement-import --replace` 금지(LAN 수집분·app_state 가 덮임). 필요하면 Plan·Main 승인.

## 3. UI
### 3.1 조달 관리 탭 "메일 보고" (`/admin/procurement?tab=mail`, 관리자 = `procurement.write`)
- 키워드 관리 패턴 재사용(ActionResult, VALIDATION 은 입력칸 아래, CONFLICT 는 "이미 처리됨" + refresh, Prami 확인 모달).
- 상단 상태 카드: 마지막 일일 보고 실행 시각·결과(`job_runs.summary.mail` → "발송함 n명" / "수신처 없음 — 보내지 않음" / "메일 설정 없음 — 보내지 않음" / "발송 실패"), 마지막 보고 기준일.
- 수신처 목록: 주소·추가한 사람·추가 시각, 행마다 삭제(확인 모달). 추가 입력: 앞뒤 공백 제거, 형식 검사, 대소문자 무시 중복 차단, 최대 20개.
- 빈 상태: "수신처가 없어 보고 메일을 보내지 않습니다".
- 추가·삭제는 같은 트랜잭션에서 `audit_logs`(`procurement.mail_recipient.add/remove`) 기록. 이력 UI 는 기존 감사 화면.
- 시험 메일 버튼·수신처별 켜기/끄기·도메인 제한은 비범위.

### 3.2 수집 상태 헤더 (`ProcurementHeader`)
- 기존 `collectedAt` 옆에 상태 문구(텍스트+아이콘, 색만으로 구분 금지):
  - 진행 중: "수집 중 (HH:mm 시작)" — 지연 판정보다 우선
  - 마지막 실행 실패: "최근 수집 실패 · 마지막 성공 …"
- 데이터는 `collection.ts` 가 이미 계산하는 `lastRun` 사용(새 쿼리 없음). 정적 렌더(새로고침 시 반영). "지연" 판정은 비범위.

## 4. 태스크
1. **[BE/FE] PR-1** 0013 `mail_recipients` + "메일 보고" 탭(§3.1) + 헤더 상태(§3.2). 마이그레이션 → LAN 적용 전 백업·보고.
2. **[BE] PR-2** `collector/` 편입(§2.1·2.3·2.4·2.5) + pytest(합성) + CI: 기존 `ci.yml` 에 Python job 추가, 단계 안에서 `collector/**` 변경 시에만 ruff·pytest(워크플로 paths 필터 금지 규칙 유지). CI 에서 라이브 크롤링·Playwright 설치 금지. 의존: PR-1.
3. **[OPS] PR-3** systemd 유닛·타이머·설치 스크립트·런북 `docs/ops/collector.md`(§2.6, 백업→첫 실행 절차). 의존: PR-2.
4. **[OPS] LAN 가동** (Dev): pg_dump 백업 → 체크아웃·venv·env 구성 → **첫 실행 `--no-email`** 로 10-26 이후 따라잡기(건수·기간만 보고) → 화면 확인 → 타이머 활성화. 메일은 Q-C1 답과 SMTP env·수신처 등록 후 다음 평일 09:00 실행으로 확인. 의존: PR-3.

## 5. 수용 기준
공통: 각 PR Dev 게이트 + 머지 head `ci:run` 녹색(QA 생략). 원본 데이터·참조 자료·실제 주소·비밀값은 repo·PR·CI·픽스처·로그·보고에 없음.
- [ ] PR-1: 관리자만 탭 접근(USER 는 403/숨김), 추가 시 형식·중복(대소문자 무시)·20개 제한, 삭제 확인 모달, 추가·삭제마다 audit_logs 1행(같은 트랜잭션), 빈 상태 문구, 상태 카드 4가지 문구 — 단위·E2E
- [ ] PR-1: 헤더가 job_runs 의 running·failed 를 문구로 표시 — 단위
- [ ] PR-1: 0013 LAN 적용 전 백업 경로 보고, 추가형만
- [ ] PR-2: `git grep` 으로 원본 하드코딩 주소·Sheets 경로 부재 확인, `JODAL_REF_DIR` 없으면 시작 오류
- [ ] PR-2 pytest(합성, CI Postgres 에 0012·0013 적용): 신규 items/deliveries 멱등, '기타' 승격 + item_changes 'system' 1행, 수신처 0명 → 미발송 + summary.mail=skipped_no_recipients, SMTP 미설정 → skipped_no_smtp, 수신처 n명 → Bcc n명·제목 `[Prami]`(SMTP 페이크), `--skip-if-done`, app_state 형식이 Prami 조회와 일치
- [ ] PR-3: 타이머 일정(평일 09:00 + 재시도, 08:30~18:30 매시), TZ=Asia/Seoul, 잡별 flock, env 파일 저장소 밖 600, 30일 정리 — 런북에 명시
- [ ] OPS: 첫 실행 후 job_runs ok, `daily.last_end_date`·`bids.last_checked` 갱신, 화면 마지막 수집/확인 시각 갱신, 따라잡은 건수·기간 보고(행 내용 없음), 타이머 다음 실행 시각 보고

## 6. 비범위
운영 배포·Google 로그인·실데이터 운영 컷오버, 전용 최소권한 DB 역할, 즉시 수집 버튼, 시험 메일 버튼, 수신처별 켜기/끄기·도메인 제한, 수집 지연 경고, 공휴일 처리, 원본 Actions·Supabase 변경.

## 7. 리스크
- 나라장터 화면 구조 변경 시 스크래핑 실패 → 헤더 "최근 수집 실패" 로 가시화, 원본 재시도·간격 유지.
- `--skip-if-done` 은 시작 시점만 확인 → flock 필수.
- 원본 Actions 메일과 LAN 메일 중복 수신 가능 → `[Prami]` 제목으로 구분.

## 8. 사용자 확인 (Main 경유)
- **Q-C1 발신 SMTP 계정**: 원본이 쓰던 계정(개인 Gmail 앱 비밀번호)을 LAN env 에 그대로 쓸지, 공용 메일함 계정을 새로 쓸지. 코드·수집은 진행, 메일 실발송만 이 답과 env 설정 후.

## 9. 진행 기록
- 2026-10-28 Dev 질문(msg_14fc43200b66) 결정: `plan/filter.md`·`plan/products.md` 도 기밀 설정 자료로 취급 → env `JODAL_CONFIG_DIR`(필수, 없으면 시작 오류, LAN 값 = 원본 …/collector/plan) 제자리 읽기·복사 금지, `--filter-file`·`--products-file` 인자 유지, `JODAL_REF_DIR` 별도 유지. 재스캔: 실제 주소는 cli.py:66 한 곳뿐, 비밀값 리터럴 없음.
- 2026-10-28 Q-C1 = B(사용자 확인, Main msg_5c328bb39004): 회사 공용 메일함 계정. 준비 전까지 메일 없이 수집만 가동(SMTP env 미설정 → summary.mail=skipped_no_smtp). SMTP 값은 사용자가 env 파일에 직접 입력(메일로 주고받지 않음). Bcc·[Prami] 등 나머지 Plan 판단 수용.
- 2026-10-28 PR-1 #90(79ece0a) 머지(CI 40637788125, QA 생략). LAN 0013 적용(백업 prami-before-0013-20261028-143901.dump, mail_recipients 0행). Dev 해석 수용: 중복·20개 초과는 VALIDATION(입력칸 아래), 상태 카드 = 끝난 최신 daily 기준·실패 시 '(수집 실행 실패)' 병기, 헤더 running 우선·가장 이른 시작 시각. PR-2 에 SIGTERM → job_runs failed 마감 추가(수용). 사용자 조치 대기: `sudo loginctl enable-linger plan1`(Dev → Main 요청).
- 2026-10-28 PR-2 #91(ed02e73) 머지(CI 40639760767, collector job ruff·pytest 23, QA 생략). Dev 해석 수용: 승격 이력 action='edit' 바뀐 칸만, 수신처 0명이면 SMTP 미설정이어도 skipped_no_recipients·두 skip 모두 last_end_date 저장(원본 동일 — 수신처 등록 전 기간은 소급 발송 안 됨), 발송 실패 = mail failed·잡 failed·last_end_date 미저장·오류는 예외 형식만, --no-email 은 mail 미기록(카드 '기록 없음'), KST 코드 계산, SIGTERM→failed·ESLint .venv 무시, 자사명 상수는 판정 로직이라 유지.
- 2026-10-28 **LAN 가동 완료**(Dev msg_bf3420e7d823): #92(79023d8) 머지, 백업 후 첫 실행 daily --no-email·bids ok(새 납품요구 +4, 입찰 +2), 화면 마지막 수집 10-28 15:26, 타이머 활성(bids 16:30~, daily 10-29 09:00, cleanup 03:15). venv 는 ensurepip 없어 uv venv --seed(런북 보완 백로그). 사용자 조치 대기: `sudo loginctl enable-linger plan1`. 확인 요청: 14:47 fixture-admin 수신처 1건의 출처(E2E 가 LAN DB 에 쓴 것인지).
- 2026-10-28 확인(Dev msg_7a14c19e8eec): 14:47 수신처 1건은 일반 브라우저(비 headless)에서 사람이 추가한 것으로 판단, 유지. E2E 는 E2E_DATABASE_URL(prami_e2e*)만 사용해 LAN DB 미접속, 13:00 이후 LAN 쓰기는 로그인 감사 + 수신처 추가 1건뿐. 사용자가 넣은 것이 아니면 Main 통보 시 삭제.
- 2026-10-29 runbook §3.2 uv venv 대안(`uv venv --seed`) 문서화 — PR #108 머지(main a75c6c3, CI 녹색, 문서만). 수집기 백로그 문서 항목 종료. 남은 사용자 조치: `sudo loginctl enable-linger plan1`, 공용 메일함 SMTP 값 입력.
