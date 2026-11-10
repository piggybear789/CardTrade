# scripts/ig_judge_loop.ps1
#
# Judges downloads in .ig-cache as they arrive, alongside scripts/ig_loop.ps1, so the
# fetcher never waits for Haiku. Started by ig_loop.ps1; exits once the fetch loop has
# ended and nothing is left to judge. A pass that fails (network down, Haiku or Supabase
# unreachable) is retried after a minute rather than at once.

param([int]$Concurrency = 8)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$log = Join-Path $env:TEMP 'ig-judge.log'

while ($true) {
  $waiting = @(Get-ChildItem .ig-cache -Filter *.json -File -ErrorAction SilentlyContinue)
  if ($waiting.Count -gt 0) {
    npx tsx --env-file=.env.local scripts/import-instagram-references.ts --local .ig-cache --concurrency $Concurrency 2>&1 |
      Select-String -Pattern 'kept|local:|DONE|failed|NEUTRAL|NEGATIVE|Another|Error|ENOTFOUND|fetch failed' |
      ForEach-Object { $_.Line } | Tee-Object -FilePath $log -Append
    $left = @(Get-ChildItem .ig-cache -Filter *.json -File -ErrorAction SilentlyContinue).Count
    # Nothing judged: the pass failed. Wait instead of spinning.
    if ($left -ge $waiting.Count) { Start-Sleep -Seconds 60 }
    continue
  }
  $fetching = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ig_loop\.ps1|ig_fetch\.py' }
  if (-not $fetching) {
    Add-Content -Path $log -Value ("[{0}] Fetch loop ended and nothing is waiting. Judge loop stopping." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    break
  }
  Start-Sleep -Seconds 30
}
