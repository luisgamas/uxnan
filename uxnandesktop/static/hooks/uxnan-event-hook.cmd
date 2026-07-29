@echo off
REM Uxnan Desktop - generic per-event status hook (Windows / cmd).
REM
REM The same job as the Codex hook, but with the agent kind passed as %1 instead
REM of baked in, so one script serves every CLI whose hook runner executes a
REM command and pipes it the raw event JSON. Used by Grok and Antigravity - both
REM single native binaries (Rust and Go) with no Node guarantee, which is why
REM this uses curl rather than the Node relay Claude and Gemini share.
REM
REM It is deliberately NOT the Codex hook with an argument bolted on: those exact
REM bytes are folded into Codex's trusted_hash, so they must not move.
REM
REM curl.exe is fully-qualified so a repo-local curl.exe on PATH can't hijack the
REM payload. Fail-open: any problem exits 0 so a broken hook never blocks the
REM agent - and Antigravity runs its hooks synchronously inside the execution
REM loop, so this must also stay fast.

setlocal
set "TYPE=%~1"
if "%TYPE%"=="" set "TYPE=agent"
if defined UXNAN_ENDPOINT_FILE if exist "%UXNAN_ENDPOINT_FILE%" call "%UXNAN_ENDPOINT_FILE%" 2>nul
if "%UXNAN_HOOK_URL%"=="" exit /b 0
if "%UXNAN_AGENT_ID%"=="" exit /b 0

"%SystemRoot%\System32\curl.exe" -sS -X POST "%UXNAN_HOOK_URL%" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" -H "X-Uxnan-Agent-Type: %TYPE%" --data-binary @- >nul 2>&1
exit /b 0
