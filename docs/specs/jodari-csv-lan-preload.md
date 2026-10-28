# 조달이 원본 CSV → LAN DB 선이관

- 요청: Main msg_1d2d0b6d9548 (2026-10-28). 사용자 승인으로 D-7 변경 — LAN DB 에 실데이터 선이관 허용. 운영 배포·Google 로그인·수집기(단계 0)는 계속 보류.
- 모드: QA 생략(Dev 게이트 + 머지 head `ci:run` 녹색). LAN 적재는 운영 작업(코드 PR 아님) + 작은 코드 PR 1개.
- 검토: UI/UX·기능/기술 병렬 검토. 상충 없음(기능 검토가 놓친 app_state 키 형식 불일치를 Plan 이 코드로 확인해 보완).

## 1. 보안 규칙 (변경 없음)
- 원본 `/home/plan1/Desktop/Prami/jodari/db/data/*.csv` 는 **제자리에서 읽기만**. 복사·심링크 금지, 절대경로로 지정.
- CSV·덤프·행 내용은 repo·커밋·PR·이슈·CI 산출물·픽스처·로그·보고에 넣지 않음. 보고는 **건수·기간만**. `data:verify --show-amounts` 사용 금지.
- 적재 **후** 의 DB 백업은 만들지 않음(실데이터가 백업 파일에 들어가므로). 적재 **전** 백업만.

## 2. 기술 결정
### 2.1 적재 = #78 스크립트 그대로 (코드 변경 없음)
- `scripts/procurement-import.ts --csv <디렉터리>` 가 CSV 8개를 직접 읽음. 헤더·행 수·타입·제약 집계 검사 결과 호환(칸 수 불일치 0, 비숫자 0, 중복·고아 0).
- 한 트랜잭션. 대상에 행이 있으면 거부, `--replace` = `TRUNCATE … RESTART IDENTITY CASCADE` 후 적재(procurement 밖으로 번지는 FK 없음). 원본 id 보존 + `setval`.
- **재이관(나중 덮어쓰기) = 같은 명령 + `--replace`.** 이것이 "재실행 안전" 의 정의. upsert 는 하지 않음.
- `--replace` 로 LAN 에서 UI 로 만든 procurement 편집(품목 확인·키워드·변경 이력)은 지워짐 — 수용(Main: "덮어써도 됨"). `audit_logs` 의 `procurement.*` 기록은 감사 불변 원칙으로 그대로 둠.

### 2.2 app_state 키 형식 — 조회 쪽을 원본 형식에 맞춤 (코드 PR)
- 원본(수집기가 쓰는 형식): key `bids` → value `{last_checked}`, key `daily` → value `{last_run, last_end_date}`.
- Prami 현재: 평탄한 key `bids.last_checked`, `daily.last_end_date` 를 기대(`src/lib/procurement/constants.ts:32-37`, `src/server/procurement/collection.ts:42-43,100,120-121`). 그대로면 "마지막 확인 시각" 이 '확인 기록 없음', 메일 보고 기준일 null.
- **결정: 조회 쪽을 원본 형식으로 바꿈**(적재 변환 아님). 이유: 단계 0 에서 수집기가 이 표에 직접 쓰므로 원본 형식이 기준. 적재 시 변환하면 수집기 연결 때 다시 깨짐.
  - `PROCUREMENT_STATE_KEYS` = `daily`, `bids` (키) + 필드 `last_end_date`, `last_checked` 를 value 객체에서 읽음.
  - `stateUpdatedAt`(행 updated_at) 사용은 그대로.
  - value 가 객체가 아니거나 필드가 없으면 지금과 같이 null(=기록 없음) — 예외 금지.
  - 평탄 키 하위 호환은 두지 않음(쓰는 곳이 합성 픽스처뿐). 픽스처·단위 테스트는 원본 형식으로 갱신(합성 값).
- 같은 PR 에 `.gitignore` 에 `/jodari/` 추가(현재 `.git/info/exclude` 에만 있어 새 클론에서 보호 안 됨). 데이터 없음.

