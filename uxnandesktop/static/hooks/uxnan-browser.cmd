@echo off
rem uxnan integrated-browser shim (Windows).
rem
rem Tools that honor %BROWSER% invoke this as `uxnan-browser <url>`. We forward the
rem URL to the ADE's local browser endpoint so it opens in the in-app developer
rem browser, honoring the user's link policy. Best-effort + silent (curl ships with
rem Windows 10+); on any failure we exit cleanly so the calling tool isn't disrupted.
setlocal
set "URL=%~1"
if "%URL%"=="" exit /b 0
if "%UXNAN_BROWSER_URL%"=="" exit /b 0
curl -s -m 3 -X POST "%UXNAN_BROWSER_URL%" -H "Content-Type: application/json" -H "X-Uxnan-Token: %UXNAN_BROWSER_TOKEN%" --data-raw "{\"url\":\"%URL%\"}" >nul 2>&1
exit /b 0
