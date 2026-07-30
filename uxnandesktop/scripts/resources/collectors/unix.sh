#!/usr/bin/env sh
# macOS / Linux resource collector — the POSIX counterpart of `windows.ps1`.
#
# Same contract: prune to the subtree of --root-pid, print one compact JSON line
# per sample, never read a command line or an environment block. Attribution
# stays in `lib/tree.mjs`; this script only walks parent/child edges.
#
# Semantic differences from Windows, which the report surfaces rather than hides:
#   - `rssKb` is resident set size. Shared pages (a webview's) are counted in
#     every process that maps them, so a multi-process tree reads higher here
#     than the Windows working-set figure. Never compare the two directly.
#   - There is no cheap per-process private-memory figure, and no handle count
#     without an `lsof` sweep whose own cost would dwarf what it measures. Both
#     are emitted as `null`, which the schema reads as "unsupported", not zero.
#
# Modes:
#   --root-pid N [--interval-ms N]   stream the subtree
#   --pids 1,2,3 --once              one snapshot of exactly those PIDs
#   --name app --once                one snapshot of every process with that name
#   --info                           one line of static machine facts
#
# `--name` exists only for the pre-flight guard ("is another instance already
# running?"), never for attribution — see the note in `lib/tree.mjs`.

set -eu

ROOT_PID=0
INTERVAL_MS=1000
PIDS=""
NAME=""
ONCE=0
INFO=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root-pid) ROOT_PID="$2"; shift 2 ;;
    --interval-ms) INTERVAL_MS="$2"; shift 2 ;;
    --pids) PIDS="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --once) ONCE=1; shift ;;
    --info) INFO=1; shift ;;
    *) echo "unix.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

now_ms() {
  # `date +%s%3N` is a GNU extension; BSD/macOS `date` has no sub-second format,
  # so fall back to whole seconds rather than emitting a wrong number.
  ms=$(date +%s%3N 2>/dev/null || true)
  case "$ms" in
    *N*|"") echo "$(date +%s)000" ;;
    *) echo "$ms" ;;
  esac
}

if [ "$INFO" -eq 1 ]; then
  os_name=$(uname -s)
  os_version=$(uname -r)
  if [ "$os_name" = "Darwin" ]; then
    cores=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 0)
    total_mb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 ))
    cpu_model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
    # WebKit ships with the OS; its version is the system version.
    webview="\"WebKit (system $(sw_vers -productVersion 2>/dev/null || echo unknown))\""
  else
    cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)
    total_mb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
    cpu_model=$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || echo "unknown")
    wk=$(pkg-config --modversion webkit2gtk-4.1 2>/dev/null || true)
    if [ -n "$wk" ]; then webview="\"WebKitGTK $wk\""; else webview="null"; fi
  fi
  printf '{"webview":%s,"osName":"%s","osVersion":"%s","cpuModel":"%s","cpuCores":%s,"totalMemMb":%s,"powerPlan":null}\n' \
    "$webview" "$os_name" "$os_version" "$cpu_model" "$cores" "$total_mb"
  exit 0
fi

# One `ps` call gives pid, ppid, rss (KiB), cumulative CPU time and the command
# name. `-o comm=` is the executable basename on both platforms.
snapshot() {
  ps -e -o pid=,ppid=,rss=,etime=,time=,comm= 2>/dev/null
}

emit_rows() {
  # stdin: the ps snapshot. $1: comma-separated PID filter, $2: subtree root
  # (used when $1 is empty), $3: executable-name filter for the pre-flight guard.
  filter="$1"
  root="$2"
  namefilter="${3:-}"
  awk -v filter="$filter" -v root="$root" -v namefilter="$namefilter" '
    function cputime_ms(t,   n, parts, ms, secs, mins, hours, days, frac) {
      ms = 0
      if (index(t, ".") > 0) { frac = substr(t, index(t, ".") + 1); ms = (frac + 0) * 10; t = substr(t, 1, index(t, ".") - 1) }
      n = split(t, parts, ":")
      secs = parts[n] + 0
      mins = (n >= 2) ? parts[n-1] + 0 : 0
      hours = (n >= 3) ? parts[n-2] + 0 : 0
      days = 0
      if (n >= 3 && index(parts[n-2], "-") > 0) { split(parts[n-2], d, "-"); days = d[1] + 0; hours = d[2] + 0 }
      return ((days * 86400) + (hours * 3600) + (mins * 60) + secs) * 1000 + ms
    }
    function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    {
      pid[NR] = $1; ppid[NR] = $2; rss[NR] = $3; et[NR] = $4; cpu[NR] = $5; name[NR] = $6
      idx[$1] = NR
      kids[$2] = kids[$2] " " $1
      total = NR
    }
    END {
      want_count = 0
      if (namefilter != "") {
        for (r = 1; r <= total; r++) if (name[r] == namefilter) { want[pid[r] + 0] = 1; want_count++ }
      } else if (filter != "") {
        split(filter, f, ",")
        for (i in f) { want[f[i] + 0] = 1; want_count++ }
      } else {
        # Breadth-first descent from the root; the seen[] guard cuts a cycle a
        # recycled parent PID could forge.
        queue[1] = root + 0; head = 1; tail = 1; seen[root + 0] = 1
        while (head <= tail) {
          cur = queue[head]; head++
          if (idx[cur] == "") continue
          want[cur] = 1; want_count++
          n = split(kids[cur], ks, " ")
          for (i = 1; i <= n; i++) {
            c = ks[i] + 0
            if (c > 0 && !(c in seen)) { seen[c] = 1; tail++; queue[tail] = c }
          }
        }
      }
      out = ""; first = 1
      for (r = 1; r <= total; r++) {
        if (!(pid[r] + 0 in want)) continue
        if (!first) out = out ","
        first = 0
        out = out "{\"pid\":" pid[r] ",\"ppid\":" ppid[r] ",\"name\":\"" esc(name[r]) "\"" \
              ",\"rssKb\":" rss[r] ",\"privateKb\":null,\"cpuMs\":" cputime_ms(cpu[r]) \
              ",\"threads\":null,\"handles\":null,\"startedAt\":null}"
      }
      print out
    }
  '
}

if [ -n "$PIDS" ] || [ -n "$NAME" ]; then
  rows=$(snapshot | emit_rows "$PIDS" 0 "$NAME")
  printf '{"t":%s,"rows":[%s]}\n' "$(now_ms)" "$rows"
  exit 0
fi

if [ "$ROOT_PID" -le 0 ]; then
  echo "unix.sh: --root-pid is required unless --pids, --name or --info is used" >&2
  exit 2
fi

sleep_s=$(awk -v ms="$INTERVAL_MS" 'BEGIN { printf "%.3f", ms / 1000 }')
while :; do
  rows=$(snapshot | emit_rows "" "$ROOT_PID" "")
  printf '{"t":%s,"rows":[%s]}\n' "$(now_ms)" "$rows"
  [ "$ONCE" -eq 1 ] && break
  sleep "$sleep_s"
done
