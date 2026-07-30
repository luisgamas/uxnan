# Windows resource collector for the desktop benchmarks.
#
# Deliberately dumb: it samples the process subtree rooted at -RootPid and prints
# one compact JSON line per sample. It makes no judgement about which process is
# "uxnan" beyond parent/child descent from a PID the harness spawned itself —
# all attribution lives in `lib/tree.mjs`, where it can be unit-tested.
#
# It never reads a command line, an environment block or a window title, so a
# sample cannot carry a prompt, a token or a path.
#
# Modes:
#   -RootPid <int>            stream the subtree every -IntervalMs (default 1000)
#   -Pids "12,34" -Once       one snapshot of exactly those PIDs (orphan check)
#   -Name "app.exe" -Once     one snapshot of every process with that name
#   -WindowWatch <int>        block until that PID owns a main window, then exit
#   -Info                     one line of static machine facts, then exit
#
# `-Name` exists only for the pre-flight guard ("is another instance already
# running?"), never for attribution — see the note in `lib/tree.mjs`.
#
# Output (one JSON object per line, stdout):
#   {"t":<unix ms>,"rows":[{"pid":..,"ppid":..,"name":"..","rssKb":..,
#     "privateKb":..,"cpuMs":..,"threads":..,"handles":..,"startedAt":<unix ms>}]}
#
# Uses Windows PowerShell 5.1 cmdlets only (present on every supported Windows),
# so the harness never depends on pwsh being installed.

[CmdletBinding()]
param(
  [int] $RootPid = 0,
  [int] $IntervalMs = 1000,
  [string] $Pids = "",
  [string] $Name = "",
  [int] $WindowWatch = 0,
  [int] $TimeoutMs = 120000,
  [switch] $Once,
  [switch] $Info
)

$ErrorActionPreference = "Stop"
$out = [Console]::Out

function Write-Line([string] $text) {
  $out.WriteLine($text)
  $out.Flush()
}

