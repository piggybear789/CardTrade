// app/api/health/route.ts
//
// Lightweight health check for external uptime monitors (e.g. UptimeRobot,
// Pingdom, AWS Route 53 health checks). Returns 200 with a JSON body when
// the app is responsive. Does NOT check downstream dependencies (DB, Stripe)
// — that would make the health check fail on provider outages, which defeats
// the purpose of knowing whether THIS service is up.

import { NextResponse } from 'next/server';

export const runtime = 'edge';

export function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
