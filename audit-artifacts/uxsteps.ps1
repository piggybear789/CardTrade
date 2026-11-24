param([string]$Log, [string]$Check)
$lines = Get-Content $Log
$step = ''; $test = ''
$out = foreach ($ln in $lines) {
  if ($ln -match '^\s+\d+\) .*@id:(\S+)') { $test = $Matches[1] }
  if ($ln -match 'Blocking UX observations on step (\d+ ".+?")') { $step = $Matches[1] }
  if ($ln -match ('^\s+\+\s+"' + $Check + ' \((\w+)\) \S+ (.*)$')) {
    $msg = $Matches[2]; if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }
    "$test :: $step :: $msg"
  }
}
$out | Sort-Object -Unique
