# 조달이 수집기 운영 런북 (수집기 Prami 이전 스펙 §2.6·§2.7, PR-3)

LAN 호스트에서 조달 수집기(`collector/`, Python)를 systemd **사용자** 타이머로 돌리는 설치·가동·일상 운영·장애 대응·롤백 절차다.
수집기 자체(명령·환경변수·메일 보고 동작)는 [`../../collector/README.md`](../../collector/README.md), Prami 앱 운영은 [`runbook.md`](runbook.md) 를 본다.

> 명령의 `<…>` 는 자리표시자다. 실제 값(DB 주소·비밀번호·SMTP 계정·수신 주소·원본 수집기 경로)은 env 파일에만 두고
> 이 문서·PR·채팅·메일·보고에 쓰지 않는다. 보고에는 **건수·기간·시각·판정**만 적는다(행 내용·주소·비밀값 금지).
>
> 명령은 수집기를 돌리는 LAN 사용자 셸(bash)에서 실행한다. `sudo` 가 필요한 항목(§2)은 직접 하지 않고 Main 에 요청한다.

## 1. 개요·구성

### 1.1 경로

| 항목             | 경로                                                                                            | 비고                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 실행 체크아웃    | `~/prami-collector` (`/home/<사용자>/prami-collector`)                                          | `main` 고정 별도 clone. Dev 워크트리·:3000 체크아웃과 분리. 갱신은 `git pull --ff-only` 수동(§5.5) |
| venv             | `~/prami-collector/collector/.venv`                                                             | gitignore. `jodal` 실행 파일 = `collector/.venv/bin/jodal`                                         |
| env 파일         | `~/.config/prami-collector/collector.env`                                                       | **저장소 밖, 권한 600**(디렉터리 700). 예시 `collector/ops/collector.env.example`                  |
| 작업 데이터·로그 | `~/.local/share/prami-collector/` (700)                                                         | `exports/downloads/`(내려받은 엑셀) · `logs/<잡>-YYYYMMDD.log`(600). **30일 지난 파일 자동 삭제**  |
| 잠금 파일        | `$XDG_RUNTIME_DIR/prami-collector/{daily,bids}.lock`                                            | `/run/user/<uid>` (tmpfs). 없으면 데이터 디렉터리 `locks/`(정리 대상 아님)                         |
| systemd 유닛     | `~/.config/systemd/user/prami-collector-*`                                                      | 원본은 저장소 `collector/ops/systemd/`. `install.sh` 가 복사                                       |
| 참조·설정 자료   | env `JODAL_REF_DIR` = `<원본 수집기>/plan/reference`, `JODAL_CONFIG_DIR` = `<원본 수집기>/plan` | 기밀. 원본 위치에서 **제자리 읽기**, 복사·저장소 반입 금지                                         |

- 엑셀 다운로드 위치: `run-job.sh` 가 `jodal daily` 에 `--output-dir ~/.local/share/prami-collector/exports` 를 넘기고,
  작업 디렉터리도 `~/.local/share/prami-collector` 다(서비스 `WorkingDirectory=` + 스크립트 `cd`). 체크아웃 안 `collector/data/` 에는 쌓이지 않는다.
- DB 는 `prami-postgres-1` 컨테이너를 **호스트 포트로** 접속한다(컨테이너는 건드리지 않는다). 연결 = 기존 LAN DB 계정 + `options=-csearch_path=procurement`.

### 1.2 타이머 (모두 `Asia/Seoul` 명시, `Persistent=true`)

| 타이머                          | 일정 (KST)                          | 실행                         | 비고                                                                                |
| ------------------------------- | ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `prami-collector-daily.timer`   | 평일 09:00 · 09:30 · 10:00 · 10:30  | `jodal daily --skip-if-done` | 09:30~10:30 은 원본 재시도 시각. 그날 보고를 마쳤으면 바로 끝남(`job_runs` 행 없음) |
| `prami-collector-bids.timer`    | 평일 08:30 ~ 18:30 매시 30분 (11회) | `jodal bids`                 | 최근 14일 입찰공고. 화면에서 새 키워드를 넣었으면 올해 1월 1일부터                  |
| `prami-collector-cleanup.timer` | 매일 03:15                          | `find … -mtime +30 -delete`  | 데이터 디렉터리의 30일 지난 파일(엑셀·로그) 삭제, 잠금 파일 제외                    |

