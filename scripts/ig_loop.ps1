# scripts/ig_loop.ps1
#
# Runs the free Instagram reference crawl until the network is exhausted: download
# batches of queued accounts with scripts/ig_fetch.py (recheck accounts first) while
# scripts/ig_judge_loop.ps1, started from here in its own window, judges them as they
# arrive. Stop it by closing both windows; nothing is lost, because downloads not yet
# judged stay in .ig-cache and are judged next time.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ig_loop.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\ig_loop.ps1 -Workers 2 -MinGap 0.5   (gentler)
#
# The fetcher finds the session's limit itself (its gap shrinks until Instagram says slow
# down). When it is told to stop (exit 3) this waits six hours and goes again. A
# logged-out session (exit 2) ends the loop: paste fresh cookies into .env.local and
# start it again. When the queue is empty AND nothing is waiting to be judged (judging
# is what adds accounts to the queue), every account the network leads to has been read.

param(
  [int]$Batch = 500,
  [double]$Gap = 0.8,
  [double]$MinGap = 0.25,
  [int]$Workers = 3
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$log = Join-Path $env:TEMP 'ig-loop.log'

function Say($text) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Write-Host $line
  Add-Content -Path $log -Value $line
}

function JudgeRunning {
  # A judging PASS, not the judge loop itself, which idles until this loop ends.
  [bool](Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'import-instagram-references\.ts' })
}

if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ig_judge_loop\.ps1' })) {
  Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\ig_judge_loop.ps1' -WorkingDirectory (Get-Location) -WindowStyle Minimized
  Say 'Started the judge loop.'
}

while ($true) {
  py -3 scripts/ig_fetch.py --recheck $Batch --queue $Batch --gap $Gap --min-gap $MinGap --workers $Workers 2>&1 | Tee-Object -FilePath $log -Append
  $fetch = $LASTEXITCODE

  if ($fetch -eq 2) { Say 'Session logged out. Paste fresh cookies into .env.local and start again.'; break }
  if ($fetch -eq 3) { Say 'Instagram asked to stop. Waiting 6 hours.'; Start-Sleep -Seconds (6 * 3600); continue }
  if ($fetch -eq 4) {
    $waiting = @(Get-ChildItem .ig-cache -Filter *.json -File -ErrorAction SilentlyContinue).Count
    if ($waiting -gt 0 -or (JudgeRunning)) { Start-Sleep -Seconds 120; continue }
    Say 'Queue empty and nothing left to judge: every account the network leads to has been read. Stopping.'
    break
  }
  if ($fetch -ne 0) { Say "Fetcher exited $fetch. Waiting 30 minutes."; Start-Sleep -Seconds 1800; continue }
}
