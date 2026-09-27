// instrumentation.ts
//
// Server-side error capture. Next.js calls `onRequestError` for every error its server
// captures — Server Component renders, Route Handlers, Server Actions — and this writes
// each one to `cardtrade.error_logs` (0123) in production.
//
// THE DIGEST IS THE JOIN. A Server Component error reaches the browser's error boundary
// with its message redacted and a `digest` attached; this stores that digest as the
// row's `reference`, which is also the "Ref" the error screen shows and the key a
// member's report is filed under. So the browser never re-logs a digested error.
//
// A throw from a Server Action is usually recorded already, with the action's name, by
// `withActionLog`, which marks the error; those are skipped here rather than stored
// twice.
//
// NODE RUNTIME ONLY. The writer uses the service-role Supabase client, and `proxy.ts`
// (the only Edge code) is small enough that its failures are better read from Vercel's
// logs than bundled with a database client. Loaded with a dynamic import so the Edge
// bundle never pulls it in.

import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { describeError, isErrorLoggingEnabled, wasErrorLogged, writeErrorLog } =
      await import('@/lib/errors/errorLog');
    if (!isErrorLoggingEnabled() || wasErrorLogged(err)) return;

    const digest =
      typeof err === 'object' && err !== null && 'digest' in err
        ? String((err as { digest: unknown }).digest)
        : null;
    const described = describeError(err);

    await writeErrorLog({
      source: 'SERVER',
      reference: digest,
      message: described.message,
      stack: described.stack,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      method: request.method,
    });
  } catch (loggingError) {
    // Never let logging an error become a second error.
    console.error('[instrumentation] failed to log request error:', loggingError);
  }
};
