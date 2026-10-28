#!/usr/bin/env bash
# Prami 조달 수집기 — systemd 사용자 유닛 설치 (런북 docs/ops/collector.md §3).
#
#   collector/ops/install.sh            유닛 설치·갱신 + daemon-reload (타이머는 켜지 않는다)
#   collector/ops/install.sh --enable   위 + 타이머 3개(daily·bids·cleanup) 켜기 → 다음 실행 시각 표시
#
# - 사용자 단위만 다룬다 (sudo 를 쓰지 않는다). 여러 번 실행해도 결과가 같다.
# - 실행 체크아웃이 ~/prami-collector 가 아니면, env 파일이 없거나 권한이 600 이 아니면, venv 의 jodal 이 없으면 멈춘다.
# - env 파일 값은 읽어서 출력하지 않는다 (필수 변수 이름이 있는지만 본다).
set -euo pipefail
umask 077

enable=0
for arg in "$@"; do
  case "$arg" in
    --enable) enable=1 ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "알 수 없는 인자: $arg (--enable 만 받습니다)" >&2
      exit 64
      ;;
  esac
done

fail() {
  echo "설치 중단: $*" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checkout="$(cd "$script_dir/../.." && pwd -P)"
expected="$HOME/prami-collector"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/prami-collector"
env_file="$config_dir/collector.env"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/prami-collector"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
units=(
  prami-collector-daily.service
  prami-collector-daily.timer
  prami-collector-bids.service
  prami-collector-bids.timer
  prami-collector-cleanup.service
  prami-collector-cleanup.timer
  prami-collector-failure@.service
)
timers=(prami-collector-daily.timer prami-collector-bids.timer prami-collector-cleanup.timer)

# 1) 실행 체크아웃 — 유닛이 %h/prami-collector 를 가리킨다 (Dev 워크트리·:3000 체크아웃에서 설치하지 않는다)
[[ -d "$expected" ]] || fail "실행 체크아웃 $expected 이 없습니다 (런북 §3.1: main 고정 별도 clone)"
[[ "$checkout" == "$(cd "$expected" && pwd -P)" ]] ||
  fail "이 스크립트는 $expected 체크아웃에서 실행해야 합니다 (지금: $checkout)"
branch="$(git -C "$checkout" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
[[ "$branch" == "main" ]] || echo "주의: 실행 체크아웃 브랜치가 main 이 아닙니다 ($branch)" >&2

# 2) venv
[[ -x "$checkout/collector/.venv/bin/jodal" ]] ||
  fail "collector/.venv/bin/jodal 이 없습니다 (런북 §3.2: python3 -m venv collector/.venv && collector/.venv/bin/pip install -e ./collector)"

# 3) env 파일 — 저장소 밖, 본인 소유, 권한 600, 필수 변수 이름
[[ -f "$env_file" ]] || fail "env 파일 $env_file 이 없습니다 (collector/ops/collector.env.example 을 복사해 채우고 chmod 600)"
[[ "$(stat -c '%a' "$env_file")" == "600" ]] || fail "env 파일 권한이 600 이 아닙니다: chmod 600 $env_file"
[[ "$(stat -c '%u' "$env_file")" == "$(id -u)" ]] || fail "env 파일 소유자가 현재 사용자가 아닙니다"
for name in COLLECTOR_DATABASE_URL JODAL_REF_DIR JODAL_CONFIG_DIR; do
  grep -Eq "^[[:space:]]*${name}=[^[:space:]]" "$env_file" || fail "env 파일에 $name 값이 없습니다"
  ! grep -Eq "^[[:space:]]*${name}=.*<[^>]*>" "$env_file" || fail "env 파일의 $name 에 자리표시자(<…>)가 남아 있습니다"
done
chmod 700 "$config_dir"

# 4) 데이터·로그 디렉터리 (700)
mkdir -p "$data_dir/exports" "$data_dir/logs"
chmod 700 "$data_dir" "$data_dir/exports" "$data_dir/logs"

# 5) 유닛 복사 (바뀐 것만) → daemon-reload
mkdir -p "$unit_dir"
for unit in "${units[@]}"; do
  src="$script_dir/systemd/$unit"
  dst="$unit_dir/$unit"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "그대로: $unit"
  else
    install -m 644 "$src" "$dst"
    echo "설치: $unit"
  fi
done
systemctl --user daemon-reload
echo "daemon-reload 완료"

# 6) linger — 로그아웃·재부팅 뒤에도 사용자 타이머가 돌려면 필요 (sudo 필요 → 직접 하지 않고 안내만)
linger="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo unknown)"
if [[ "$linger" != "yes" ]]; then
  echo "주의: linger 가 꺼져 있습니다($linger). 로그아웃하면 타이머가 멈춥니다 — 'sudo loginctl enable-linger $(id -un)' 을 Main 에 요청하세요 (런북 §2)." >&2
fi

# 7) 타이머 켜기 (--enable 일 때만)
if [[ "$enable" -eq 1 ]]; then
  systemctl --user enable --now "${timers[@]}"
  systemctl --user list-timers --all 'prami-collector-*'
else
  echo "타이머는 켜지 않았습니다. 가동 절차(런북 §4) 확인 뒤: collector/ops/install.sh --enable"
fi