- `OnCalendar=` 에 시간대(`Asia/Seoul`)를 직접 적어 호스트 시간대와 무관하다. 서비스와 env 파일에도 `TZ=Asia/Seoul`(로그 시각용 —
  `daily.last_run`·조회일은 코드가 Asia/Seoul 로 직접 계산).
- `Persistent=true`: 호스트가 꺼져 있던 동안 놓친 실행은 켜질 때 **한 번** 한다. 공휴일 처리는 없다(평일 예약 + 빠진 기간 자동 포함, 원본 그대로).
- 확인(설치 PR 에서 `systemd-analyze calendar` 로 검증):
  `Mon..Fri *-*-* 09:00:00 Asia/Seoul` → 다음 평일 09:00 KST(= 00:00 UTC),
  `Mon..Fri *-*-* 08..18:30:00 Asia/Seoul` → 08:30, 09:30 … 18:30 다음은 다음 평일 08:30.

### 1.3 실행 흐름 — 재시도·중복 방지·실패 기록

서비스(`Type=oneshot`)는 `collector/ops/run-job.sh <daily|bids>` 를 부른다.

1. **잡별 flock(비차단)**: `daily`·`bids` 잠금이 서로 다르다. 같은 잡이 이미 돌고 있으면 `다른 <잡> 실행이 진행 중 — 이번 실행은 건너뜀` 한 줄을
   남기고 **0 으로 끝난다**(실패 아님). systemd 도 실행 중인 oneshot 서비스를 다시 시작하지 않는다(두 겹). `--skip-if-done` 은 시작 시점만 보므로 flock 이 필수다.
2. **재시도**: 최대 3회, 60초 간격(원본 `server/run_daily.sh` 와 같음). 종료 코드 2(시작 설정 오류 — env 누락 등)는 재시도하지 않는다.
3. **실패**: 3회 모두 실패하면 서비스가 실패로 끝나고 `OnFailure=` 로 `prami-collector-failure@<유닛>.service` 가 journald 에 한 줄만 남긴다.
   **메일은 보내지 않는다.** 실패 가시화는 Prami 화면 헤더(`최근 수집 실패 · 마지막 성공 …`)가 맡는다.
4. **시간 제한**: daily 4시간, bids 2시간(`TimeoutStartSec`). 넘으면 systemd 가 종료한다 — §6.2 주의.

### 1.4 로그

- journald: `journalctl --user -u prami-collector-daily -u prami-collector-bids` (수집기 출력 + `run-job` 줄).
  실패 기록: `journalctl --user -t prami-collector-failure`. 정리 기록: `journalctl --user -u prami-collector-cleanup`.
- 파일: `~/.local/share/prami-collector/logs/<잡>-YYYYMMDD.log`(600). 같은 내용이며 30일 뒤 지워진다.
- 로그에는 공개 조달 데이터 일부(조회 기간·건수 등)가 찍힌다. **로그를 보고·PR·채팅에 붙이지 않는다** — 건수·기간·판정만 옮긴다.
  `run-job.sh` 는 env 값을 출력하지 않고, 수집기는 메일 주소·본문을 `job_runs` 에 남기지 않는다.

## 2. 사전 준비 — sudo 필요 항목 (Main 에 요청)

Dev 는 아래를 직접 실행하지 않는다. 필요 여부만 확인해 Main 에 명령과 이유를 보낸다.

