#!/usr/bin/env bash
# install-service-linux.sh
#
# Installs a systemd USER unit so the uxnan-bridge daemon starts at login.
# Requires the global CLI: npm install -g uxnan-bridge
#
# Remove:  systemctl --user disable --now uxnan-bridge.service && \
#          rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/uxnan-bridge.service"
set -euo pipefail

BIN="$(command -v uxnan-bridge || true)"
if [ -z "$BIN" ]; then
  echo "uxnan-bridge not found on PATH. Run: npm install -g uxnan-bridge" >&2
  exit 1
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/uxnan-bridge.service" <<EOF
[Unit]
Description=Uxnan Bridge daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$BIN start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now uxnan-bridge.service
echo "Enabled systemd user unit uxnan-bridge.service."
echo "Tip: 'loginctl enable-linger \$USER' keeps it running after logout."
