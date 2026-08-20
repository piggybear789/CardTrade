$diff = git diff --name-only -- '*.tsx' | Where-Object { $_ }
$bad = @()
foreach ($f in $diff) {
  $full = Join-Path 'c:\CardTrade' $f
  if (Test-Path $full) {
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($text -match "\uFFFD" -or $text -match "\u00E2\u20AC") { $bad += $f }
  }
}
if ($bad.Count -eq 0) { Write-Output "No corrupted tsx files" } else { $bad }
