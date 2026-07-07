@echo off
REM Uxnan Desktop - Codex status hook (Windows / cmd).
REM
REM Codex runs this through cmd on Windows. It forwards Codex's raw hook JSON
REM (piped on stdin) to the ADE's local hook server with the system curl.exe.
REM Codex is a Rust binary with no Node guarantee, so this uses curl, not node.
REM Fail-open: any problem exits 0 so a broken hook never blocks Codex.
REM
REM curl.exe is fully-qualified so a repo-local curl.exe on PATH can't hijack the
REM payload. The agent id / kind ride in headers so this never builds JSON; the
REM raw event is the body, read from stdin via --data-binary @-.

setlocal
if defined UXNAN_ENDPOINT_FILE if exist "%UXNAN_ENDPOINT_FILE%" call "%UXNAN_ENDPOINT_FILE%" 2>nul
if "%UXNAN_HOOK_URL%"=="" exit /b 0
if "%UXNAN_AGENT_ID%"=="" exit /b 0

"%SystemRoot%\System32\curl.exe" -sS -X POST "%UXNAN_HOOK_URL%" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" -H "X-Uxnan-Agent-Type: codex" --data-binary @- >nul 2>&1
exit /b 0
