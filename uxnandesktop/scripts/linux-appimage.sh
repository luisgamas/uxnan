#!/usr/bin/env bash
# The Linux AppImage: make Tauri build it right, then prove it came out right.
#
#   linux-appimage.sh prepare           before `tauri build`, on the Linux runner
#   linux-appimage.sh check <AppImage>  after it: inspect the image, then launch it
#
# Why `prepare` exists. Tauri's bundler downloads linuxdeploy's `AppRun` into
# its tool cache (`~/.cache/tauri/AppRun-x86_64`) with mode 0770 and copies it
# into every AppImage, where linuxdeploy renames it `AppRun.wrapped` — the file
# `AppRun` execs to start the app. With no execute bit for "other", the image
# only starts for the user who mounted it: firejail (and the AppImage catalog,
# which tests every entry under firejail) mounts it as root, and the app dies
# with "AppRun.wrapped: Permission denied" before it draws anything. The
# bundler downloads the file only when the cache lacks it, so seeding the cache
# with a 0755 copy fixes the image at its source — before it is signed for the
# updater, so the `.sig` still matches what ships.
#
# Why `check` exists. Everything above is invisible on a normal desktop, where
# the owner of the mount is also the one running it. `check` asserts what the
# catalog asserts — every executable runnable by anyone, no library the
# AppImage excludelist forbids, AppStream metadata present and valid, a C
# library floor no newer than GLIBC_FLOOR — and then launches the image under
# firejail on a virtual display and waits for a window, the way the catalog's
# test does. A regression fails the build instead of a catalog test weeks later.
#
# Kept in step with `.github/workflows/release-desktop.yml` (the Linux leg) and
# `ci-desktop.yml` (the Linux leg of the `bundle` job); see `docs/build.md` →
# *Linux AppImage*.

set -euo pipefail

# The oldest C library the Linux packages promise to run on: Ubuntu 22.04's,
# which is also the release runner's. Raising the runner raises this floor.
GLIBC_FLOOR="2.35"

# The same URL the bundler would fetch it from
# (tauri-bundler `bundle/linux/appimage/linuxdeploy.rs` → `prepare_tools`).
APPRUN_URL="https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64"

# Libraries the AppImage excludelist forbids bundling that linuxdeploy's
# built-in copy of that list does not know yet: `libwayland-client` breaks
# newer Mesa when it is carried along instead of the host's. linuxdeploy reads
# them from LINUXDEPLOY_EXCLUDED_LIBRARIES (`;`-separated patterns), which
# `prepare` hands to the later steps of the job. Only the linuxdeploy that
# @tauri-apps/cli 2.12+ pins reads that variable; the one before ignored it.
EXCLUDED_LIBRARIES="libwayland-client.so.0"

fail() {
  echo "::error::$1"
  exit 1
}

prepare() {
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
  mkdir -p "$cache"
  curl -fsSL --retry 3 -o "$cache/AppRun-x86_64" "$APPRUN_URL"
  chmod 0755 "$cache/AppRun-x86_64"
  echo "seeded $cache/AppRun-x86_64 (0755)"
  [ -n "${GITHUB_ENV:-}" ] || fail "prepare runs in a GitHub Actions job: it hands LINUXDEPLOY_EXCLUDED_LIBRARIES to the build step through GITHUB_ENV"
  echo "LINUXDEPLOY_EXCLUDED_LIBRARIES=$EXCLUDED_LIBRARIES" >> "$GITHUB_ENV"
  echo "linuxdeploy will leave out: $EXCLUDED_LIBRARIES"
}

# The highest GLIBC_x.y symbol version any ELF file under $1 asks for.
glibc_required() {
  find "$1" -type f -print0 \
    | while IFS= read -r -d '' f; do
        [ "$(head -c 4 "$f" 2>/dev/null | od -An -c | tr -d ' ')" = '177ELF' ] || continue
        objdump -T "$f" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' || true
      done \
    | sed 's/GLIBC_//' | sort -uV | tail -n 1
}

