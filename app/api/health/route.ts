// app/api/health/route.ts
//
// Lightweight health check for external uptime monitors (e.g. UptimeRobot,
// Pingdom, AWS Route 53 health checks). Returns 200 with a JSON body when
// the app is responsive. Does NOT check downstream dependencies (DB, Stripe)
// — that would make the health check fail on provider outages, which defeats
// the purpose of knowing whether THIS service is up.
//
// On the dev sandbox ONLY (`DB_SCHEMA === 'cardtrade_dev'`) the body also carries
// `schema` and `paymentsMode`, which the e2e audit preflight compares with its own
// resolution before any pathway runs (e2e-ux-audit-suite Req 1.4, 1.5). On any other
// schema those keys are absent and the response is exactly what it was before.
// Neither is a credential: `paymentsMode` is a label derived from key prefixes.

import { NextResponse } from 'next/server';
import { resolvePaymentProvider, resolvePaymentsMode } from '@/domain/services/providerMode';
import { DB_SCHEMA, IS_DEV_SCHEMA } from '@/lib/supabase/schema';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
      // ESC-16: which KIND of payment binding is active. Never a key or a region list.
      // `unconfigured` on a production deployment means every payment will fail loudly.
      payments: resolvePaymentProvider(),
      ...(IS_DEV_SCHEMA ? { schema: DB_SCHEMA as string, paymentsMode: resolvePaymentsMode() } : {}),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
