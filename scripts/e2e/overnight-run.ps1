# scripts/e2e/overnight-run.ps1
#
# One unattended run: rebuild the e2e bundle, run the unit/component suite and lint,
# run the whole e2e suite with video, rerun anything that failed on its own, then turn
# the recordings into captioned story videos and compress the two films so they fit in
# git. Progress goes to overnight-status.txt; each stage writes its own log.

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$status = 'overnight-status.txt'
function Note($line) { "$(Get-Date -Format 'HH:mm:ss') $line" | Out-File -Append -Encoding utf8 $status }
function StopServers {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in 'node.exe', 'stripe.exe' -and $_.CommandLine -match 'playwright|next start|next-server|stripeListen|scrubbed-server|listen --all-snapshot'
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($p in 3100, 3101, 3199) {
    Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 3
}

Remove-Item $status -ErrorAction SilentlyContinue
Note 'start'
StopServers
# A pathway list left by an earlier `npm run audit` hides newly added Pathways.
Remove-Item 'audit-artifacts/.pathways.json' -ErrorAction SilentlyContinue

npm run test:e2e:build *> e2e-build.log
Note "build exit=$LASTEXITCODE"

npx vitest --run *> vt-full.log
$vt = (Select-String -Path vt-full.log -Pattern '^\s+Tests\s' | Select-Object -Last 1).Line
Note "vitest: $vt"
npx eslint . *> lint.log
Note "lint exit=$LASTEXITCODE"

$env:E2E_WORKERS = '4'
$env:E2E_TRACE = '0'
$env:E2E_VIDEO = '1'
node node_modules/@playwright/test/cli.js test *> e2e-video.log
$summary = (Select-String -Path e2e-video.log -Pattern '^\s+\d+ (passed|failed|flaky|skipped|did not run)' | ForEach-Object { $_.Line.Trim() }) -join '; '
Note "e2e full: $summary"
$videoRun = (Get-ChildItem audit-artifacts/runs -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
Note "video run id: $videoRun"

# Rerun failures alone, without video, to tell load from real failures.
$failedIds = Select-String -Path e2e-video.log -Pattern '^\s+\d+\) \[.*@id:(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
$failedTitles = Select-String -Path e2e-video.log -Pattern '^\s+\d+\) \[[^\]]+\] .*specs\\journeys\.spec\.ts:\d+:\d+ .* › (.+?)\s*$' | ForEach-Object { [regex]::Escape($_.Matches[0].Groups[1].Value.Trim()) } | Sort-Object -Unique
$grep = @($failedIds | ForEach-Object { [regex]::Escape($_) }) + @($failedTitles)
if ($grep.Count -gt 0) {
  StopServers
  Remove-Item Env:E2E_VIDEO -ErrorAction SilentlyContinue
  $env:E2E_WORKERS = '2'
  node node_modules/@playwright/test/cli.js test --grep ($grep -join '|') *> e2e-rerun.log
  $rerun = (Select-String -Path e2e-rerun.log -Pattern '^\s+\d+ (passed|failed|flaky|did not run)' | ForEach-Object { $_.Line.Trim() }) -join '; '
  Note "e2e rerun of $($grep.Count) failure(s): $rerun"
} else {
  Note 'e2e rerun: nothing failed'
}
StopServers

# Story videos from the VIDEO run (not the rerun).
npx tsx scripts/e2e/story-videos.ts --run $videoRun *> story.log
Note "story videos: $((Select-String -Path story.log -Pattern 'Wrote|passing Pathway' | ForEach-Object { $_.Line.Trim() }) -join ' | ')"

# Compress the two films for git (GitHub refuses files over 100 MB).
New-Item -ItemType Directory -Force -Path docs/e2e-videos | Out-Null
foreach ($vp in 'desktop', 'phone') {
  $src = "audit-report/videos/noditto-e2e-$vp.mp4"
  if (Test-Path $src) {
    $dst = "docs/e2e-videos/noditto-e2e-$vp.mp4"
    ffmpeg -y -hide_banner -loglevel error -i $src -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an $dst
    Note ("compressed {0}: {1:N1} MB" -f $vp, ((Get-Item $dst).Length / 1MB))
  }
}
Note 'done'
