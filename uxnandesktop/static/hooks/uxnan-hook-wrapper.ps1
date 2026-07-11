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

# Prefer the endpoint file (rewritten every launch) for live coordinates.
if ($env:UXNAN_ENDPOINT_FILE -and (Test-Path -LiteralPath $env:UXNAN_ENDPOINT_FILE)) {
  try {
    foreach ($line in Get-Content -LiteralPath $env:UXNAN_ENDPOINT_FILE) {
      $m = [regex]::Match($line, '^(?:set\s+)?([A-Za-z0-9_]+)=(.*)$')
      if ($m.Success) {
        if ($m.Groups[1].Value -eq 'UXNAN_HOOK_URL') { $url = $m.Groups[2].Value.TrimEnd("`r") }
        if ($m.Groups[1].Value -eq 'UXNAN_HOOK_TOKEN') { $token = $m.Groups[2].Value.TrimEnd("`r") }
      }
    }
  } catch { }
}

function Post-State {
  param([string]$Status, [bool]$Interrupted)
  if (-not $url) { return }
  try {
    Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 3 -Headers @{
      'X-Uxnan-Token'       = $token
      'X-Uxnan-Agent-Id'    = $id
      'X-Uxnan-Agent-Type'  = $Type
      'X-Uxnan-Status'      = $Status
      'X-Uxnan-Interrupted' = ($Interrupted.ToString().ToLower())
    } -ErrorAction Stop | Out-Null
  } catch {
    # Fire-and-forget; never block the agent on a slow hook server.
  }
}

Post-State -Status 'working' -Interrupted $false

$proc = Start-Process -FilePath $Command -ArgumentList $Args -NoNewWindow -PassThru -Wait
$code = $proc.ExitCode

Post-State -Status 'done' -Interrupted ($code -ne 0)
exit $code
