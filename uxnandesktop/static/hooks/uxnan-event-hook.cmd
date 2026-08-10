@echo off
REM Uxnan Desktop - generic per-event status hook (Windows / cmd).
REM
REM The same job as the Codex hook, but with the agent kind passed as %1 instead
REM of baked in, so one script serves every CLI whose hook runner executes a
REM command and pipes it the raw event JSON. Used by Grok, Antigravity and every
REM declaratively-wired CLI - single native binaries or CLIs with no Node
REM guarantee, which is why this uses curl rather than Claude's Node relay.
REM
REM It is deliberately NOT the Codex hook with an argument bolted on: those exact
REM bytes are folded into Codex's trusted_hash, so they must not move.
REM
REM WHICH SERVER IT REPORTS TO. The terminal's own environment wins, and the
REM endpoint file is only the rescue. That order is load-bearing: the file lives
REM at one shared path, so a SECOND uxnan window overwrites it with its own
REM coordinates and every agent of the first one starts reporting to the second -
REM measured, and the reason a second window showed no completion checks. The
REM file still matters when the environment is stale (an agent that outlived an
REM app restart), so it is tried when the first POST fails.
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

REM The raw event, kept in a temp file so a retry can send it again (stdin is
REM consumed by the first attempt).
set "BODY=%TEMP%\uxnan-hook-%RANDOM%%RANDOM%.json"
more > "%BODY%" 2>nul

REM Written with labels rather than parenthesised blocks on purpose: inside a
REM block, `%errorlevel%` is substituted when the block is PARSED, so the retry
REM below would test a stale value and never run.
if "%UXNAN_AGENT_ID%"=="" goto :fallback
if "%UXNAN_HOOK_URL%"=="" goto :fallback
call :post "%UXNAN_HOOK_URL%" "%UXNAN_HOOK_TOKEN%"
if not errorlevel 1 goto :done

:fallback
REM The environment had no coordinates, or they no longer answer: fall back to
REM the endpoint file, which the live app rewrites on every launch.
if not defined UXNAN_ENDPOINT_FILE goto :done
if not exist "%UXNAN_ENDPOINT_FILE%" goto :done
call "%UXNAN_ENDPOINT_FILE%" 2>nul
if "%UXNAN_AGENT_ID%"=="" goto :done
if "%UXNAN_HOOK_URL%"=="" goto :done
call :post "%UXNAN_HOOK_URL%" "%UXNAN_HOOK_TOKEN%"

:done
del "%BODY%" 2>nul
REM An empty object: "I observed this, I decide nothing". Several of these CLIs
REM parse the hook's stdout and read an unparseable one as a refusal - Cursor
REM gates tool use on it, so a reporter that printed nothing would BLOCK the
REM agent's file reads and shell commands rather than merely fail to report.
echo {}
exit /b 0

:post
REM `-f` so an HTTP error counts as a failed attempt (that is what triggers the
REM fallback); bare `exit /b` propagates curl's own exit code, unlike
REM `exit /b %errorlevel%`, which would be substituted at parse time.
"%SystemRoot%\System32\curl.exe" -fsS -X POST "%~1" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Uxnan-Token: %~2" -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" -H "X-Uxnan-Agent-Type: %TYPE%" -H "X-Uxnan-Event: %EVENT%" --data-binary "@%BODY%" >nul 2>&1
exit /b
