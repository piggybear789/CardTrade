# E2E UX Audit Suite

End-to-end functional and UX audit suite for NoDitto, running against the `cardtrade_dev` sandbox and Stripe TEST mode.

Playwright automatically starts both production `next start` servers (`main` on `:3100`, `aux` on `:3101`) and the Stripe webhook forwarder (`stripeListen.mjs`). **`npm run dev` is never used.**

## One-Time Setup

1. Reset/seed the sandbox if stale:
   ```bash
   npm run dev:db:reset
   ```
2. Provision Stripe test fixture accounts (once per sandbox):
   ```bash
   npm run audit:stripe-fixtures
   ```
3. Ensure `http://localhost:3100/**` is listed in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.

## Running the Audit

```bash
# Full audit suite (builds .next-e2e, runs all Pathways on desktop + phone, generates audit-report/)
npm run audit

# Subset flags (dev loop — skips video encoding unless E2E_VIDEO=1)
npm run audit -- --area cash-sale --no-build
npm run audit -- --pathway cash-sale.buy-now.reserves-single --no-build
npm run audit -- --viewport desktop --no-build
npm run audit -- --area offers --fast --no-build   # skips screenshots on passing steps
npm run audit -- --compare-isolated cash-sale --no-build
```

## Reports & Maintenance

```bash
npm run audit:report   # Build self-contained HTML report in audit-report/
npm run audit:pack     # Package audit-report/ into audit-report.zip (excludes forbidden artifacts)
npm run audit:clean    # Delete [E2E]-marked sandbox rows, storage uploads, and test Stripe objects
npm run audit:reel     # Optional: build audit-report/highlight-reel.mp4 (requires ffmpeg)
```