### 2.3 백업·롤백
- 적재 직전: `docker exec prami-postgres-1 pg_dump -Fc` 로 **prami DB 전체** 백업, 저장소 밖(Dev scratchpad `lan-backup/`), 권한 600. 이 시점 procurement 행은 합성/테스트뿐.
- 롤백: (a) 8개 표 `TRUNCATE … RESTART IDENTITY` (적재 전 비어 있었다면) 또는 (b) `pg_restore --clean --if-exists -n procurement`. 적재가 한 트랜잭션이라 부분 적재는 남지 않음.
- 컨테이너 중지 금지. TRUNCATE 잠금으로 적재 몇 초 동안 :3000 조달 쿼리가 대기할 수 있음 — 수용.

## 3. 판단 기록 (Plan 결정, Main 보고에 공지)
- 데이터가 10-26 에서 멈춤: 진행 중 공고 ≈5건(나머지 마감), 마지막 수집 10-26, 2026-10 월은 부분 집계(급감처럼 보임). **수용, 안내 배너 추가 안 함**(비범위). 보고에 명시.
- 납품 15,857 중 등록 품목과 연결되는 것 ≈967건 → 실적 통계는 연결분만, 나머지는 납품 관리 "미등록". 원본 동작과 같음(통계는 등록 품목 기준). `data:verify` 분포 대조로 적재 오류가 아님을 확인.
- `changed_by`·`created_by` 는 FK 없는 text — 원본 조달이 담당자 문자열(이메일 포함)이 이력·휴지통·키워드 화면에 그대로 보임. 사내 LAN·`procurement.read` 보유자 한정 → 수용, 보고에 공지(Main 이 원하면 가리기 별도 요청).

## 4. 태스크
1. **[OPS] LAN 적재** (Dev, Dev 워크트리에서. `.env.local` 수정 금지, :3000 재시작 금지)
   1. LAN procurement 8개 표 현재 행 수 확인·기록.
   2. `pg_dump` 백업(§2.3), 경로 기록.
   3. `pnpm tsx scripts/procurement-import.ts --csv /home/plan1/Desktop/Prami/jodari/db/data --dry-run` (스크립트 실제 실행 방식에 맞춤).
   4. 실제 적재 — 1 에서 행이 있으면 `--replace`.
   5. `pnpm data:verify --stage procurement --source-csv /home/plan1/Desktop/Prami/jodari/db/data` 전 항목 일치.
2. **[FE/BE] PR: app_state 원본 형식 조회 + `.gitignore /jodari/`** (§2.2). Dev 게이트 + `ci:run` 녹색 → 셀프머지(QA 생략).
3. **[OPS] :3000 화면 확인** (1·2 후). 건수 대조만, 행 내용 기록 금지.

의존: 3 ← 1, 2. (1 과 2 는 독립)

## 5. 수용 기준
- [ ] 적재 전 백업 파일 경로·적재 전 행 수 보고.
- [ ] 8개 표 건수 = items 232 / deliveries 15,857 / bid_notices 108 / bid_keywords 56 / item_changes 34 / delivery_changes 0 / job_runs 25 / app_state 2, `data:verify` 불일치 0.
- [ ] 같은 명령 `--replace` 재실행 후에도 건수·verify 동일(재실행 안전 확인).
- [ ] PR: app_state 가 원본 형식(`bids`/`daily` 객체)일 때 마지막 확인 시각·메일 보고 기준일이 표시됨, value 형식이 어긋나면 null 로 '기록 없음' 표시(단위 테스트, 합성 값). Dev 게이트 + 머지 head `ci:run` 녹색.
- [ ] `.gitignore` 에 `/jodari/` 포함, `git check-ignore jodari/db/data/items.csv` 성공.
- [ ] :3000 확인(건수만): 입찰 공고 108(진행 중 ≈5), 실적 현황 KPI·차트 표시(기간 2025-01 ~ 2026-10), 납품 관리 15,857·미등록 ≈14,890, 품목 등록 191·휴지통 2·신규 검토 카드 53, 키워드 56, 수집 상태 마지막 수집 10-26·실패 없음, 입찰 화면 마지막 확인 시각 표시(PR 후).
- [ ] repo·PR·로그·보고에 행 내용 없음.

## 6. 비범위
- 수집기 연결(단계 0), 운영 배포, Google 로그인, 컷오버.
- 데이터 정지 안내 배너, 원본 담당자 이메일 가리기.
- upsert/증분 이관.

## 7. 진행 기록
