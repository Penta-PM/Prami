#!/usr/bin/env bash
# 역할 세션 시작 시 한 번 실행: 이 터미널의 수신함 Run 을 만들고(Main 은 공용 Run 에 바인딩)
# .orca-roles/<role>.json 에 {role, run, handle} 을 기록한다. 다른 역할은 이 파일로 주소를 찾는다.
# 사용: scripts/pipeline/register.sh <main|plan|dev|qa>
set -euo pipefail
role="${1:?role: main|plan|dev|qa}"
root="$(git rev-parse --show-toplevel)"
mkdir -p "$root/.orca-roles"

if [ "$role" = main ]; then
  out="$(orca orchestration run-use --id run_b0f2def7eecf --json)"
else
  label="$(printf '%s' "${role:0:1}" | tr a-z A-Z)${role:1}"
  out="$(orca orchestration run-create --objective "Prami ${label} inbox" --json)"
fi

printf '%s' "$out" | python3 -c '
import json, sys
role, path = sys.argv[1], sys.argv[2]
run = json.load(sys.stdin)["result"]["run"]
rec = {"role": role, "run": run["id"], "handle": run["coordinator_handle"]}
json.dump(rec, open(path, "w"))
print(json.dumps(rec))
' "$role" "$root/.orca-roles/$role.json"
