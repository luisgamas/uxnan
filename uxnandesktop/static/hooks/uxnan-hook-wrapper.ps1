# Uxnan Desktop — generic agent hook wrapper (PowerShell).
#
# Wraps any CLI agent: POSTs `working` to the local hook server before exec,
# and `done` on exit (with `interrupted: true` if the agent crashed). Use this
# as the agent's launch command in Settings → Agents when the agent itself has
# no hook system.
#
# Usage (from PowerShell):
#   uxnan-hook-wrapper.ps1 -Type <agent-type> -Command <cli> [-Args <arg1>, <arg2>, ...]
#
# Environment (set by the ADE when it spawns the terminal):
#   $env:UXNAN_HOOK_URL    POST endpoint, e.g. http://127.0.0.1:51234/hook
#   $env:UXNAN_HOOK_TOKEN  Shared secret for the X-Uxnan-Token header
#   $env:UXNAN_AGENT_ID    Terminal id; echoed back in every report
#
# If $UXNAN_HOOK_URL is empty (terminal not spawned by the ADE), the wrapper
# just runs the agent unchanged.

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

function Post-State {
  param([string]$Status, [bool]$Interrupted)
  if (-not $url) { return }
  $body = @{
    agentId    = $id
    status     = $Status
    agentType  = $Type
    interrupted = $Interrupted
  } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 3 `
      -Headers @{ 'X-Uxnan-Token' = $token; 'Content-Type' = 'application/json' } `
      -Body $body -ErrorAction Stop | Out-Null
  } catch {
    # Fire-and-forget; never block the agent on a slow hook server.
  }
}

Post-State -Status 'working' -Interrupted $false

$proc = Start-Process -FilePath $Command -ArgumentList $Args `
  -NoNewWindow -PassThru -Wait
$code = $proc.ExitCode

Post-State -Status 'done' -Interrupted ($code -ne 0)
exit $code
