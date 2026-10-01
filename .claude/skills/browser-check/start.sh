#!/usr/bin/env bash
# Start a throwaway Chrysalis with a fake model, ready for Playwright.
#   .claude/skills/browser-check/start.sh [WORK] [ENGINE_PORT] [MOCK_PORT]
# WORK defaults to /tmp/chrysalis-check; it is wiped first. Writes $WORK/env
# (source it), copies pw.mjs there and installs playwright-core there once.
set -euo pipefail
SKILL="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SKILL/../../.." && pwd)"
WORK="${1:-/tmp/chrysalis-check}"
PORT="${2:-8796}"
MOCK_PORT="${3:-8797}"
USER_NAME=molfar
PASS=test1234

[ -f "$WORK/env" ] && { "$SKILL/stop.sh" "$WORK" >/dev/null 2>&1 || true; }
rm -rf "$WORK/data" "$WORK/jar" "$WORK"/*.log
mkdir -p "$WORK"

# the client must be built: the engine serves client/dist and client-agent/dist
[ -f "$REPO/client-agent/dist/index.html" ] || (cd "$REPO" && bun run build:client >/dev/null)

MOCK_PORT=$MOCK_PORT bun run "$SKILL/mock-model.ts" > "$WORK/mock.log" 2>&1 < /dev/null &
MOCK_PID=$!
# exec: the subshell becomes the engine, so $! is its PID and no shell holds
# this script's stdout open (a pipe into `tail` would never close)
(cd "$REPO" && exec env DATA_DIR="$WORK/data" CHRYSALIS_PORT=$PORT CHRYSALIS_OPEN_BROWSER=false bun run src/index.ts) > "$WORK/engine.log" 2>&1 < /dev/null &
ENGINE_PID=$!

for _ in $(seq 1 60); do grep -q "setup=" "$WORK/engine.log" 2>/dev/null && break; sleep 1; done
TOKEN=$(grep -o "setup=[A-Za-z0-9_-]*" "$WORK/engine.log" | head -1 | cut -d= -f2)
[ -n "$TOKEN" ] || { echo "engine did not start; see $WORK/engine.log"; exit 1; }

URL="http://127.0.0.1:$PORT"
curl -sf -c "$WORK/jar" -b "$WORK/jar" -H 'content-type: application/json' -X POST "$URL/v1/auth/setup" \
  -d "{\"token\":\"$TOKEN\",\"username\":\"$USER_NAME\",\"password\":\"$PASS\"}" >/dev/null
CONN=$(curl -sf -c "$WORK/jar" -b "$WORK/jar" -H 'content-type: application/json' -H "origin: $URL" -X POST "$URL/v1/settings/connections" \
  -d "{\"name\":\"Mock\",\"api\":\"openai-completions\",\"baseUrl\":\"http://127.0.0.1:$MOCK_PORT/v1\",\"models\":[{\"id\":\"mock-model\",\"contextWindow\":32000}],\"key\":\"sk-mock\"}" \
  | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).connection.id)')
# without this the engine runs the first model it finds (often a provider
# from the environment), not the mock
echo "{\"shown\":[\"$CONN/mock-model\"]}" > "$WORK/data/users/$USER_NAME/models-shown.json"

cp "$SKILL/pw.mjs" "$WORK/pw.mjs"
[ -d "$WORK/node_modules/playwright-core" ] || (cd "$WORK" && bun add playwright-core >/dev/null 2>&1)

cat > "$WORK/env" <<ENV
export ENGINE_URL=$URL
export ENGINE_PID=$ENGINE_PID
export MOCK_PID=$MOCK_PID
export MOCK_URL=http://127.0.0.1:$MOCK_PORT
export MODEL_REF=$CONN/mock-model
export DATA=$WORK/data/users/$USER_NAME
export JAR=$WORK/jar
export WORK=$WORK
ENV
echo "ready: $URL  user $USER_NAME/$PASS  model $CONN/mock-model"
echo "workspace: $WORK/data/users/$USER_NAME   env: source $WORK/env   stop: $SKILL/stop.sh $WORK"
