#!/usr/bin/env bash
# Uxnan Desktop — generic agent hook wrapper (Bash / zsh / WSL / Git Bash).
#
# Wraps any CLI agent that has no native hook system: reports `working` before it
# runs and `done` on exit (with `interrupted` set when the exit code is non-zero
# or you Ctrl-C it). Register it as the agent's launch command in Settings →
# Agents when the agent itself can't report state.
#
# Usage:
#   uxnan-hook-wrapper.sh <agent-type> -- <agent-cli> [args...]
#
# The agent id / kind / state ride in HTTP headers, so the wrapper never builds
# JSON (which is brittle to quote across shells). The ADE injects
# UXNAN_HOOK_URL / _TOKEN / UXNAN_AGENT_ID; UXNAN_ENDPOINT_FILE holds the live
# coordinates if this terminal outlived an app restart. If none are set, the
# wrapper just runs the agent unchanged.

set -euo pipefail

TYPE="${1:-agent}"
shift || true
[ "${1:-}" = "--" ] && shift || true
[ "$#" -gt 0 ] || { echo "usage: uxnan-hook-wrapper.sh <agent-type> -- <cli> [args...]" >&2; exit 64; }

# The terminal's own environment wins; the endpoint file is only the rescue.
# The file lives at ONE shared path, so a second uxnan window overwrites it with
# its own coordinates — reading it first sent the first window's agents to the
# second one. It is sourced in a subshell so it can never overwrite the live
# coordinates, and used only when the environment has none or they stop
# answering (a terminal that outlived an app restart).
URL="${UXNAN_HOOK_URL:-}"
TOKEN="${UXNAN_HOOK_TOKEN:-}"
ID="${UXNAN_AGENT_ID:-}"
FILE_URL=""
FILE_TOKEN=""
if [ -n "${UXNAN_ENDPOINT_FILE:-}" ] && [ -r "${UXNAN_ENDPOINT_FILE:-}" ]; then
  FILE_URL=$(. "$UXNAN_ENDPOINT_FILE" 2>/dev/null; printf '%s' "${UXNAN_HOOK_URL:-}")
  FILE_TOKEN=$(. "$UXNAN_ENDPOINT_FILE" 2>/dev/null; printf '%s' "${UXNAN_HOOK_TOKEN:-}")
fi
if [ -z "$URL" ]; then
  URL="$FILE_URL"
  TOKEN="$FILE_TOKEN"
  FILE_URL=""
fi

send() {
  # $1 = url, $2 = token, $3 = status, $4 = interrupted.
  curl -fsS --max-time 3 -X POST "$1" \
    -H "X-Uxnan-Token: $2" \
    -H "X-Uxnan-Agent-Id: $ID" \
    -H "X-Uxnan-Agent-Type: $TYPE" \
    -H "X-Uxnan-Status: $3" \
    -H "X-Uxnan-Interrupted: $4" \
    >/dev/null 2>&1
}

post() {
  # $1 = status, $2 = interrupted. Fire-and-forget; never block the agent.
  [ -n "$URL" ] || return 0
  if ! send "$URL" "$TOKEN" "$1" "$2"; then
    if [ -n "$FILE_URL" ] && [ "$FILE_URL" != "$URL" ]; then
      send "$FILE_URL" "$FILE_TOKEN" "$1" "$2" || true
    fi
  fi
  return 0
}

post working false
# Report `done` on an interrupt too (exec would drop the report, so we run the
# agent as a child and report after it exits).
trap 'post done true; exit 130' INT TERM
set +e
"$@"
code=$?
set -e
if [ "$code" -ne 0 ]; then post done true; else post done false; fi
exit "$code"
