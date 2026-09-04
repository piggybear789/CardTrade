$lines = Get-Content e2e-run.log
$failed = $lines | Where-Object { $_ -match '^\s+x\s+\d+ \[' }
$failed | ForEach-Object { ($_ -replace '\s+\(\d.*$', '') -replace '^\s+x\s+\d+\s+', '' } | Sort-Object -Unique
Write-Output '--- totals ---'
$lines | Where-Object { $_ -match '^\s+\d+ (failed|passed|did not run|flaky|skipped)' }
