#!/usr/bin/env bash
# install-service-macos.sh
#
# Installs a LaunchAgent so the uxnan-bridge daemon starts at login.
# Requires the global CLI: npm install -g uxnan-bridge
#
# Remove:  launchctl unload ~/Library/LaunchAgents/com.uxnan.bridge.plist && \
#          rm ~/Library/LaunchAgents/com.uxnan.bridge.plist
set -euo pipefail

BIN="$(command -v uxnan-bridge || true)"
if [ -z "$BIN" ]; then
  echo "uxnan-bridge not found on PATH. Run: npm install -g uxnan-bridge" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.uxnan/logs"
PLIST="$HOME/Library/LaunchAgents/com.uxnan.bridge.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.uxnan.bridge</string>
  <key>ProgramArguments</key>
  <array><string>$BIN</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.uxnan/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.uxnan/logs/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Loaded LaunchAgent com.uxnan.bridge (starts at login)."