check() {
  local image
  image="$(readlink -f "$1")"
  [ -f "$image" ] || fail "no AppImage at $1"
  echo "checking $image"
  chmod +x "$image"

  local work
  work="$(mktemp -d)"
  (cd "$work" && "$image" --appimage-extract > /dev/null)
  local appdir="$work/squashfs-root"

  echo "--- executables runnable by anyone"
  local locked
  locked="$(find "$appdir" -type f -perm -u+x ! -perm -o+x -printf '%m %P\n')"
  [ -z "$locked" ] || fail "files executable by their owner only (an AppImage mounted by another user cannot run them): $locked"
  [ -x "$appdir/AppRun.wrapped" ] || fail "AppRun.wrapped is missing or not executable"
  stat -c '%A %n' "$appdir/AppRun" "$appdir/AppRun.wrapped"

  echo "--- no excluded library bundled"
  local pattern patterns
  IFS=';' read -ra patterns <<< "$EXCLUDED_LIBRARIES"
  for pattern in "${patterns[@]}"; do
    [ -z "$(find "$appdir" -name "$pattern")" ] || fail "bundles $pattern, which the AppImage excludelist forbids"
  done
  echo "none of: $EXCLUDED_LIBRARIES"

  echo "--- desktop entry and AppStream metadata"
  local desktop
  desktop="$(find "$appdir" -maxdepth 1 -name '*.desktop' -print -quit)"
  [ -n "$desktop" ] || fail "no desktop file at the AppDir root"
  desktop-file-validate "$desktop"
  grep -qE '^Categories=.+' "$desktop" || fail "the desktop file has no Categories"
  local metainfo
  metainfo="$(find "$appdir/usr/share/metainfo" -name '*.appdata.xml' -print -quit 2>/dev/null || true)"
  [ -n "$metainfo" ] || fail "no usr/share/metainfo/*.appdata.xml"
  appstreamcli validate --no-net "$metainfo"

  echo "--- C library floor"
  local needed
  needed="$(glibc_required "$appdir")"
  echo "requires glibc $needed (floor $GLIBC_FLOOR)"
  [ "$(printf '%s\n%s\n' "$needed" "$GLIBC_FLOOR" | sort -V | tail -n 1)" = "$GLIBC_FLOOR" ] \
    || fail "requires glibc $needed, newer than the $GLIBC_FLOOR floor"

  echo "--- launches under firejail and paints its window, on the catalog's clock"
  # The catalog's own procedure (its code/worker.sh): WebKit's GPU paths off
  # (Xvfb has no GPU; real desktops need neither variable), launch under
  # firejail, look ~10 s later, start a window manager, shoot 2 s after that,
  # and reject a shot that is nearly all one colour as an empty window. Ours
  # must not still be on the splash — or black — at that moment.
  #
  # The catalog's runner has no xdg-desktop-portal; ours does, pulled in by
  # the WebKitGTK build dependencies, and on a runner it hangs: GTK asks the
  # portal for Inhibit at startup and waits out D-Bus's 25 s timeout before
  # the app gets to create its window (measured: 26 s with it, 0.5 s without).
  # Any GTK app does that there, and on a real desktop the portal answers. So
  # in CI the portal goes, and the launch below sees the catalog's machine.
  if [ -n "${GITHUB_ACTIONS:-}" ] && dpkg -s xdg-desktop-portal > /dev/null 2>&1; then
    sudo apt-get remove -y xdg-desktop-portal xdg-desktop-portal-gtk > /dev/null
    echo "removed xdg-desktop-portal, which the catalog's runner does not have"
  fi
  local display=":97"
  Xvfb "$display" -screen 0 1440x900x24 > /dev/null 2>&1 &
  local xvfb=$!
  sleep 2
  DISPLAY="$display" WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    firejail --quiet --noprofile --net=none --appimage "$image" > "$work/app.log" 2>&1 &
  local app=$!
  sleep 10
  # The app's own window, titled with the product name, mapped and full size.
  # Any window will not do: GTK maps a 10x10 helper window named after the
  # binary long before (and even without) the real one.
  local window=""
  for _ in $(seq 1 20); do
    kill -0 "$app" 2>/dev/null || break
    window="$(main_window "$display")"
    [ -n "$window" ] && break
    sleep 1
  done
  local shot="${APPIMAGE_SCREENSHOT:-$work/window.png}" share=""
  if [ -n "$window" ]; then
    DISPLAY="$display" icewm > /dev/null 2>&1 &
    sleep 2
    DISPLAY="$display" import -window "${window%% *}" "$shot"
    share="$(one_colour_share "$shot")"
  fi
  pkill -f -- "$image" 2>/dev/null || true
  kill "$app" 2>/dev/null || true
  pkill -x icewm 2>/dev/null || true
  kill "$xvfb" 2>/dev/null || true
  if [ -z "$window" ]; then
    DISPLAY="$display" xwininfo -tree -root 2>/dev/null | grep -E '0x.*": \(' || true
    cat "$work/app.log"
    fail "the AppImage showed no 'Uxnan Desktop' window under firejail"
  fi
  echo "window: $window, ${share}% one colour"
  if [ "$share" -ge 95 ]; then
    cat "$work/app.log"
    fail "the window is ${share}% one colour ~12 s after launch: the catalog rejects that as an empty window"
  fi
  rm -rf "$work"
  echo "AppImage OK"
}

# Percentage of the image in $1 taken by its most common colour.
one_colour_share() {
  local top w h
  top="$(convert "$1" -alpha off -depth 8 -format '%c' histogram:info:- | sort -rn | head -n 1 | awk '{ print $1 + 0 }')"
  read -r w h < <(identify -format '%w %h' "$1")
  echo $((100 * top / (w * h)))
}

# The id and geometry of a viewable "Uxnan Desktop" window at least 400px wide
# on display $1, or nothing.
main_window() {
  local id geometry
  while read -r id geometry; do
    [ "${geometry%%x*}" -ge 400 ] || continue
    DISPLAY="$1" xwininfo -id "$id" 2>/dev/null | grep -q 'Map State: IsViewable' || continue
    echo "$id $geometry"
    return
  done < <(DISPLAY="$1" xwininfo -tree -root 2>/dev/null \
    | awk '/"Uxnan Desktop": \(/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+x[0-9]+\+/) { print $1, $i; break } }')
}

case "${1:-}" in
  prepare) prepare ;;
  check) [ -n "${2:-}" ] || fail "usage: $0 check <AppImage>"; check "$2" ;;
  *) fail "usage: $0 prepare | check <AppImage>" ;;
esac
