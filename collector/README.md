# 조달이 수집기 (collector)

나라장터에서 등록물품·납품요구·입찰공고를 모아 Prami DB 의 `procurement` 스키마에 바로 기록하고,
일일 보고 메일을 보내는 Python 수집기입니다. Prami 화면(조달 관리)은 같은 표를 실시간으로 읽습니다.

- 등록물품: 데이터포털 리포트를 Playwright(Chromium)로 열어 엑셀을 내려받아 분류 → `items`
- 납품요구: 포털 리포트 스크래핑 → `deliveries`
- 입찰공고: 나라장터 입찰공고 목록 조회 → `bid_notices`
- 실행 기록: `job_runs`(running → ok/failed, `summary`), 상태: `app_state`(`daily`·`bids`)

운영 설치(systemd 사용자 타이머·flock·env 파일)와 가동·일상 운영·장애 대응·롤백 절차는 런북 [`docs/ops/collector.md`](../docs/ops/collector.md) 에 있습니다.
운영 파일은 `ops/` (유닛 `ops/systemd/`, 잡 실행기 `ops/run-job.sh`, 설치 `ops/install.sh`, env 예시 `ops/collector.env.example`).

## 환경변수

값은 저장소 밖 env 파일에만 둡니다. 아래는 자리표시자입니다.

| 이름                     | 필수 | 설명                                                                                 |
| ------------------------ | ---- | ------------------------------------------------------------------------------------ |
| `COLLECTOR_DATABASE_URL` | 예   | `postgres://USER:PASSWORD@HOST:5432/DBNAME?options=-csearch_path%3Dprocurement`      |
| `JODAL_REF_DIR`          | 예   | 참조 자료 디렉터리 (분류 CSV·경쟁사 목록 — 기밀, 저장소에 넣지 않고 제자리에서 읽음) |
| `JODAL_CONFIG_DIR`       | 예   | 설정 디렉터리 (`filter.md`·`products.md` — 기밀, 제자리에서 읽음)                    |
| `TZ`                     | 권장 | `Asia/Seoul` (로그·타이머용. 날짜·`last_run` 은 코드가 Asia/Seoul 로 직접 계산)      |
| `JODAL_SMTP_USER`        | 메일 | 발신 계정 (메일 `From`·`To` 에 쓰임)                                                 |
| `JODAL_SMTP_PASSWORD`    | 메일 | 발신 계정 비밀번호 (앱 비밀번호 등)                                                  |
| `JODAL_SMTP_HOST`        | 선택 | 기본 `smtp.gmail.com`                                                                |
| `JODAL_SMTP_PORT`        | 선택 | 기본 `587` (STARTTLS)                                                                |
| `JODAL_DASHBOARD_URL`    | 선택 | 메일 본문의 대시보드 링크                                                            |

- `COLLECTOR_DATABASE_URL` 에 `search_path` 가 없으면 접속할 때 `procurement` 로 붙입니다 (SQL 은 스키마 접두어 없음).
- `daily` 는 시작할 때 `COLLECTOR_DATABASE_URL`·`JODAL_REF_DIR`·`JODAL_CONFIG_DIR` 를 확인하고, 없으면 수집 전에 종료(코드 2)합니다.
  `bids` 는 `COLLECTOR_DATABASE_URL` 만 필요합니다.
- `--filter-file`·`--products-file` 로 설정 파일을 직접 지정할 수 있습니다 (기본은 `JODAL_CONFIG_DIR` 안의 같은 이름 파일).

## 메일 보고

- 수신처는 Prami **조달 관리 → 메일 보고** 탭에서 관리합니다 (`procurement.mail_recipients`). 수집기는 발송 시점에 이 표를 읽습니다.
- 한 통만 보내며 수신자는 모두 **Bcc**, `To` 는 발신 주소, 제목 앞에 `[Prami] ` 가 붙습니다.
- 결과는 `job_runs.summary` 의 `mail`(`sent` · `skipped_no_recipients` · `skipped_no_smtp` · `failed`)과
  `mail_recipient_count` 로 남습니다. 주소·본문은 기록하지 않습니다.
- 수신처 0명이면 `skipped_no_recipients`, SMTP 계정·비밀번호가 비어 있으면 `skipped_no_smtp` — 보내지 않습니다.
- 발송이 실패하면 `failed` 로 남기고 실행도 실패로 끝납니다. 보고 기준일(`daily.last_end_date`)은 발송 뒤에만 저장되므로,
  다음 실행이 빠진 기간(최대 90일)까지 함께 보냅니다.
- `--no-email` 이면 메일을 보내지 않고 `summary` 에 `mail` 값도 남기지 않습니다.

## 명령

```bash
python -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/playwright install chromium     # 운영 체크아웃에서만 (CI·테스트에서는 하지 않음)

jodal daily --skip-if-done   # 어제(D-1) 기준 일일 수집 + 보고 메일. 이미 보고한 기준일이면 아무것도 하지 않음
jodal daily --no-email       # 메일 없이 수집만 (첫 실행·시험용)
jodal daily --date 2026-10-27
jodal bids                   # 최근 14일 입찰공고 (--days N, --since YYYY-MM-DD)
```

작업 파일(내려받은 엑셀)은 실행 디렉터리의 `data/` 아래에 쌓입니다 (`--output-dir` 로 변경).
운영 타이머는 `--output-dir ~/.local/share/prami-collector/exports` 로 실행하며, 30일 지난 파일은 정리 타이머가 지웁니다.

## 테스트

합성 데이터만 씁니다 (실데이터·실주소·네트워크·브라우저 없음). DB 테스트는 **비어 있는 전용 테스트 DB** 에
`drizzle/*.sql` 을 저널 순서로 모두 적용해 돌며, 매번 `procurement`·`public` 스키마를 지우고 다시 만듭니다
(DB 이름에 `test` 가 없으면 거부).

```bash
COLLECTOR_TEST_DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/DBNAME_test .venv/bin/pytest -q
.venv/bin/ruff check . && .venv/bin/ruff format --check .
```

CI(`.github/workflows/ci.yml` 의 `collector` 잡)는 `ci:run` 전체 실행에서 `collector/`·`drizzle/` 가 바뀐 PR 에만 위 두 가지를 돌립니다.
