@echo off
REM Uxnan Desktop - generic agent hook wrapper (Windows cmd / batch).
REM
REM Wraps any CLI agent: POSTs `working` to the local hook server before exec,
REM and `done` on exit (with `interrupted: true` if the agent crashed). Use this
REM as the agent's launch command in Settings -> Agents when the agent itself
REM has no hook system.
REM
REM Usage:
REM   uxnan-hook-wrapper.cmd <agent-type> -- <agent-cli> [args...]
REM
REM Environment (set by the ADE when it spawns the terminal):
REM   UXNAN_HOOK_URL    POST endpoint, e.g. http://127.0.0.1:51234/hook
REM   UXNAN_HOOK_TOKEN  Shared secret for the X-Uxnan-Token header
REM   UXNAN_AGENT_ID    Terminal id; echoed back in every report
REM
REM This is the no-PowerShell fallback; PowerShell users should use
REM uxnan-hook-wrapper.ps1 instead (handles arg quoting and exit codes more
REM reliably). If UXNAN_HOOK_URL is empty, the wrapper just runs the agent
REM unchanged.

setlocal EnableDelayedExpansion

if "%~2"=="" goto :usage
set "TYPE=%~1"
shift
if not "%~1"=="--" goto :usage
shift

if "%~1"=="" goto :usage

if defined UXNAN_HOOK_URL (
  curl -fsS --max-time 3 -X POST "%UXNAN_HOOK_URL%" ^
    -H "Content-Type: application/json" ^
    -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" ^
    -d "{\"agentId\":\"%UXNAN_AGENT_ID%\",\"status\":\"working\",\"agentType\":\"%TYPE%\"}" >NUL 2>&1
)

"%~1" %2 %3 %4 %5 %6 %7 %8 %9
set "EC=%ERRORLEVEL%"

if defined UXNAN_HOOK_URL (
  if not "%EC%"=="0" (
    set "INTERRUPTED=true"
  ) else (
    set "INTERRUPTED=false"
  )
  curl -fsS --max-time 3 -X POST "%UXNAN_HOOK_URL%" ^
    -H "Content-Type: application/json" ^
    -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" ^
    -d "{\"agentId\":\"%UXNAN_AGENT_ID%\",\"status\":\"done\",\"agentType\":\"%TYPE%\",\"interrupted\":!INTERRUPTED!}" >NUL 2>&1
)

endlocal & exit /b %EC%

:usage
echo usage: uxnan-hook-wrapper.cmd ^<agent-type^> -- ^<cli^> [args...] 1>&2
exit /b 64