| 항목                                               | 확인 (sudo 없이)                                                           | Main 에 요청할 명령                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| linger — 로그아웃·재부팅 뒤에도 사용자 타이머 실행 | `loginctl show-user "$USER" -p Linger --value` → `yes` 여야 함             | `sudo loginctl enable-linger <사용자>`                                         |
| Chromium 시스템 라이브러리                         | §3.2 의 브라우저 기동 확인이 `Host system is missing dependencies` 로 실패 | `sudo <체크아웃>/collector/.venv/bin/playwright install-deps chromium`         |
| Python venv 모듈                                   | `python3 -m venv --help` 실패                                              | `sudo apt-get install python3-venv` (Python ≥ 3.12 필요 — `python3 --version`) |

## 3. 설치

### 3.1 실행 체크아웃

```bash
git clone https://github.com/Penta-PM/Prami.git ~/prami-collector
git -C ~/prami-collector switch main
git -C ~/prami-collector log --oneline -1      # 수집기 PR 이 머지된 main 인지 (collector/ops/ 가 있어야 함)
```

- 이 체크아웃에서는 커밋·브랜치 전환을 하지 않는다. 갱신은 §5.5.

### 3.2 venv·Playwright Chromium

```bash
cd ~/prami-collector
python3 -m venv collector/.venv
collector/.venv/bin/pip install -e ./collector
collector/.venv/bin/playwright install chromium        # ~/.cache/ms-playwright 에 받음 (sudo 아님)
# 브라우저 기동 확인 — 실패하면 §2 의 install-deps 를 Main 에 요청
collector/.venv/bin/python -c "from playwright.sync_api import sync_playwright as s; p=s().start(); b=p.chromium.launch(); print('chromium', b.version); b.close(); p.stop()"
```

### 3.3 env 파일 (저장소 밖, 600)

```bash
mkdir -p -m 700 ~/.config/prami-collector
install -m 600 ~/prami-collector/collector/ops/collector.env.example ~/.config/prami-collector/collector.env
${EDITOR:-nano} ~/.config/prami-collector/collector.env
stat -c '%a %U %n' ~/.config/prami-collector/collector.env   # 600 <사용자>
```

| 변수                                                                        | 값                                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `COLLECTOR_DATABASE_URL`                                                    | `postgres://<DB 사용자>:<DB 비밀번호>@<DB 호스트>:5432/<DB 이름>?options=-csearch_path%3Dprocurement` — 기존 LAN DB 계정, 컨테이너 호스트 포트 |
| `JODAL_REF_DIR`                                                             | `<원본 수집기>/plan/reference` (제자리 읽기)                                                                                                   |
| `JODAL_CONFIG_DIR`                                                          | `<원본 수집기>/plan` (`filter.md`·`products.md`, 제자리 읽기)                                                                                  |
| `TZ`                                                                        | `Asia/Seoul`                                                                                                                                   |
| `JODAL_SMTP_HOST`·`JODAL_SMTP_PORT`·`JODAL_SMTP_USER`·`JODAL_SMTP_PASSWORD` | **가동 시점에는 비워 둔다**(Q-C1 — 공용 메일함 계정은 나중에, §4.5)                                                                            |
| `JODAL_DASHBOARD_URL`                                                       | 메일 본문의 대시보드 링크(예: `http://<LAN 호스트>:3000/procurement`)                                                                          |

- 형식은 systemd `EnvironmentFile`: 한 줄에 `KEY=값`, `export` 없음. 값에 공백·`$`·따옴표·역슬래시가 있으면 작은따옴표로 감싼다.
- 값을 확인할 때는 변수 **이름**만 본다: `grep -o '^[A-Z_]*=' ~/.config/prami-collector/collector.env`. `cat` 결과를 채팅·보고에 붙이지 않는다.

### 3.4 유닛 설치 (타이머는 아직 켜지 않는다)

```bash
~/prami-collector/collector/ops/install.sh
```

