# scripts/set-vercel-cron-secret.ps1
#
# Sets Vercel's CRON_SECRET equal to the local JOBS_SECRET.
#
# WHY THEY MUST MATCH. `vercel.json` schedules /api/jobs/cash-sale-payouts. Vercel
# Cron authenticates by sending `Authorization: Bearer $CRON_SECRET`, and the route
# compares that bearer token against JOBS_SECRET in constant time and fails closed
# when it is absent. If the two differ, every scheduled run 401s and owed seller
# releases are only ever drained when an operator presses the button in the admin
# console — which is the situation this was written to fix.
#
# WHY A SCRIPT. The value is read straight out of .env.local and piped to the CLI on
# stdin, so it never lands in your clipboard, your shell history, or a chat
# transcript. Nothing here prints the secret.
#
# Prerequisites, both interactive and therefore not automatable:
#   npx vercel login
#   npx vercel link
#
# Usage (Windows PowerShell 5.1 is what this machine has; `pwsh` also works):
#   powershell -ExecutionPolicy Bypass -File scripts/set-vercel-cron-secret.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/set-vercel-cron-secret.ps1 -Environments production,preview

param(
    # Cron only runs in production, so that is the only environment that must have
    # it. Add preview if you want to exercise the endpoint from a preview branch.
    [string[]]$Environments = @('production'),
    [string]$EnvFile = '.env.local'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
    Write-Error "$EnvFile not found. Run this from the repository root."
}

# Read JOBS_SECRET without echoing it.
$line = Get-Content $EnvFile | Where-Object { $_ -match '^\s*JOBS_SECRET\s*=' } | Select-Object -First 1
if (-not $line) {
    Write-Error "JOBS_SECRET is not set in $EnvFile. The payout job fails closed without it."
}

$secret = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Error 'JOBS_SECRET is present but empty.'
}

Write-Host "Read JOBS_SECRET from $EnvFile ($($secret.Length) characters)." -ForegroundColor Green

if (-not (Test-Path '.vercel/project.json')) {
    Write-Error 'This directory is not linked to a Vercel project. Run: npx vercel link'
}

foreach ($target in $Environments) {
    Write-Host "Setting CRON_SECRET for $target ..." -ForegroundColor Cyan

    # `env add` reads the value from stdin when piped, so it is never an argument —
    # arguments show up in process listings and shell history.
    $secret | npx vercel env add CRON_SECRET $target

    if ($LASTEXITCODE -ne 0) {
        # The overwhelmingly common cause is the variable already existing, which
        # `env add` refuses rather than silently replacing.
        Write-Warning "Could not add CRON_SECRET for $target. If it already exists, remove it first:"
        Write-Warning "  npx vercel env rm CRON_SECRET $target"
        continue
    }

    Write-Host "CRON_SECRET set for $target." -ForegroundColor Green
}

Write-Host ''
Write-Host 'Next: redeploy so the new variable is picked up.' -ForegroundColor Yellow
Write-Host '  npx vercel --prod'
Write-Host ''
Write-Host 'Then confirm the schedule is registered under Project -> Settings -> Cron Jobs.'
Write-Host 'A successful run returns {"ok":true,...}; a 401 means the two secrets differ.'
