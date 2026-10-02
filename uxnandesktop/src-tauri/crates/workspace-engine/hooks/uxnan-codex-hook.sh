#!/bin/sh
# Uxnan Desktop — Codex status hook (POSIX).
#
# Codex runs this through `/bin/sh`. It forwards Codex's raw hook JSON (piped on
# stdin) to the ADE's local hook server with `curl`. Codex is a Rust binary with
# no Node guarantee, so this uses curl, not node. Fail-open: any problem exits 0
# so a broken hook never blocks Codex.
#
# WHICH SERVER IT REPORTS TO. The terminal's own environment wins, and the
# endpoint file is only the rescue. That order is load-bearing: the file lives at
# one shared path, so a SECOND uxnan window overwrites it with its own
# coordinates and every agent of the first one starts reporting to the second —
# measured, and the reason a second window showed no completion checks. The file
# still matters when the environment is stale (a session that outlived an app
# restart), so it is tried when the first POST fails.
#
# The agent id / kind ride in headers so this script never has to build JSON
# (brittle to quote across shells); the raw event is forwarded verbatim as the
# body, read once so a retry can send it again.

ID="${UXNAN_AGENT_ID:-}"
PAYLOAD=$(cat)

post() {
  # $1 = url, $2 = token. `-f` so an HTTP error is a failed attempt, not a
  # silent success — that is what makes the fallback below trigger.
  printf '%s' "$PAYLOAD" | curl -fsS -X POST "$1" \
    --connect-timeout 0.5 --max-time 1.5 \
    -H "Content-Type: application/json" \
    -H "X-Uxnan-Token: $2" \
    -H "X-Uxnan-Agent-Id: $ID" \
    -H "X-Uxnan-Agent-Type: codex" \
    --data-binary @- >/dev/null 2>&1
}

sent=0
if [ -n "$ID" ] && [ -n "${UXNAN_HOOK_URL:-}" ]; then
  if post "$UXNAN_HOOK_URL" "${UXNAN_HOOK_TOKEN:-}"; then
    sent=1
  fi
fi

if [ "$sent" -eq 0 ] && [ -n "${UXNAN_ENDPOINT_FILE:-}" ] && [ -r "$UXNAN_ENDPOINT_FILE" ]; then
  . "$UXNAN_ENDPOINT_FILE" 2>/dev/null || :
  ID="${UXNAN_AGENT_ID:-$ID}"
  if [ -n "$ID" ] && [ -n "${UXNAN_HOOK_URL:-}" ]; then
    post "$UXNAN_HOOK_URL" "${UXNAN_HOOK_TOKEN:-}" || :
  fi
fi

exit 0
