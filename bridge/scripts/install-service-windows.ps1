# install-service-windows.ps1
#
# Registers the uxnan-bridge daemon to start at user logon via Task Scheduler.
# Requires the global CLI: npm install -g uxnan-bridge
#
# Usage:    powershell -ExecutionPolicy Bypass -File install-service-windows.ps1
# Remove:   Unregister-ScheduledTask -TaskName 'UxnanBridge' -Confirm:$false

$ErrorActionPreference = 'Stop'

$bin = (Get-Command uxnan-bridge -ErrorAction SilentlyContinue).Source
if (-not $bin) {
  Write-Error "uxnan-bridge not found on PATH. Run: npm install -g uxnan-bridge"
  exit 1
}

$action = New-ScheduledTaskAction -Execute $bin -Argument 'start'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'UxnanBridge' -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Uxnan Bridge daemon' -Force | Out-Null

Write-Host "Registered scheduled task 'UxnanBridge' (starts at logon)."
Write-Host "Start now with: Start-ScheduledTask -TaskName 'UxnanBridge'"
