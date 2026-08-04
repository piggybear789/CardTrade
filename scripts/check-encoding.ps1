# scripts/check-encoding.ps1
#
# Fail-fast guard for source files that are not valid UTF-8.
#
# WHY THIS EXISTS. On 2026-08-03 `next build` failed with "stream did not contain
# valid UTF-8" on components/deals/NewDealForm.tsx. The file held Windows-1252
# single bytes (0x97 em dash, 0xB7 middle dot, 0x85 ellipsis) where UTF-8
# multi-byte sequences belonged — the signature of a Windows PowerShell script
# writing with its default encoding instead of UTF-8.
#
# `tsc --noEmit` passes on such a file, and `next build` aborts on the FIRST one it
# meets, so a single reported failure can hide others. This scans everything at
# once.
#
# When writing files from PowerShell, always pass an explicit
# `New-Object System.Text.UTF8Encoding($false)` rather than relying on the default.
#
# Run with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-encoding.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$roots = @('app', 'components', 'domain', 'lib', 'tests', 'scripts', 'supabase')
$strict = New-Object System.Text.UTF8Encoding($false, $true)
$bad = New-Object System.Collections.Generic.List[string]
$scanned = 0

foreach ($root in $roots) {
  $full = Join-Path $repoRoot $root
  if (-not (Test-Path $full)) { continue }
  Get-ChildItem -Path $full -Recurse -File -Include *.ts, *.tsx, *.mjs, *.css, *.sql, *.md |
    ForEach-Object {
      $scanned++
      try {
        $null = $strict.GetString([System.IO.File]::ReadAllBytes($_.FullName))
      } catch {
        $bad.Add($_.FullName.Substring($repoRoot.Length + 1))
      }
    }
}

Write-Output ("Scanned {0} file(s)." -f $scanned)

if ($bad.Count -eq 0) {
  Write-Output 'All valid UTF-8.'
  exit 0
}

Write-Output ("INVALID UTF-8 in {0} file(s):" -f $bad.Count)
foreach ($f in $bad) { Write-Output ("  " + $f) }
exit 1
