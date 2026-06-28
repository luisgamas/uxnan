#!/bin/sh
# uxnan integrated-browser shim (Unix / Git Bash / WSL).
#
# Tools that honor the `$BROWSER` convention invoke this as `uxnan-browser <url>`.
# We forward the URL to the ADE's local browser endpoint so it opens in the in-app
# developer browser, honoring the user's link policy. Best-effort and silent: if
# the ADE isn't reachable (or curl is missing), just exit cleanly so the calling
# tool isn't disrupted.
url="$1"
[ -n "$url" ] || exit 0
if [ -n "$UXNAN_BROWSER_URL" ] && command -v curl >/dev/null 2>&1; then
  curl -s -m 3 -X POST "$UXNAN_BROWSER_URL" \
    -H 'Content-Type: application/json' \
    -H "X-Uxnan-Token: $UXNAN_BROWSER_TOKEN" \
    --data-raw "{\"url\":\"$url\"}" >/dev/null 2>&1 || true
fi
exit 0
