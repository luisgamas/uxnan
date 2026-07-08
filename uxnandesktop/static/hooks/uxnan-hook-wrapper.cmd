@echo off
REM Uxnan Desktop - generic agent hook wrapper (Windows cmd / batch).
REM
REM Wraps any CLI agent that has no native hook system: reports `working` before
REM it runs and `done` on exit (with `interrupted` when the exit code is
REM non-zero). Register it as the agent's launch command in Settings -> Agents.
REM
REM Usage:
REM   uxnan-hook-wrapper.cmd <agent-type> -- <agent-cli> [args...]
REM
REM The agent id / kind / state ride in HTTP headers, so the wrapper never builds
REM JSON (brittle to quote in batch). The ADE injects UXNAN_HOOK_URL / _TOKEN /
REM UXNAN_AGENT_ID; UXNAN_ENDPOINT_FILE holds the live coordinates after a
REM restart. curl.exe is fully-qualified so a repo-local curl.exe can't hijack it.

setlocal EnableDelayedExpansion

if "%~2"=="" goto :usage
set "TYPE=%~1"
shift
if not "%~1"=="--" goto :usage
shift
if "%~1"=="" goto :usage

if defined UXNAN_ENDPOINT_FILE if exist "%UXNAN_ENDPOINT_FILE%" call "%UXNAN_ENDPOINT_FILE%" 2>nul

if defined UXNAN_HOOK_URL (
  "%SystemRoot%\System32\curl.exe" -fsS --max-time 3 -X POST "%UXNAN_HOOK_URL%" ^
    -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" ^
    -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" ^
    -H "X-Uxnan-Agent-Type: %TYPE%" ^
    -H "X-Uxnan-Status: working" >nul 2>&1
)

"%~1" %2 %3 %4 %5 %6 %7 %8 %9
set "EC=%ERRORLEVEL%"

if defined UXNAN_HOOK_URL (
  if not "%EC%"=="0" ( set "INT=true" ) else ( set "INT=false" )
  "%SystemRoot%\System32\curl.exe" -fsS --max-time 3 -X POST "%UXNAN_HOOK_URL%" ^
    -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" ^
    -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" ^
    -H "X-Uxnan-Agent-Type: %TYPE%" ^
    -H "X-Uxnan-Status: done" ^
    -H "X-Uxnan-Interrupted: !INT!" >nul 2>&1
)

endlocal & exit /b %EC%

:usage
echo usage: uxnan-hook-wrapper.cmd ^<agent-type^> -- ^<cli^> [args...] 1>&2
exit /b 64
