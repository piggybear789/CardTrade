'use client';

// components/onboarding/EmbeddedIdentityStep.tsx
//
// The identity step's CONTROLS (unified-seller-onboarding, Req 2). Runs Stripe Identity
// inline via `stripe.verifyIdentity(clientSecret)` — a Stripe-owned modal — so the
// document and selfie never touch NoDitto's DOM or server (Req 2.3, 2.4). No redirect.
//
// Renders no heading of its own: the surface (or the card that hosts it) owns the
// title, so this cannot produce a duplicate heading in the outline.
//
// VERIFICATION IS OFTEN ASYNCHRONOUS. Stripe frequently returns `processing` rather
// than a decision when the modal closes, so treating "not verified yet" as an error
// would strand the most common real path. Instead the step polls the read-back a few
// times with backoff and then hands over a "Check again" control — the read-back stays
// the reliable signal either way (Req 2.5, 3.1).

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, ScanFace } from 'lucide-react';
import { toast } from 'sonner';

import { beginEmbeddedIdentity, refreshIdentityCheck } from '@/lib/actions/identity';
import { Button } from '@/components/ui/button';
import { CustodyNote } from './OnboardingSpine';
import { getStripe, isRealPublishableKey } from './stripeBrowser';

/** How many times to poll a still-processing check before offering a manual re-check. */
const POLL_ATTEMPTS = 4;
/** Backoff between polls, in ms. Stripe usually decides within a few seconds. */
const POLL_DELAYS = [1500, 2500, 4000, 6000];

type Phase = 'idle' | 'opening' | 'checking' | 'processing' | 'failed';

export interface EmbeddedIdentityStepProps {
  /** Where the resumable session should point its return marker. */
  returnPath?: string;
  /** Raised when the read-back reports the Identity_Gate satisfied. */
  onVerified: () => void;
  /** Raised when the provider has no embedded binding, so the parent can fall back. */
  onUnsupported: () => void;
}

export function EmbeddedIdentityStep({
  returnPath = '/onboarding',
  onVerified,
  onUnsupported,
}: EmbeddedIdentityStepProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Cancels in-flight polling if the component unmounts mid-check.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Read the check back, polling while Stripe is still deciding. Resolves to the
   * terminal-for-now status so the caller can render one clear outcome.
   */
  const settle = useCallback(async (): Promise<'VERIFIED' | 'FAILED' | 'PENDING'> => {
    for (let attempt = 0; attempt <= POLL_ATTEMPTS; attempt += 1) {
      const refreshed = await refreshIdentityCheck();
      if (!alive.current) return 'PENDING';
      if (refreshed.ok) {
        if (refreshed.data.status === 'VERIFIED') return 'VERIFIED';
        if (refreshed.data.status === 'FAILED') return 'FAILED';
      }
      if (attempt < POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_DELAYS[attempt]));
        if (!alive.current) return 'PENDING';
      }
    }
    return 'PENDING';
  }, []);

  /** Apply a settled status to the UI. */
  const applyStatus = useCallback(
    (status: 'VERIFIED' | 'FAILED' | 'PENDING') => {
      if (!alive.current) return;
      if (status === 'VERIFIED') {
        toast.success('Identity verified');
        onVerified();
        return;
      }
      if (status === 'FAILED') {
        setPhase('failed');
        setError(
          'Stripe could not verify that document. Check the photo is sharp, unobstructed and ' +
            'not expired, then try again.',
        );
        return;
      }
      setPhase('processing');
      setError(null);
    },
    [onVerified],
  );

  function handleStart() {
    setError(null);
    setPhase('opening');

    startTransition(async () => {
      // EVERY EXIT MUST LEAVE A PHASE THAT HAS A CONTROL ON IT — a thrown SDK error
      // must land on `failed` (which offers a retry), never on a silent spinner.
      try {
        const started = await beginEmbeddedIdentity(returnPath);
        if (!alive.current) return;

        if (!started.ok) {
          if (started.error === 'NOT_SUPPORTED') {
            onUnsupported();
            return;
          }
          setPhase('failed');
          setError(started.message);
          return;
        }

        const { clientSecret, publishableKey } = started.data;
        if (!isRealPublishableKey(publishableKey)) {
          onUnsupported();
          return;
        }

        const stripe = await getStripe(publishableKey);
        if (!alive.current) return;
        if (!stripe) {
          setPhase('failed');
          setError('Could not load Stripe. Check your connection and try again.');
          return;
        }

        // The Stripe-owned modal. Resolves on completion AND on dismissal, so neither
        // outcome is trusted — the read-back below decides.
        const result = await stripe.verifyIdentity(clientSecret);
        if (!alive.current) return;

        if (result.error) {
          // A deliberately closed modal is not a failure worth shouting about.
          if (result.error.code === 'session_cancelled') {
            setPhase('idle');
            return;
          }
          setPhase('failed');
          setError(result.error.message ?? 'The identity check could not be completed.');
          return;
        }

        setPhase('checking');
        applyStatus(await settle());
      } catch (err) {
        if (!alive.current) return;
        setPhase('failed');
        setError(
          err instanceof Error
            ? err.message
            : 'The identity check could not be started. Please try again.',
        );
      }
    });
  }

  function handleRecheck() {
    setError(null);
    setPhase('checking');
    startTransition(async () => {
      try {
        applyStatus(await settle());
      } catch {
        if (!alive.current) return;
        setPhase('failed');
        setError('Could not read your verification status. Please try again.');
      }
    });
  }

  // Stripe is deciding (or has not decided yet). Offer a re-check rather than
  // reopening the whole modal, which would discard a submission in flight.
  if (phase === 'processing') {
    return (
      <div className="space-y-group">
        <div className="rounded-lg border bg-muted/25 p-group" role="status">
          <p className="text-body font-medium text-foreground">
            Stripe is reviewing your document
          </p>
          <p className="mt-tight text-pretty text-meta leading-relaxed text-muted-foreground">
            Usually under a minute. You can leave this page — the result is kept.
          </p>
        </div>
        <div className="flex flex-wrap gap-snug">
          <Button type="button" onClick={handleRecheck}>
            Check again
          </Button>
          <Button type="button" variant="ghost" onClick={handleStart}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  const busy = phase === 'opening' || phase === 'checking';

  return (
    <div className="space-y-group">
      {error ? (
        <p role="alert" className="text-body leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-cozy">
        <Button type="button" onClick={handleStart} disabled={busy} aria-busy={busy}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ScanFace className="size-3.5" aria-hidden />
          )}
          {phase === 'opening'
            ? 'Opening Stripe…'
            : phase === 'checking'
              ? 'Checking…'
              : phase === 'failed'
                ? 'Try again'
                : 'Start identity check'}
        </Button>

        <CustodyNote>
          Your ID and selfie go straight to Stripe. NoDitto only receives the name.
        </CustodyNote>
      </div>
    </div>
  );
}
