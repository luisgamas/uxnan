#!/usr/bin/env bash
# install-service-linux.sh
#
# Configures autostart for the uxnan-bridge daemon on Linux via a systemd user unit.
#
# FOR-DEV: write ~/.config/systemd/user/uxnan-bridge.service and enable it with
# `systemctl --user enable --now uxnan-bridge`. See
# architecture/02a-system-architecture.md §5.8.4. Until then this script only
# prints guidance.
set -euo pipefail

echo "FOR-DEV: uxnan-bridge Linux autostart is not implemented yet."
echo "Planned: install ~/.config/systemd/user/uxnan-bridge.service running 'uxnan-bridge start'."
exit 0
