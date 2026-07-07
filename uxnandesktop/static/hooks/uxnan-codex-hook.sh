#!/bin/sh
# Uxnan Desktop — Codex status hook (POSIX).
#
# Codex runs this through its own `/bin/sh` hook runner (so it works regardless
# of the interactive shell the user launched Codex from). It forwards Codex's raw
# hook JSON (piped on stdin) to the ADE's local hook server with `curl`; the
# server extracts the event and maps it to a precise state. Codex is a Rust
# binary with no Node guarantee, so this deliberately uses `curl`, not `node`.
#
# Fail-open: any problem (missing coordinates, dead server, no curl) exits 0 so a
# broken hook never blocks Codex. The ADE injects the coordinates; if they went
# stale across an app restart, the endpoint file has the live ones.

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
  -H "X-Uxnan-Agent-Type: codex" \
  --data-binary @- >/dev/null 2>&1 || true
exit 0
