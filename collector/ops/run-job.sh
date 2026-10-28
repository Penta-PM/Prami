#!/usr/bin/env bash
# Prami 조달 수집기 잡 실행기 — systemd 사용자 서비스(prami-collector-{daily,bids}.service)가 부른다.
#
#   run-job.sh daily [jodal 추가 인자...]   → jodal daily --skip-if-done --output-dir <데이터>/exports [추가 인자]
#   run-job.sh bids  [jodal 추가 인자...]   → jodal bids [추가 인자]
#
# - 잡별 flock(비차단): 같은 잡이 이미 돌고 있으면 로그 한 줄 남기고 0 으로 끝난다 (daily·bids 잠금은 서로 다르다).
# - 재시도: 최대 3회, 60초 간격 (원본 server/run_daily.sh 와 같음). 종료 코드 2(시작 설정 오류)는 재시도하지 않는다.
# - 로그: stdout(→ journald) + <데이터>/logs/<잡>-YYYYMMDD.log (권한 600). 30일 지나면 cleanup 타이머가 지운다.
# - 환경변수(DB 주소·참조 디렉터리·SMTP)는 이 스크립트가 읽지 않는다 — systemd EnvironmentFile= 로 들어온다.
#   이 스크립트는 값을 출력하지 않는다.
#
# 조정용 환경변수(보통 쓰지 않음): PRAMI_COLLECTOR_DATA_DIR, PRAMI_COLLECTOR_TRIES, PRAMI_COLLECTOR_RETRY_SLEEP, JODAL_BIN
set -euo pipefail
umask 077

usage() {
  echo "사용법: $0 <daily|bids> [jodal 추가 인자...]" >&2
  exit 64
}

[[ $# -ge 1 ]] || usage
job="$1"
shift

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
collector_dir="$(cd "$script_dir/.." && pwd)"
jodal="${JODAL_BIN:-$collector_dir/.venv/bin/jodal}"
data_dir="${PRAMI_COLLECTOR_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/prami-collector}"
tries="${PRAMI_COLLECTOR_TRIES:-3}"
retry_sleep="${PRAMI_COLLECTOR_RETRY_SLEEP:-60}"

case "$job" in
  daily) args=(daily --skip-if-done --output-dir "$data_dir/exports") ;;
  bids) args=(bids) ;;
  *) usage ;;
esac
args+=("$@")

mkdir -p "$data_dir/exports" "$data_dir/logs"
chmod 700 "$data_dir"
cd "$data_dir"

log_file="$data_dir/logs/$job-$(date +%Y%m%d).log"
log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %Z') [run-job $job] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$log_file"
}

# 잠금: 사용자 런타임 디렉터리(/run/user/<uid>, tmpfs)가 있으면 그쪽, 없으면 데이터 디렉터리의 locks/
if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${XDG_RUNTIME_DIR}" ]]; then
  lock_dir="$XDG_RUNTIME_DIR/prami-collector"
else
  lock_dir="$data_dir/locks"
fi
mkdir -p "$lock_dir"
exec 9>"$lock_dir/$job.lock"
if ! flock -n 9; then
  log "다른 $job 실행이 진행 중 — 이번 실행은 건너뜀"
  exit 0
fi

if [[ ! -x "$jodal" ]]; then
  log "실행 파일이 없습니다: $jodal (체크아웃에서 python -m venv collector/.venv && pip install -e ./collector)"
  exit 1
fi

export PYTHONUNBUFFERED=1

rc=0
for ((attempt = 1; attempt <= tries; attempt++)); do
  log "시작 (시도 $attempt/$tries): jodal ${args[*]}"
  set +e
  "$jodal" "${args[@]}" 2>&1 | tee -a "$log_file"
  rc="${PIPESTATUS[0]}"
  set -e
  if [[ "$rc" -eq 0 ]]; then
    log "성공 (시도 $attempt/$tries)"
    exit 0
  fi
  if [[ "$rc" -eq 2 ]]; then
    log "시작 설정 오류(종료 코드 2) — env 파일을 확인하세요. 재시도하지 않음"
    exit 2
  fi
  log "실패 (시도 $attempt/$tries, 종료 코드 $rc)"
  if ((attempt < tries)); then
    log "${retry_sleep}초 뒤 다시 시도"
    sleep "$retry_sleep"
  fi
done
log "모든 시도 실패 — 종료 코드 $rc"
exit "$rc"