- 하는 일: 체크아웃(`~/prami-collector`)·venv·env 파일(존재·600·본인 소유·필수 변수 3개·자리표시자 없음) 확인 → 실패하면 아무것도 바꾸지 않고 멈춘다 →
  데이터 디렉터리(700) 생성 → 유닛 7개를 `~/.config/systemd/user/` 에 복사(바뀐 것만) → `systemctl --user daemon-reload` → linger 꺼져 있으면 경고.
- 여러 번 실행해도 결과가 같다. `--enable` 을 줄 때만 타이머를 켠다(§4.4).

## 4. 가동 절차 (LAN, 스펙 §4 항목 4)

순서를 바꾸지 않는다. 각 단계 결과(시각·판정·건수·기간·백업 경로)를 Plan·Main 보고에 남긴다.

### 4.1 ① LAN DB 백업 (`pg_dump -Fc`, 저장소 밖 600)

```bash
stamp=$(date +%Y%m%d-%H%M)
mkdir -p -m 700 ~/prami-backups
( umask 077; docker exec prami-postgres-1 pg_dump -U <DB 사용자> -d <DB 이름> -Fc > ~/prami-backups/prami-lan-$stamp.dump )
chmod 600 ~/prami-backups/prami-lan-$stamp.dump
docker exec -i prami-postgres-1 pg_restore --list < ~/prami-backups/prami-lan-$stamp.dump | head -5   # 목록이 나오면 정상
ls -l ~/prami-backups/prami-lan-$stamp.dump                                                       # 크기·권한(-rw-------)
```

- `docker exec` 는 덤프·조회에만 쓴다. 컨테이너 중지·재시작 금지. 보고에는 백업 **경로·크기**만.
- 비교용 사전 수치(행 수만):
  `docker exec prami-postgres-1 psql -U <DB 사용자> -d <DB 이름> -At -c "select 'items', count(*) from procurement.items union all select 'deliveries', count(*) from procurement.deliveries union all select 'bid_notices', count(*) from procurement.bid_notices"`

### 4.2 ② 첫 실행 — 수동, 메일 없이 (10-26 이후 따라잡기)

타이머와 같은 env 파싱·같은 잠금으로 돌리기 위해 `systemd-run` 으로 실행한다(터미널에 출력이 나오고 끝날 때까지 기다린다).

```bash
run() {
  systemd-run --user --wait --pipe --collect --unit="prami-collector-manual-$1" \
    -p EnvironmentFile="$HOME/.config/prami-collector/collector.env" -p Environment=TZ=Asia/Seoul \
    /usr/bin/bash "$HOME/prami-collector/collector/ops/run-job.sh" "$@"
}
run daily --no-email     # D-1 기준. daily.last_end_date(CSV 선이관 10-26) 다음 날부터 빠진 기간(최대 90일)을 자동 포함
run bids                 # 최근 14일 입찰공고
```

- `--no-email`: 메일을 보내지 않고 `summary.mail` 도 남기지 않는다. 보고 기준일(`daily.last_end_date`)은 저장되므로 다음 평일 09:00 실행은 그다음 기간만 본다.
- 실패하면 `run-job.sh` 가 60초 간격으로 3회까지 다시 한다. 시작 오류(종료 코드 2)는 env 파일을 고친 뒤 다시.
- 멈춰야 하면 다른 터미널에서 `systemctl --user stop prami-collector-manual-daily` — §6.2 의 `running` 행 주의.
- 출력의 `[DB] 조회 기간 … (보고 기간 …)`·`등록물품 N건 중 새 물품 M건`·`납품요구 … 새로 들어온 건`·`[입찰공고] … 관련 공고 N건 · 새로 추가 … · 갱신 …` 에서
  **기간과 건수만** 보고에 옮긴다.

### 4.3 ③ 확인 (읽기 전용 조회)

```bash
q() { docker exec prami-postgres-1 psql -U <DB 사용자> -d <DB 이름> -At -c "$1"; }
q "select id, job, status, started_at, finished_at from procurement.job_runs order by id desc limit 5"
q "select key, value->>'last_end_date', value->>'last_run', value->>'last_checked', updated_at from procurement.app_state where key in ('daily','bids')"
```

