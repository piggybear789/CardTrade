@echo off
rem scripts\run-reference-crawl.cmd
rem
rem The weekly Instagram reference job, run by the Windows scheduled task
rem "NoDitto Reference Crawl" (see scripts\import-instagram-references.ts):
rem   1. scam-report hashtags from the last week (at most 200 credits)
rem   2. refresh: accounts with references not checked for 14 days (at most 1,500 credits)
rem   3. fan-out: keep working the queue (at most 1,000 credits)
rem Every step stops when the SocialCrawl balance falls to 2,000, so a top-up is never
rem spent past that without someone deciding to. Logs go to %LOCALAPPDATA%\NoDitto\logs.

setlocal
cd /d "%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\NoDitto\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
set "LOG=%LOGDIR%\reference-crawl-%TODAY%.log"

call npx tsx --env-file=.env.local scripts\import-instagram-references.ts --hashtags --stale-days 8 --max-credits 200 --reserve 2000 >> "%LOG%" 2>&1
call npx tsx --env-file=.env.local scripts\import-instagram-references.ts --refresh --stale-days 14 --max-credits 1500 --reserve 2000 >> "%LOG%" 2>&1
call npx tsx --env-file=.env.local scripts\import-instagram-references.ts --max-credits 1000 --reserve 2000 >> "%LOG%" 2>&1
endlocal
