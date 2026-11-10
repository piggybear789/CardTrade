# scripts/ig_loop.ps1
#
# Runs the free Instagram reference crawl continuously: download a batch of queued
# accounts with scripts/ig_fetch.py (recheck accounts first), judge them with the crawler's
# --local mode, repeat. Stop it with Ctrl+C; nothing is lost, because downloads not yet
# judged stay in .ig-cache and are judged on the next pass.
#
#   powershell -File scripts/ig_loop.ps1            (from the repo root)
#   powershell -File scripts/ig_loop.ps1 -Gap 2     (slower)
#
# When Instagram says slow down beyond ig_fetch.py's own back-offs, or flags the session,
# the fetcher exits 3 and this waits six hours before trying again. A logged-out session
# (exit 2) ends the loop: paste fresh cookies into .env.local, then start it again.

param(
  [int]$Batch = 200,
  [double]$Gap = 1.5
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$log = Join-Path $env:TEMP 'ig-loop.log'

function Say($text) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Write-Host $line
  Add-Content -Path $log -Value $line
}

while ($true) {
  py -3 scripts/ig_fetch.py --recheck $Batch --queue $Batch --gap $Gap 2>&1 | Tee-Object -FilePath $log -Append
  $fetch = $LASTEXITCODE

  npx tsx --env-file=.env.local scripts/import-instagram-references.ts --local .ig-cache 2>&1 |
    Select-String -Pattern 'kept|local:|DONE|failed|NEUTRAL|NEGATIVE|Another' |
    ForEach-Object { $_.Line } | Tee-Object -FilePath $log -Append

  if ($fetch -eq 2) { Say 'Session logged out. Paste fresh cookies into .env.local and start again.'; break }
  if ($fetch -eq 3) { Say 'Instagram asked to stop. Waiting 6 hours.'; Start-Sleep -Seconds (6 * 3600); continue }
  if ($fetch -eq 4) { Say 'Queue empty. Waiting 1 hour.'; Start-Sleep -Seconds 3600; continue }
  if ($fetch -ne 0) { Say "Fetcher exited $fetch. Waiting 30 minutes."; Start-Sleep -Seconds 1800; continue }
}
