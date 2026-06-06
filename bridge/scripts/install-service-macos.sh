#!/usr/bin/env bash
# install-service-macos.sh
#
# Configures autostart for the uxnan-bridge daemon on macOS via a LaunchAgent.
#
# FOR-DEV: write ~/Library/LaunchAgents/com.uxnan.bridge.plist and load it with
# launchctl. See architecture/02a-system-architecture.md §5.8.4.
# Until then this script only prints guidance.
set -euo pipefail

echo "FOR-DEV: uxnan-bridge macOS autostart is not implemented yet."
echo "Planned: install ~/Library/LaunchAgents/com.uxnan.bridge.plist running 'uxnan-bridge start'."
exit 0
