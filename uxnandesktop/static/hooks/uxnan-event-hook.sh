#!/bin/sh
# Uxnan Desktop — generic per-event status hook (POSIX).
#
# The same job as the Codex hook, but with the agent kind passed as `$1` instead
# of baked in, so one script serves every CLI whose hook runner executes a
# command and pipes it the raw event JSON. Used by Grok (`~/.grok/hooks/`) and
# Antigravity (`~/.gemini/config/hooks.json`) — both single native binaries (Rust
# and Go) with no Node guarantee, which is why this uses `curl`, not the Node
# relay Claude and Gemini share.
#
# It is deliberately NOT the Codex hook with an argument bolted on: those exact
# bytes are folded into Codex's `trusted_hash`, so they must not move.
#
# Usage (registered in the agent's own hook config):
#   uxnan-event-hook.sh <agent-type>
#
# Fail-open: any problem (missing coordinates, dead server, no curl) exits 0, so
# a broken hook never blocks the agent — and Antigravity runs its hooks
# synchronously inside the execution loop, so this must also stay fast.

TYPE="${1:-agent}"

if [ -n "$UXNAN_ENDPOINT_FILE" ] && [ -r "$UXNAN_ENDPOINT_FILE" ]; then
  . "$UXNAN_ENDPOINT_FILE" 2>/dev/null || :
fi

URL="${UXNAN_HOOK_URL:-}"
TOKEN="${UXNAN_HOOK_TOKEN:-}"
ID="${UXNAN_AGENT_ID:-}"
if [ -z "$URL" ] || [ -z "$ID" ]; then
  exit 0
fi

# The agent id / kind ride in headers so this script never has to build JSON
# (brittle to quote across shells); the raw event is forwarded verbatim as the
# body. `@-` reads it from stdin (keeps large payloads off the command line).
curl -sS -X POST "$URL" \
  --connect-timeout 0.5 --max-time 1.5 \
  -H "Content-Type: application/json" \
  -H "X-Uxnan-Token: $TOKEN" \
  -H "X-Uxnan-Agent-Id: $ID" \
  -H "X-Uxnan-Agent-Type: $TYPE" \
  --data-binary @- >/dev/null 2>&1 || true
exit 0
