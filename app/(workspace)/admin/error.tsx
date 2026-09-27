'use client';

// app/admin/error.tsx
//
// Admin error boundary. Catches errors within /admin and /admin/arbitration
// routes, allowing staff to retry without dropping them back to customer listings.

import { ErrorScreen } from '@/components/layout/ErrorScreen';

export default function AdminError({
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
      title="This console view didn't load"
      description="Try again, or go back to the main admin page."
      backHref="/admin"
      backLabel="Back to admin"
    />
  );
}
