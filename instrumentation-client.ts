// instrumentation-client.ts
//
// Runs in the browser before hydration. Registers the listeners that send uncaught
// errors and unhandled promise rejections to `POST /api/errors` (0123) — the errors a
// React error boundary cannot see, because they happen outside rendering.
//
// Kept to one synchronous call: Next warns when this file takes more than 16ms, and
// anything slower would delay the page becoming interactive.

import { installClientErrorCapture } from '@/lib/errors/clientErrorReporter';

try {
  installClientErrorCapture();
} catch {
  // Monitoring must never stop the app from starting.
}
