'use client';

// app/error.tsx
//
// Route-segment error boundary. Catches uncaught errors thrown while rendering
// any page in the app and offers a recovery path instead of a blank screen.
// A Client Component, as required by Next.js for error boundaries. Logging and
// the report link live in `ErrorScreen`.

import { ErrorScreen } from '@/components/layout/ErrorScreen';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      onRetry={reset}
      title="This page didn't load"
      description="Your money and trades aren't affected. Try again in a moment."
    />
  );
}
