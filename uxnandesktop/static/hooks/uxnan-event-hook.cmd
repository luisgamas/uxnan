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
REM %2 names the event, for CLIs whose payload does not (Antigravity).
set "EVENT=%~2"
if "%TYPE%"=="" set "TYPE=agent"
if defined UXNAN_ENDPOINT_FILE if exist "%UXNAN_ENDPOINT_FILE%" call "%UXNAN_ENDPOINT_FILE%" 2>nul
REM Nothing to report to (this terminal wasn't spawned by the ADE). Still answer
REM `{}` on the way out: an agent that gates on the hook's stdout must not be
REM blocked just because there is no server to talk to.
if "%UXNAN_HOOK_URL%"=="" (echo {}) & exit /b 0
if "%UXNAN_AGENT_ID%"=="" (echo {}) & exit /b 0

"%SystemRoot%\System32\curl.exe" -sS -X POST "%UXNAN_HOOK_URL%" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Uxnan-Token: %UXNAN_HOOK_TOKEN%" -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" -H "X-Uxnan-Agent-Type: %TYPE%" -H "X-Uxnan-Event: %EVENT%" --data-binary @- >nul 2>&1

REM An empty object: "I observed this, I decide nothing". Several of these CLIs
REM parse the hook's stdout and read an unparseable one as a refusal - Cursor
REM gates tool use on it, so a reporter that printed nothing would BLOCK the
REM agent's file reads and shell commands rather than merely fail to report.
echo {}
exit /b 0