function Escape-Json([string] $value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", "").Replace("`n", "")
}

if ($Info) {
  # The WebView2 runtime version decides a large share of the memory figure, so a
  # result is not comparable without it. Read from the registry (per-machine
  # first, then per-user); null when absent rather than guessed.
  $webview = $null
  foreach ($key in @(
      "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
      "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
      "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")) {
    try {
      $v = (Get-ItemProperty -Path $key -Name pv -ErrorAction Stop).pv
      if ($v) { $webview = $v; break }
    } catch { }
  }
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption, Version, TotalVisibleMemorySize
  $cpu = @(Get-CimInstance -ClassName Win32_Processor -Property Name, NumberOfLogicalProcessors)[0]
  $power = $null
  try { $power = (powercfg /getactivescheme) -replace '.*\(([^)]*)\).*', '$1' } catch { }
  # Each element is parenthesised on purpose: PowerShell's comma binds tighter
  # than `+`, so `'a:' + $x, 'b:' + $y` would build one concatenation of an
  # array rather than two array elements — and the join would silently produce
  # space-separated garbage instead of JSON.
  $parts = @(
    ('"webview":' + $(if ($webview) { '"' + (Escape-Json $webview) + '"' } else { 'null' })),
    ('"osName":"' + (Escape-Json $os.Caption) + '"'),
    ('"osVersion":"' + (Escape-Json $os.Version) + '"'),
    ('"cpuModel":"' + (Escape-Json $cpu.Name) + '"'),
    ('"cpuCores":' + [int] $cpu.NumberOfLogicalProcessors),
    ('"totalMemMb":' + [int] ($os.TotalVisibleMemorySize / 1024)),
    ('"powerPlan":' + $(if ($power) { '"' + (Escape-Json $power) + '"' } else { 'null' }))
  )
  Write-Line ('{' + ($parts -join ',') + '}')
  exit 0
}

if ($WindowWatch -gt 0) {
  # "Launch to a window the user can see", measured from outside the app: poll
  # until the process owns a main window handle. Nothing is injected into the
  # app to report this, so the measurement can't change what it measures.
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    try {
      $p = Get-Process -Id $WindowWatch -ErrorAction Stop
      if ($p.MainWindowHandle -ne 0) {
        Write-Line ('{"event":"window","elapsedMs":' + [long] $sw.ElapsedMilliseconds + '}')
        exit 0
      }
    } catch {
      Write-Line '{"event":"exited"}'
      exit 1
    }
    Start-Sleep -Milliseconds 50
  }
  Write-Line '{"event":"timeout"}'
  exit 3
}

# Fields kept to the minimum the schema needs — a narrower CIM projection is a
# measurably cheaper query, and the collector's own cost is overhead on the very
# thing being measured.
$fields = @(
  "ProcessId", "ParentProcessId", "Name", "WorkingSetSize", "PrivatePageCount",
  "KernelModeTime", "UserModeTime", "ThreadCount", "HandleCount", "CreationDate"
)

$epoch = [datetime]::new(1970, 1, 1, 0, 0, 0, [System.DateTimeKind]::Utc)

function Get-Snapshot {
  $all = Get-CimInstance -ClassName Win32_Process -Property $fields
  $map = @{}
  foreach ($p in $all) { $map[[int] $p.ProcessId] = $p }
  return $map
}

function Format-Row($p) {
  $started = "null"
  if ($p.CreationDate) {
    $started = [string] [long] ($p.CreationDate.ToUniversalTime() - $epoch).TotalMilliseconds
  }
  # KernelModeTime/UserModeTime are 100-nanosecond units.
  $cpuMs = [long] (([double] $p.KernelModeTime + [double] $p.UserModeTime) / 10000.0)
  return '{"pid":' + [int] $p.ProcessId +
  ',"ppid":' + [int] $p.ParentProcessId +
  ',"name":"' + (Escape-Json $p.Name) + '"' +
  ',"rssKb":' + [long] ([double] $p.WorkingSetSize / 1024.0) +
  ',"privateKb":' + [long] ([double] $p.PrivatePageCount / 1024.0) +
  ',"cpuMs":' + $cpuMs +
  ',"threads":' + [int] $p.ThreadCount +
  ',"handles":' + [int] $p.HandleCount +
  ',"startedAt":' + $started + '}'
}

function Write-Sample([array] $rows) {
  $now = [long] ([datetime]::UtcNow - $epoch).TotalMilliseconds
  Write-Line ('{"t":' + $now + ',"rows":[' + ($rows -join ',') + ']}')
}

if ($Pids) {
  # Snapshot of specific PIDs — used after teardown, when the tree no longer
  # exists and only "is this PID still alive" matters.
  $wanted = @($Pids.Split(",") | ForEach-Object { [int] $_.Trim() } | Where-Object { $_ -gt 0 })
  $map = Get-Snapshot
  $rows = @()
  foreach ($id in $wanted) { if ($map.ContainsKey($id)) { $rows += (Format-Row $map[$id]) } }
  Write-Sample $rows
  exit 0
}

if ($Name) {
  $map = Get-Snapshot
  $rows = @()
  foreach ($p in $map.Values) { if ($p.Name -ieq $Name) { $rows += (Format-Row $p) } }
  Write-Sample $rows
  exit 0
}

if ($RootPid -le 0) {
  [Console]::Error.WriteLine("windows.ps1: -RootPid is required unless -Pids, -Name or -Info is used")
  exit 2
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$next = 0

while ($true) {
  $map = Get-Snapshot

  # Prune to the subtree of $RootPid. Structural only: children of children, no
  # name matching, so a same-named process started elsewhere can never be
  # counted as ours. The visited set also stops a recycled parent PID from
  # forming a cycle.
  $children = @{}
  foreach ($p in $map.Values) {
    $parent = [int] $p.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = New-Object System.Collections.ArrayList }
    [void] $children[$parent].Add([int] $p.ProcessId)
  }

  $rows = New-Object System.Collections.ArrayList
  if ($map.ContainsKey($RootPid)) {
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    $queue = New-Object System.Collections.Queue
    [void] $queue.Enqueue($RootPid)
    [void] $seen.Add($RootPid)
    while ($queue.Count -gt 0) {
      $id = [int] $queue.Dequeue()
      [void] $rows.Add((Format-Row $map[$id]))
      if ($children.ContainsKey($id)) {
        foreach ($child in $children[$id]) {
          if ($seen.Add($child) -and $map.ContainsKey($child)) { [void] $queue.Enqueue($child) }
        }
      }
    }
  }

  Write-Sample $rows.ToArray()
  if ($Once) { break }

  # Absolute cadence: sleeping a fixed interval after a variable-cost query
  # would let the sample spacing drift, and the CPU rate is a per-interval
  # division — drift there is a wrong number, not just a late one.
  $next += $IntervalMs
  $wait = $next - $sw.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait } else { $next = $sw.ElapsedMilliseconds }
}
