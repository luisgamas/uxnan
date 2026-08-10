#!/bin/sh
# Uxnan Desktop — generic per-event status hook (POSIX).
#
# The same job as the Codex hook, but with the agent kind passed as `$1` instead
# of baked in, so one script serves every CLI whose hook runner executes a
# command and pipes it the raw event JSON. Used by Grok (`~/.grok/hooks/`),
# Antigravity (`~/.gemini/config/hooks.json`) and every declaratively-wired CLI —
# single native binaries or CLIs with no Node guarantee, which is why this uses
# `curl`, not Claude's Node relay.
#
# It is deliberately NOT the Codex hook with an argument bolted on: those exact
# bytes are folded into Codex's `trusted_hash`, so they must not move.
#
# Usage (registered in the agent's own hook config):
#   uxnan-event-hook.sh <agent-type> [event-name]
#
# WHICH SERVER IT REPORTS TO. The terminal's own environment wins, and the
# endpoint file is only the rescue. That order is load-bearing: the file lives at
# one shared path, so a SECOND uxnan window overwrites it with its own
# coordinates and every agent of the first one starts reporting to the second —
# measured, and the reason a second window showed no completion checks. The file
# still matters when the environment is stale (an agent that outlived an app
# restart), so it is tried when the first POST fails.
#
# Fail-open: any problem (missing coordinates, dead server, no curl) exits 0, so
# a broken hook never blocks the agent — and Antigravity runs its hooks
# synchronously inside the execution loop, so this must also stay fast.

TYPE="${1:-agent}"
# $2 names the event, for CLIs whose payload does not (Antigravity).
EVENT="${2:-}"
ID="${UXNAN_AGENT_ID:-}"

# The raw event, read once so a retry can send it again.
PAYLOAD=$(cat)

post() {
  # $1 = url, $2 = token. `-f` so an HTTP error is a failed attempt, not a
  # silent success — that is what makes the fallback below trigger.
  printf '%s' "$PAYLOAD" | curl -fsS -X POST "$1" \
    --connect-timeout 0.5 --max-time 1.5 \
    -H "Content-Type: application/json" \
    -H "X-Uxnan-Token: $2" \
    -H "X-Uxnan-Agent-Id: $ID" \
    -H "X-Uxnan-Agent-Type: $TYPE" -H "X-Uxnan-Event: $EVENT" \
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

# An empty object: "I observed this, I decide nothing". Several of these CLIs
# parse the hook's stdout and read an unparseable one as a refusal — Cursor gates
# tool use on it, so a reporter that printed nothing would BLOCK the agent's file
# reads and shell commands rather than merely fail to report.
printf '{}'
exit 0
