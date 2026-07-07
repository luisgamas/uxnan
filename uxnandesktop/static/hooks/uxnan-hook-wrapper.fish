#!/usr/bin/env fish
# Uxnan Desktop — generic agent hook wrapper (fish).
#
# Wraps any CLI agent that has no native hook system: reports `working` before it
# runs and `done` on exit (with `interrupted` when the exit code is non-zero).
# Mirrors the bash / PowerShell wrappers; fish has its own syntax.
#
# Usage:
#   uxnan-hook-wrapper.fish <agent-type> -- <agent-cli> [args...]
#
# The agent id / kind / state ride in HTTP headers, so the wrapper never builds
# JSON. The ADE injects UXNAN_HOOK_URL / _TOKEN / UXNAN_AGENT_ID.

set TYPE $argv[1]
set -e argv[1]
if test (count $argv) -gt 0; and test $argv[1] = "--"
  set -e argv[1]
end
if test (count $argv) -eq 0
  echo "usage: uxnan-hook-wrapper.fish <agent-type> -- <cli> [args...]" >&2
  exit 64
end

set URL $UXNAN_HOOK_URL
set TOKEN $UXNAN_HOOK_TOKEN
set ID $UXNAN_AGENT_ID

# Prefer the endpoint file (rewritten every launch) — fish can't `source` a POSIX
# env file, so parse KEY=VALUE lines ourselves.
if set -q UXNAN_ENDPOINT_FILE; and test -r "$UXNAN_ENDPOINT_FILE"
  for line in (cat "$UXNAN_ENDPOINT_FILE" 2>/dev/null)
    set clean (string replace -r '^set ' '' -- $line)
    set kv (string split -m1 '=' -- $clean)
    if test (count $kv) -eq 2
      switch $kv[1]
        case UXNAN_HOOK_URL
          set URL (string trim -- $kv[2])
        case UXNAN_HOOK_TOKEN
          set TOKEN (string trim -- $kv[2])
      end
    end
  end
end

function uxnan_post --argument-names status interrupted
  if test -z "$URL"
    return 0
  end
  curl -fsS --max-time 3 -X POST "$URL" \
    -H "X-Uxnan-Token: $TOKEN" \
    -H "X-Uxnan-Agent-Id: $ID" \
    -H "X-Uxnan-Agent-Type: $TYPE" \
    -H "X-Uxnan-Status: $status" \
    -H "X-Uxnan-Interrupted: $interrupted" >/dev/null 2>&1
end

uxnan_post working false

$argv
set -l code $status
if test $code -ne 0
  uxnan_post done true
else
  uxnan_post done false
end
exit $code