- [ ] 방금 실행한 `daily`·`bids` 행이 `ok`(`running`·`failed` 아님)
- [ ] `daily.last_end_date` = 어제(D-1), `daily.last_run` 이 방금 시각(KST, 시간대 없는 형식) · `bids.last_checked` 가 방금 시각
- [ ] 화면: `/procurement` 머리의 마지막 수집 시각, 입찰공고 화면의 마지막 확인 시각이 방금으로 바뀜. 헤더에 `수집 중`·`최근 수집 실패` 없음
- [ ] §4.1 사전 수치와 비교한 증가 건수(items·deliveries·bid_notices) — **건수만** 기록

### 4.4 ④ 타이머 켜기

```bash
~/prami-collector/collector/ops/install.sh --enable
systemctl --user list-timers 'prami-collector-*'
```

- [ ] `prami-collector-daily.timer`·`prami-collector-bids.timer`·`prami-collector-cleanup.timer` 의 NEXT 가 §1.2 일정과 맞음 → **다음 실행 시각을 보고**
- [ ] linger `yes`(§2). 아니면 로그아웃하면 타이머가 멈춘다

### 4.5 메일 켜기 (Q-C1 — 공용 메일함 계정 준비 후)

가동 시점에는 SMTP 값이 비어 있어 평일 09:00 실행마다 `job_runs.summary.mail = skipped_no_smtp`(메일 보고 탭 상태 카드 "메일 설정 없음 — 보내지 않음")가 정상이다.

1. **사용자가 env 파일에 SMTP 값을 직접 입력**한다(`JODAL_SMTP_HOST`·`JODAL_SMTP_PORT`·`JODAL_SMTP_USER`·`JODAL_SMTP_PASSWORD`). 권한 600 유지
   (`stat -c '%a' ~/.config/prami-collector/collector.env`). Dev·Main 은 값을 받거나 보지 않는다.
2. 조달 관리 → **메일 보고** 탭에 수신처가 1명 이상 있는지 확인(0명이면 `skipped_no_recipients` — 보내지 않음).
3. 재시작·재설치는 필요 없다(서비스가 실행할 때마다 env 파일을 읽는다). **다음 평일 09:00 실행**으로 발송을 확인한다:
   메일 보고 탭 상태 카드 **"발송함 n명"**, 또는 `q "select status, summary->>'mail', summary->>'mail_recipient_count' from procurement.job_runs where job='daily' order by id desc limit 1"`.
4. `failed` 면 journald 에서 예외 **종류**만 확인하고(수집기는 주소가 섞일 수 있는 예외 메시지를 남기지 않는다) 사용자에게 계정 설정 재확인을 요청한다.
   보고 기준일은 발송 뒤에만 저장되므로 다음 실행이 빠진 기간까지 함께 보낸다.

- SMTP 값·수신 주소는 메일 본문·로그·`job_runs`·보고·채팅에 쓰지 않는다.

## 5. 일상 운영

### 5.1 상태 보기

```bash
systemctl --user list-timers 'prami-collector-*'                       # 다음·마지막 실행
systemctl --user status prami-collector-daily.service prami-collector-bids.service
journalctl --user -u prami-collector-daily --since today              # 오늘 daily 출력
journalctl --user -u prami-collector-bids -n 50                        # bids 최근 50줄
journalctl --user -t prami-collector-failure --since -7d              # 최근 7일 실패 기록
ls -l ~/.local/share/prami-collector/logs/                             # 파일 로그
```

### 5.2 수동 실행

- 타이머와 같은 동작(옵션 그대로): `systemctl --user start prami-collector-bids.service` (끝날 때까지 기다림, `--no-block` 이면 바로 돌아옴)
  · `systemctl --user start prami-collector-daily.service` (`--skip-if-done` — 그날 보고를 마쳤으면 바로 끝).
