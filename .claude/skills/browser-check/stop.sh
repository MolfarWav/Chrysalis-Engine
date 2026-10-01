#!/usr/bin/env bash
# Stop what start.sh started (by PID: never pkill the engine by pattern, it
# also matches the shell that runs this).
WORK="${1:-/tmp/chrysalis-check}"
[ -f "$WORK/env" ] || { echo "no $WORK/env"; exit 0; }
# shellcheck disable=SC1091
source "$WORK/env"
kill "$ENGINE_PID" "$MOCK_PID" 2>/dev/null || true
echo "stopped engine $ENGINE_PID and mock $MOCK_PID"
