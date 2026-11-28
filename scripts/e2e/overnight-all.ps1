# scripts/e2e/overnight-all.ps1
#
# The overnight run, then the guided business videos from its recordings.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/overnight-run.ps1
$run = (Get-ChildItem audit-artifacts/runs -Directory | Sort-Object Name -Descending |
  Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') } |
  Sort-Object { (Get-Item (Join-Path $_.FullName 'manifest.json')).Length } -Descending |
  Select-Object -First 1).Name
"$(Get-Date -Format 'HH:mm:ss') guided videos from $run" | Out-File -Append -Encoding utf8 overnight-status.txt
npx tsx scripts/e2e/guided-videos.ts --run $run *> guided.log
"$(Get-Date -Format 'HH:mm:ss') guided videos exit=$LASTEXITCODE" | Out-File -Append -Encoding utf8 overnight-status.txt
"$(Get-Date -Format 'HH:mm:ss') all done" | Out-File -Append -Encoding utf8 overnight-status.txt
