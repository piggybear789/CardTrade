Get-ChildItem test-results -Directory | Where-Object { $_.Name -like '*desktop' } | ForEach-Object {
  $f = Join-Path $_.FullName 'error-context.md'
  if (Test-Path $f) {
    $c = Get-Content $f
    $name = ($c | Select-String -Pattern '^- Name: ' | Select-Object -First 1)
    $start = ($c | Select-String -Pattern '^# Error details' | Select-Object -First 1).LineNumber
    Write-Output '============================================'
    Write-Output $name.Line
    if ($start) { $c[($start)..([Math]::Min($start + 12, $c.Count - 1))] | Where-Object { $_ -match '\S' } }
  }
}
