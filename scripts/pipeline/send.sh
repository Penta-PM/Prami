#!/usr/bin/env bash
# 역할 간 메일 보내기 + 상대 세션 깨우기(2단계를 한 번에).
# 사용: scripts/pipeline/send.sh <to-role> <type> "<subject>" <body-file>
#   type: dispatch | status | escalation | merge_ready | question
# 본문은 따옴표 깨짐을 막기 위해 파일로 넘긴다.
set -euo pipefail
to="${1:?to-role}"; type="${2:?type}"; subject="${3:?subject}"; body_file="${4:?body-file}"
root="$(git rev-parse --show-toplevel)"
reg="$root/.orca-roles/$to.json"
[ -f "$reg" ] || { echo "등록 안 된 역할: $to ($reg 없음 — 그 세션이 register.sh 를 먼저 실행해야 함)" >&2; exit 1; }
run="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["run"])' "$reg")"
handle="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["handle"])' "$reg")"

orca orchestration send --to "run:$run" --type "$type" --subject "$subject" \
  --body "$(cat "$body_file")" --json | python3 -c 'import json,sys;d=json.load(sys.stdin);print("send", d.get("ok"), d.get("error") or "")'
orca terminal send --terminal "$handle" --enter --json \
  --text "[메일 도착] orca orchestration check --format --json 로 확인하고 역할에 맞게 처리하세요." \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("wake", d.get("ok"), d.get("error") or "")'
