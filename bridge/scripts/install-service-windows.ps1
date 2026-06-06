# install-service-windows.ps1
#
# Configures autostart for the uxnan-bridge daemon on Windows via Task Scheduler.
#
# FOR-DEV: implement registration of a logon-triggered scheduled task that runs
# `uxnan-bridge start`. See architecture/02a-system-architecture.md §5.8.4.
# Until then this script only prints guidance.

Write-Host "FOR-DEV: uxnan-bridge Windows autostart is not implemented yet." -ForegroundColor Yellow
Write-Host "Planned: register a Task Scheduler task (logon trigger) running 'uxnan-bridge start'."
exit 0
