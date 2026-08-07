# Uxnan Desktop — generic agent hook wrapper (PowerShell / PowerShell 7).
#
# Wraps any CLI agent that has no native hook system: reports `working` before it
# runs and `done` on exit (with `interrupted` when the exit code is non-zero).
# Register it as the agent's launch command in Settings → Agents.
#
# Usage (from PowerShell):
#   uxnan-hook-wrapper.ps1 -Type <agent-type> -Command <cli> [-Args <arg1>, <arg2>, ...]
#
# The agent id / kind / state ride in HTTP headers, so the wrapper never builds
# JSON. The ADE injects $env:UXNAN_HOOK_URL / _TOKEN / UXNAN_AGENT_ID;
# $env:UXNAN_ENDPOINT_FILE holds the live coordinates after an app restart. If
# none are set, the wrapper just runs the agent unchanged.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Type,
  [Parameter(Mandatory = $true)][string]$Command,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args = @()
)

$ErrorActionPreference = 'Continue'

$url = $env:UXNAN_HOOK_URL
$token = $env:UXNAN_HOOK_TOKEN
$id = $env:UXNAN_AGENT_ID

# The terminal's own environment wins; the endpoint file is only the rescue.
# The file lives at ONE shared path, so a second uxnan window overwrites it with
# its own coordinates — reading it first sent the first window's agents to the
# second one. It is kept aside and used when the environment has no coordinates,
# or when the ones it has stop answering (a terminal that outlived a restart).
$fileUrl = $null
$fileToken = $null
if ($env:UXNAN_ENDPOINT_FILE -and (Test-Path -LiteralPath $env:UXNAN_ENDPOINT_FILE)) {
  try {
    foreach ($line in Get-Content -LiteralPath $env:UXNAN_ENDPOINT_FILE) {
      $m = [regex]::Match($line, '^(?:set\s+)?([A-Za-z0-9_]+)=(.*)$')
      if ($m.Success) {
        if ($m.Groups[1].Value -eq 'UXNAN_HOOK_URL') { $fileUrl = $m.Groups[2].Value.TrimEnd("`r") }
        if ($m.Groups[1].Value -eq 'UXNAN_HOOK_TOKEN') { $fileToken = $m.Groups[2].Value.TrimEnd("`r") }
      }
    }
  } catch { }
}
if (-not $url) { $url = $fileUrl; $token = $fileToken; $fileUrl = $null }

function Send-State {
  param([string]$Url, [string]$Token, [string]$Status, [bool]$Interrupted)
  Invoke-RestMethod -Uri $Url -Method Post -TimeoutSec 3 -Headers @{
    'X-Uxnan-Token'       = $Token
    'X-Uxnan-Agent-Id'    = $id
    'X-Uxnan-Agent-Type'  = $Type
    'X-Uxnan-Status'      = $Status
    'X-Uxnan-Interrupted' = ($Interrupted.ToString().ToLower())
  } -ErrorAction Stop | Out-Null
}

function Post-State {
  param([string]$Status, [bool]$Interrupted)
  if (-not $url) { return }
  try {
    Send-State -Url $url -Token $token -Status $Status -Interrupted $Interrupted
  } catch {
    # The environment's server didn't take it — try the live coordinates on
    # disk before giving up. Fire-and-forget either way; never block the agent.
    if ($fileUrl -and $fileUrl -ne $url) {
      try {
        Send-State -Url $fileUrl -Token $fileToken -Status $Status -Interrupted $Interrupted
      } catch { }
    }
  }
}

Post-State -Status 'working' -Interrupted $false

$proc = Start-Process -FilePath $Command -ArgumentList $Args -NoNewWindow -PassThru -Wait
$code = $proc.ExitCode

Post-State -Status 'done' -Interrupted ($code -ne 0)
exit $code
