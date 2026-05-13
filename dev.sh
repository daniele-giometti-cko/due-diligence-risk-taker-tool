#!/usr/bin/env bash
# Kills any process on ports 3000/5000 and starts fresh API + UI instances.
# Ctrl+C stops the log tail but leaves both services running.
# To stop everything: ./dev.sh stop

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_LOG="/tmp/logs-teller-api.log"
UI_LOG="/tmp/logs-teller-ui.log"

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "  Killing PID(s) $pids on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_port() {
  local port=$1 name=$2 max=45 i=0
  while ! lsof -ti tcp:"$port" >/dev/null 2>&1; do
    sleep 1
    ((i++))
    if [[ $i -ge $max ]]; then
      echo "  WARNING: $name did not bind on :$port within ${max}s — check $( [[ $port -eq 5000 ]] && echo $API_LOG || echo $UI_LOG )"
      return 1
    fi
  done
  echo "  $name ready → http://localhost:$port"
}

# ---- stop mode ----
if [[ "${1:-}" == "stop" ]]; then
  echo "Stopping API (:5000) and UI (:3000)..."
  kill_port 5000
  kill_port 3000
  echo "Done."
  exit 0
fi

# ---- start mode ----
echo "==> Stopping existing instances..."
kill_port 5000
kill_port 3000
sleep 0.5

echo ""
echo "==> Starting API (dotnet run)..."
: > "$API_LOG"
(cd "$SCRIPT_DIR/api" && dotnet run >> "$API_LOG" 2>&1) &

echo "==> Starting UI (npm run dev)..."
: > "$UI_LOG"
(cd "$SCRIPT_DIR/ui" && npm run dev >> "$UI_LOG" 2>&1) &

echo ""
echo "==> Waiting for services to be ready..."
wait_for_port 5000 "API" || true
wait_for_port 3000 "UI"  || true

echo ""
echo "Logs: $API_LOG  |  $UI_LOG"
echo "Run './dev.sh stop' to kill both. Ctrl+C stops the tail only."
echo "------------------------------------------------------------"
tail -f "$API_LOG" "$UI_LOG"
