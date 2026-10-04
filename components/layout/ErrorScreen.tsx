'use client';

// components/layout/ErrorScreen.tsx
//
// The shared body for route error boundaries: a heading, one sentence, two ways out,
// and a way to tell us about it.
//
// WHY NO ICONS. The previous layout stacked a red warning badge, an eyebrow label and a
// heading that all said the same thing, and gave "Try again" a rotate icon that read as
// a loading spinner. A load failure is usually transient and nothing is lost, so the
// page reads calm rather than alarmed.
//
// LOGGING AND REPORTING (0123). Every error here has a REFERENCE: the server digest when
// the error came from the server (already logged by `instrumentation.ts`), or an id this
// screen mints when the error was thrown in the browser (sent from here to
// `/api/errors`). The member sees the same reference, and "Report this problem" files
// against it, so a report always lands next to the error it is about.

import { useEffect, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { reportError } from '@/lib/actions/errorReports';
import { mintClientReference, sendClientError } from '@/lib/errors/clientErrorReporter';

const NOTE_MAX = 2000;

/**
 * The reference for `error`, logging it if the server has not already.
 *
 * A digested error was captured by `onRequestError` with that digest, so logging it
 * again would double-count. A browser error has no digest and nothing else will record
 * it, so it is sent here, once per boundary mount. The route decides whether logging is
 * on (production only) and rate-limits it.
 */
export function useErrorReference(error: Error & { digest?: string }): string {
  const [reference] = useState(() => error.digest || mintClientReference());

  useEffect(() => {
    if (error.digest) return;
    // Sent over `sendBeacon`, not a Server Action: `global-error` uses this hook too,
    // and it renders in place of the root layout, where the app router may be gone.
    sendClientError({
      reference,
      message: `${error.name}: ${error.message}`,
      stack: error.stack ?? null,
      kind: 'boundary',
    });
    // Once per error, not per navigation: the boundary remounts for a new error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return reference;
}

export function ErrorScreen({
  error,
  onRetry,
  title,
  description,
  backHref = '/',
  backLabel = 'Back to marketplace',
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
}) {
  const reference = useErrorReference(error);
  const pathname = usePathname();
  const noteId = useId();

  const [reportState, setReportState] = useState<'idle' | 'writing' | 'sent'>('idle');
  const [note, setNote] = useState('');
  const [reportError_, setReportError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function sendReport(event: React.FormEvent) {
    event.preventDefault();
    setReportError(null);
    startTransition(async () => {
      const result = await reportError({ reference, note, path: pathname });
      if (result.ok) {
        setReportState('sent');
        return;
      }
      setReportError(result.message);
    });
  }

  // `py-12` on a phone: no bottom nav renders under an error boundary, and 80px either
  // side pushed the buttons below the fold at 375x667.
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-group py-12 text-center sm:py-20">
      <h1 className="text-balance font-display text-head font-semibold tracking-tight">
        {title}
      </h1>
      <p className="mt-snug text-pretty text-body text-muted-foreground">{description}</p>

      <div className="mt-group flex w-full flex-col gap-snug sm:w-auto sm:flex-row">
        <Button onClick={onRetry}>Try again</Button>
        <Button asChild variant="ghost">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>

      <div className="mt-section w-full border-t pt-group">
        {reportState === 'idle' ? (
          <p className="flex flex-wrap items-center justify-center gap-x-cozy gap-y-tight text-meta text-muted-foreground">
            <button
              type="button"
              onClick={() => setReportState('writing')}
              className="font-medium text-foreground underline decoration-iris/55 underline-offset-4 hover:decoration-iris focus-visible:outline-none"
            >
              Report this problem
            </button>
            <span className="font-mono">Ref {reference}</span>
          </p>
        ) : null}

        {reportState === 'writing' ? (
          <form onSubmit={sendReport} className="space-y-snug text-left">
            <Label htmlFor={noteId}>What were you doing? (optional)</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={NOTE_MAX}
              rows={3}
              className="resize-none"
              placeholder="I tapped Buy on a listing and the page went blank."
              autoFocus
            />
            {reportError_ ? (
              <p role="alert" className="text-meta text-destructive">
                {reportError_}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-cozy">
              <span className="font-mono text-meta text-muted-foreground">Ref {reference}</span>
              <div className="flex gap-snug">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReportState('idle')}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending} aria-busy={isPending}>
                  <PendingLabel pending={isPending} pendingLabel="Sending…">
                    Send report
                  </PendingLabel>
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {reportState === 'sent' ? (
          <p role="status" className="text-meta text-muted-foreground">
            Report sent. We&apos;ll look into it.{' '}
            <span className="font-mono">Ref {reference}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