- 옵션을 바꿔 실행(예: 메일 없이, 날짜 지정): §4.2 의 `run` 함수 — `run daily --no-email`, `run daily --date YYYY-MM-DD`, `run bids --days 30`.
  잠금이 같으므로 타이머 실행과 겹치면 나중 것이 건너뛴다.

### 5.3 일시 정지·재개

```bash
systemctl --user disable --now prami-collector-daily.timer prami-collector-bids.timer   # 정지 (재부팅해도 꺼진 채)
systemctl --user enable --now prami-collector-daily.timer prami-collector-bids.timer    # 재개 (또는 install.sh --enable)
```

- `stop` 만 하면 재부팅·재로그인 때 다시 켜진다 — 정지는 `disable --now`.
- 재개하면 `Persistent=true` 때문에 정지 동안 놓친 실행이 바로 한 번 돌 수 있다(daily 는 `--skip-if-done`, 빠진 기간 자동 포함).
- 이미 돌고 있는 서비스는 타이머를 꺼도 끝까지 돈다. 강제로 멈추는 것은 §6.2 주의 후에만.

### 5.4 데이터 정리

- `prami-collector-cleanup.timer` 가 매일 03:15 에 30일 지난 파일을 지운다. 즉시 실행: `systemctl --user start prami-collector-cleanup.service`.
- 지운 파일 이름은 `journalctl --user -u prami-collector-cleanup` 에 남는다(이름에는 날짜만 있다).

### 5.5 코드 갱신 (main 머지 후)

실행 중이 아닐 때(평일 18:30 이후 또는 08:30 이전, 또는 §5.3 정지 후) 한다. venv 가 editable 설치라 pull 즉시 다음 실행에 반영된다.

```bash
systemctl --user is-active prami-collector-daily.service prami-collector-bids.service   # 둘 다 inactive 여야 함
cd ~/prami-collector
git pull --ff-only                                    # 실패하면 체크아웃이 main 이 아니거나 로컬 변경이 있는 것 — 고치지 말고 보고
collector/.venv/bin/pip install -e ./collector        # 의존성 변경 반영
collector/.venv/bin/playwright install chromium       # playwright 버전이 바뀌었을 때 (이미 있으면 바로 끝남)
collector/ops/install.sh                              # 유닛이 바뀌었으면 복사·daemon-reload (켜진 타이머는 그대로)
git log --oneline -1                                  # 보고에 SHA
```

## 6. 장애 대응

### 6.1 화면 헤더 "최근 수집 실패"

1. `journalctl --user -t prami-collector-failure --since -2d` → 실패한 유닛·시각.
2. `journalctl --user -u <그 유닛> --since <시각>` → 마지막 시도의 예외 종류. 흔한 원인:
   - `시작 오류: 환경변수 … 이(가) 없습니다`·`디렉터리가 없습니다` (종료 코드 2, 재시도 없음) → env 파일·원본 수집기 경로 확인
   - DB 접속 실패 → 컨테이너가 떠 있는지 `docker ps --filter name=prami-postgres-1` 로 **보기만**(재시작 금지 — Main 에 보고)
   - Playwright 시간 초과·요소 없음 → 나라장터 화면 구조 변경 가능성. 다음 일정에 다시 돌고, 이틀 이상 이어지면 Plan 에 보고
3. 원인을 고친 뒤 §5.2 로 한 번 수동 실행해 `ok` 를 확인한다. daily 는 빠진 기간을 자동으로 포함하므로 날짜별로 다시 돌릴 필요가 없다.

### 6.2 `running` 으로 남은 `job_runs` 행 (강제 종료 시)

- 서비스를 `systemctl --user stop` 하거나 시간 제한(§1.3)·재부팅으로 수집기가 죽으면 `job_runs` 행이 `running`(종료 시각 없음)으로 남는다
  — 수집기는 정상 예외일 때만 `failed` 로 닫는다. 화면 헤더는 그 잡의 **다음 실행이 새 행을 만들 때까지** `수집 중 (HH:mm 시작)` 을 보인다.
