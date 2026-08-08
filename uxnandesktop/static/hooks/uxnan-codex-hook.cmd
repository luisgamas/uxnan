@echo off
REM Uxnan Desktop - Codex status hook (Windows / cmd).
REM
REM Codex runs this through cmd on Windows. It forwards Codex's raw hook JSON
REM (piped on stdin) to the ADE's local hook server with the system curl.exe.
REM Codex is a Rust binary with no Node guarantee, so this uses curl, not node.
REM Fail-open: any problem exits 0 so a broken hook never blocks Codex.
REM
REM WHICH SERVER IT REPORTS TO. The terminal's own environment wins, and the
REM endpoint file is only the rescue. That order is load-bearing: the file lives
REM at one shared path, so a SECOND uxnan window overwrites it with its own
REM coordinates and every agent of the first one starts reporting to the second -
REM measured, and the reason a second window showed no completion checks. The
REM file still matters when the environment is stale (a session that outlived an
REM app restart), so it is tried when the first POST fails.
REM
REM curl.exe is fully-qualified so a repo-local curl.exe on PATH can't hijack the
REM payload. The agent id / kind ride in headers so this never builds JSON; the
REM raw event is the body, kept in a temp file so a retry can send it again.

setlocal
set "BODY=%TEMP%\uxnan-codex-%RANDOM%%RANDOM%.json"
more > "%BODY%" 2>nul

REM Labels rather than parenthesised blocks: inside a block, `%errorlevel%` is
REM substituted when the block is PARSED, so the retry would test a stale value.
if "%UXNAN_AGENT_ID%"=="" goto :fallback
if "%UXNAN_HOOK_URL%"=="" goto :fallback
call :post "%UXNAN_HOOK_URL%" "%UXNAN_HOOK_TOKEN%"
if not errorlevel 1 goto :done

:fallback
if not defined UXNAN_ENDPOINT_FILE goto :done
if not exist "%UXNAN_ENDPOINT_FILE%" goto :done
call "%UXNAN_ENDPOINT_FILE%" 2>nul
if "%UXNAN_AGENT_ID%"=="" goto :done
if "%UXNAN_HOOK_URL%"=="" goto :done
call :post "%UXNAN_HOOK_URL%" "%UXNAN_HOOK_TOKEN%"

:done
del "%BODY%" 2>nul
exit /b 0

:post
REM `-f` so an HTTP error counts as a failed attempt (that is what triggers the
REM fallback); bare `exit /b` propagates curl's own exit code, unlike
REM `exit /b %errorlevel%`, which would be substituted at parse time.
"%SystemRoot%\System32\curl.exe" -fsS -X POST "%~1" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Uxnan-Token: %~2" -H "X-Uxnan-Agent-Id: %UXNAN_AGENT_ID%" -H "X-Uxnan-Agent-Type: codex" --data-binary "@%BODY%" >nul 2>&1
exit /b
