param([string]$Log)
# Summarises a Playwright line-reporter log: per failed test, the non-UX errors and the
# distinct UX check kinds. Local triage aid only.
$lines = Get-Content $Log
$blocks = @()
$cur = $null
foreach ($ln in $lines) {
  if ($ln -match '^\s+\d+\) \[(\w+)\] .* @id:(\S+)') {
    if ($cur) { $blocks += $cur }
    $cur = [ordered]@{ id = $Matches[2]; vp = $Matches[1]; errors = New-Object System.Collections.ArrayList; ux = @{}; ctx = 0 }
    continue
  }
  if (-not $cur) { continue }
  if ($ln -match '^\s+\+\s+"(\S+) \(') { $cur.ux[$Matches[1]] = 1 }
  if ($cur.ctx -gt 0) { [void]$cur.errors.Add('      ' + $ln.Trim()); $cur.ctx-- }
  if ($ln -match '^\s+Error: (.*)' -and $ln -notmatch 'Blocking UX') { [void]$cur.errors.Add('    ' + $ln.Trim()); $cur.ctx = 7 }
  if ($ln -match 'at C:\\dev\\Marketplace\\tests\\e2e\\(specs|support)\\(\S+)' -and $cur.errors.Count -gt 0 -and $cur.ctx -eq 0) { }
}
if ($cur) { $blocks += $cur }
foreach ($b in $blocks) {
  "== [$($b.vp)] $($b.id)  ux: $(($b.ux.Keys | Sort-Object) -join ',')"
  $b.errors | Select-Object -First 24 | ForEach-Object { if ($_.Length -gt 260) { $_.Substring(0,260) } else { $_ } }
}