- 기본 대응은 **다음 실행을 기다리는 것**이다(daily 는 다음 평일 09:00 — 급하면 §5.2 수동 실행으로 새 행을 만든다).
- 행을 직접 고치는 것은 DB 쓰기다 — 실행 중이 아님(`systemctl --user is-active …` = inactive, `pgrep -f 'jodal'` 없음)을 확인하고 **Plan·Main 승인 후**
  그 행 하나만 `failed` 로 닫는다: `update procurement.job_runs set status='failed', finished_at=now() where id=<id> and status='running'`.
- 강제 종료가 반복되면(시간 제한 초과) 원인(조회 기간이 너무 김 등)을 Plan 에 보고한다. 시간 제한을 임의로 늘리지 않는다.

## 7. 금지 사항

- **가동 후 LAN 에서 `procurement-import --replace` 금지**(스펙 §2.7) — LAN 수집분과 `app_state`(보고 기준일·확인 시각)를 CSV 시점으로 덮는다.
  꼭 필요하면 Plan·Main 승인 후, 타이머 정지(§5.3) → 백업(§4.1) → 실행 → 첫 실행(§4.2)부터 다시.
- `prami-postgres-1` 컨테이너 중지·재시작·삭제 금지. `docker exec` 는 백업·읽기 조회(§4)에만.
- 실데이터(행 내용)·메일 주소·SMTP 값·DB 주소·원본 수집기 경로를 로그 발췌·보고·PR·채팅·이슈에 쓰지 않는다. 보고는 건수·기간·시각·판정.
- 참조·설정 자료(`plan/reference`·`plan`)를 복사하거나 저장소에 넣지 않는다.
- 실행 체크아웃에서 커밋·브랜치 전환·`git pull` 이외의 갱신(rebase·reset) 금지. Dev 워크트리나 :3000 체크아웃에서 `install.sh` 를 돌리지 않는다(스크립트가 거부한다).
- `sudo` 를 직접 쓰지 않는다(§2 — Main 에 요청).

## 8. 롤백

수집기를 멈추고, 필요하면 수집기가 쓴 `procurement` 스키마를 가동 전 백업으로 되돌린다.

1. **타이머 끄기**: `systemctl --user disable --now prami-collector-daily.timer prami-collector-bids.timer` → `systemctl --user is-active prami-collector-daily.service prami-collector-bids.service` 가
   둘 다 inactive 가 될 때까지 기다린다. 여기까지는 언제든 해도 된다(데이터 변경 없음). 이후 화면은 마지막 수집 시점 데이터를 계속 보인다.
2. **데이터 복원은 Plan·Main 승인 후에만**: 백업 이후 화면에서 한 편집(품목·실적·키워드·수신처)도 함께 되돌아간다.
3. 복원 직전 현재 상태를 한 번 더 백업한다(§4.1 과 같은 명령, 파일 이름만 다르게).
4. `procurement` 스키마만 한 트랜잭션으로 복원(다른 스키마는 그대로 — 스키마 사이 외래키 없음):

   ```bash
   docker exec -i prami-postgres-1 pg_restore -U <DB 사용자> -d <DB 이름> --no-owner --clean --if-exists \
     --schema=procurement --single-transaction < ~/prami-backups/prami-lan-<stamp>.dump
   ```

   실패하면 트랜잭션 전체가 취소된다(부분 복원 없음) — 오류 종류만 보고하고 다시 시도하지 않는다.

5. 확인: §4.1 사전 수치와 행 수가 같고, `app_state` 의 `daily.last_end_date`·`bids.last_checked` 가 백업 시점 값, 화면이 정상.
6. 유닛까지 지우려면: `rm ~/.config/systemd/user/prami-collector-*` → `systemctl --user daemon-reload`. env 파일·데이터 디렉터리·백업은 사용자 확인 후 지운다.
