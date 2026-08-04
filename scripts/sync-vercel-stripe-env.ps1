# scripts/sync-vercel-stripe-env.ps1
#
# Copy the Stripe configuration from .env.local into the Vercel project, and delete the
# retired Pinch variables.
#
# WHY THIS SCRIPT EXISTS. Vercel environment variables are not in the repository —
# `.env.local` is gitignored — so committing the Stripe migration does not create them.
# Production had zero STRIPE_* values and nine PINCH_* leftovers, which meant
# `getPaymentService()` threw on every request that touched money and
# `readWebhookSecrets()` returned an empty list, so every authentic Stripe delivery
# failed verification and was rejected.
#
# Values are piped on stdin and never printed. The script reports names and lengths
# only, so a shared terminal or a scrollback never carries a secret.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\sync-vercel-stripe-env.ps1

# Deliberately NOT 'Stop'. The Vercel CLI writes its banner and progress to stderr, and
# with $ErrorActionPreference='Stop' PowerShell turns any native stderr output into a
# terminating error — so a perfectly successful `vercel env add` aborts the script.
# Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'

$envFile = Join-Path $PSScriptRoot '..\.env.local'
if (-not (Test-Path $envFile)) { throw "No .env.local at $envFile" }

# Parse KEY=VALUE, tolerating quotes and inline whitespace.
$local = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*#') { continue }
  if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
  $local[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
}

# Every value the Stripe binding reads at runtime. PAYOUT_MODE is included only when
# present locally, since `platform` is the documented default.
$required = @(
  'PAYMENTS_PROVIDER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
)
$optional = @('STRIPE_CONNECT_WEBHOOK_SECRET', 'PAYOUT_MODE')

foreach ($name in $required) {
  if (-not $local.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($local[$name])) {
    throw "$name is missing from .env.local; refusing to push a partial Stripe config."
  }
}

# A live key must never be pushed by a convenience script. The prefix is the only thing
# that selects Stripe's mode, so this is the whole check.
if ($local['STRIPE_SECRET_KEY'].StartsWith('sk_live_')) {
  throw 'STRIPE_SECRET_KEY is a LIVE key. Set live credentials by hand, deliberately.'
}

$targets = @('production', 'preview')
$names = $required + ($optional | Where-Object { $local.ContainsKey($_) -and $local[$_] })

foreach ($name in $names) {
  foreach ($target in $targets) {
    # Remove first: `vercel env add` on an existing name in the same environment fails
    # rather than replacing, and a half-updated set is worse than an unset one.
    & npx --yes vercel env rm $name $target --yes 2>&1 | Out-Null
    $local[$name] | & npx --yes vercel env add $name $target 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to set $name for $target" }
    Write-Output "set $name ($target) len=$($local[$name].Length)"
  }
}

# The Mock delivery target, left pointing at a route that no longer exists. Harmless
# while PAYMENTS_PROVIDER=stripe, but a stale URL in a config list is a trap for
# whoever reads it next.
foreach ($target in $targets) {
  & npx --yes vercel env rm WEBHOOK_URL $target --yes 2>&1 | Out-Null
  'https://noditto.app/api/webhooks/stripe' | & npx --yes vercel env add WEBHOOK_URL $target 2>&1 | Out-Null
  Write-Output "set WEBHOOK_URL ($target)"
}

# The retired provider. Nothing in the codebase reads any of these any more — the Pinch
# binding was removed entirely, not disabled — so they are credentials sitting in a
# deployment for no reason.
$retired = @(
  'PINCH_ENV',
  'PINCH_DEV_ID',
  'PINCH_DEV_SECRET',
  'PINCH_LIVE_ID',
  'PINCH_LIVE_SECRET',
  'PINCH_MERCHANT_ID',
  'PINCH_PUBLISHABLE_KEY',
  'PINCH_TEST_PUBLISHABLE_KEY',
  'PINCH_WEBHOOK_SECRET'
)
foreach ($name in $retired) {
  foreach ($target in $targets) {
    & npx --yes vercel env rm $name $target --yes 2>&1 | Out-Null
  }
  Write-Output "removed $name"
}

Write-Output 'Done. Redeploy for the new values to take effect.'
