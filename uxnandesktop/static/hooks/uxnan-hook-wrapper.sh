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

if [ -n "${UXNAN_ENDPOINT_FILE:-}" ] && [ -r "${UXNAN_ENDPOINT_FILE:-}" ]; then
  . "$UXNAN_ENDPOINT_FILE" 2>/dev/null || true
fi
URL="${UXNAN_HOOK_URL:-}"
TOKEN="${UXNAN_HOOK_TOKEN:-}"
ID="${UXNAN_AGENT_ID:-}"

post() {
  # $1 = status, $2 = interrupted. Fire-and-forget; never block the agent.
  [ -n "$URL" ] || return 0
  curl -fsS --max-time 3 -X POST "$URL" \
    -H "X-Uxnan-Token: $TOKEN" \
    -H "X-Uxnan-Agent-Id: $ID" \
    -H "X-Uxnan-Agent-Type: $TYPE" \
    -H "X-Uxnan-Status: $1" \
    -H "X-Uxnan-Interrupted: $2" \
    >/dev/null 2>&1 || true
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
