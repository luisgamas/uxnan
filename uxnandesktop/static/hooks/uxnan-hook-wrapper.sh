#!/usr/bin/env bash
# Uxnan Desktop — generic agent hook wrapper (Bash).
#
# Wraps any CLI agent: POSTs `working` to the local hook server before exec,
# and `done` on exit (with `interrupted: true` if the agent crashed). Use this
# as the agent's launch command in Settings → Agents when the agent itself has
# no hook system.
#
# Usage:
#   uxnan-hook-wrapper.sh <agent-type> -- <agent-cli> [args...]
#
# Environment (set by the ADE when it spawns the terminal):
#   UXNAN_HOOK_URL    POST endpoint, e.g. http://127.0.0.1:51234/hook
#   UXNAN_HOOK_TOKEN  Shared secret for the X-Uxnan-Token header
#   UXNAN_AGENT_ID    Terminal id; echoed back in every report
#
# If UXNAN_HOOK_URL is empty (terminal not spawned by the ADE), the wrapper
# just exec's the agent unchanged.

set -euo pipefail

TYPE="${1:-agent}"
shift || true
[ "${1:-}" = "--" ] && shift || true
[ "$#" -gt 0 ] || { echo "usage: uxnan-hook-wrapper.sh <agent-type> -- <cli> [args...]" >&2; exit 64; }

URL="${UXNAN_HOOK_URL:-}"
TOKEN="${UXNAN_HOOK_TOKEN:-}"
ID="${UXNAN_AGENT_ID:-}"

post() {
  [ -n "$URL" ] || return 0
  # Fire-and-forget; never block the agent on a slow hook server.
  curl -fsS --max-time 3 \
    -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "X-Uxnan-Token: $TOKEN" \
    -d "$1" >/dev/null 2>&1 || true
}

post "{\"agentId\":\"$ID\",\"status\":\"working\",\"agentType\":\"$TYPE\"}"

cleanup() {
  local code=$?
  local interrupted='false'
  [ "$code" -ne 0 ] && interrupted='true'
  post "{\"agentId\":\"$ID\",\"status\":\"done\",\"agentType\":\"$TYPE\",\"interrupted\":$interrupted}"
}
trap cleanup EXIT

exec "$@"
