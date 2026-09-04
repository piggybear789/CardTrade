'use client';

// components/onboarding/EmbeddedPayoutStep.tsx
//
// The payout step's CONTROLS (unified-seller-onboarding, Req 5). Renders Connect
// onboarding inline via `@stripe/connect-js`, so bank and remaining compliance details
// stay inside Stripe-owned iframes and never reach NoDitto's server (Req 5.3, 5.4).
//
// STARTING IS AN EXPLICIT ACT, NOT A SIDE EFFECT OF RENDERING. `beginEmbeddedPayout`
// creates the seller's Connect account, so kicking it off from a mount effect would
// provision a Stripe account for anyone who merely opened the payouts page. It is
// therefore behind a control the member presses. (An earlier revision did run it on
// mount; that was a real bug, not a style preference.)
//
// Name, date of birth and address are prefilled SILENTLY server-side from the verified
// identity, so there is no confirm/edit screen here (Req 4.7) — Stripe simply does not
// re-ask for what it already holds. The copy says so once, as a benefit, rather than
// showing the values back.
//
// On exit the read-back (`refreshPayoutStatus`) decides readiness; returning from the
// component is not itself proof (Req 6.1).

import { useEffect, useRef, useState, useTransition } from 'react';
// `/pure`, NOT the default entry. The default entry injects the connect.js <script>
// as a MODULE-LOAD side effect, and a `'use client'` component is still rendered on
// the server — where there is no document, so the injection rejects during SSR. The
// pure entry defers loading until `loadConnectAndInitialize` is called, which only
// ever happens inside the click handler below. The type import is erased at compile
// time and carries no side effect, so it can stay on the root specifier.
import { loadConnectAndInitialize } from '@stripe/connect-js/pure';
import type { StripeConnectInstance } from '@stripe/connect-js';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from '@stripe/react-connect-js';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, LandmarkIcon } from '@hugeicons/core-free-icons';

import { beginEmbeddedPayout, refreshPayoutStatus } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CustodyNote } from './OnboardingSpine';
import { isRealPublishableKey } from './stripeBrowser';

type Phase = 'idle' | 'starting' | 'ready' | 'failed';

/**
 * Where a member fixes the field a failure blamed. A "Try again" button is useless when
 * the cause is stored data — retrying sends the same bad value — so a failure carrying a
 * `field` gets a link to the screen that can change it.
 */
const FIELD_FIX: Record<string, { href: string; label: string }> = {
  contactEmail: { href: '/profile', label: 'Update your contact email' },
};

export interface EmbeddedPayoutStepProps {
  /** Raised when the read-back reports settlements enabled. */
  onComplete: () => void;
  /** Raised when the provider has no embedded binding, so the parent can fall back. */
  onUnsupported: () => void;
}

export function EmbeddedPayoutStep({ onComplete, onUnsupported }: EmbeddedPayoutStepProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The offending field, when the failure was caused by stored profile data rather
  // than by something retrying could fix.
  const [errorField, setErrorField] = useState<string | null>(null);
  // No pending flag is read: the two async paths either swap the phase (start) or hand
  // off to the parent (exit), so there is no control left on screen to disable.
  const [, startTransition] = useTransition();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function handleStart() {
    setError(null);
    setErrorField(null);
    setPhase('starting');

    startTransition(async () => {
      // EVERY EXIT FROM HERE MUST LEAVE A PHASE THAT HAS A CONTROL ON IT. An earlier
      // revision could leave this step on a spinner forever; a thrown SDK error must
      // land on `failed` (which renders a retry), never on a silent skeleton.
      try {
        // Mints the first secret AND ensures the (prefilled) account exists.
        const started = await beginEmbeddedPayout();
        if (!alive.current) return;

        if (!started.ok) {
          if (started.error === 'not-supported') {
            onUnsupported();
            return;
          }
          setPhase('failed');
          setError(started.message);
          setErrorField(started.field ?? null);
          return;
        }

        const { publishableKey, clientSecret } = started.data;
        if (!isRealPublishableKey(publishableKey)) {
          onUnsupported();
          return;
        }

        let usedFirst = false;
        const instance = loadConnectAndInitialize({
          publishableKey,
          // The SDK calls this to (re)fetch a secret. The first render reuses the one we
          // just minted; later calls mint a FRESH secret (Req 13.4) — account creation is
          // idempotent, so this only re-reads and re-mints.
          fetchClientSecret: async () => {
            if (!usedFirst) {
              usedFirst = true;
              return clientSecret;
            }
            const again = await beginEmbeddedPayout();
            if (!again.ok) throw new Error(again.message);
            return again.data.clientSecret;
          },
          appearance: { variables: { borderRadius: '8px' } },
        });

        if (!alive.current) return;
        setConnectInstance(instance);
        setPhase('ready');
      } catch (err) {
        if (!alive.current) return;
        setPhase('failed');
        setError(
          err instanceof Error
            ? err.message
            : 'Could not open payout setup. Check your connection and try again.',
        );
      }
    });
  }

  /**
   * A failure INSIDE the embedded component, which `handleStart`'s try/catch cannot
   * see: `loadConnectAndInitialize` returns synchronously and the script load, the
   * secret fetch and the iframe boot all resolve later, on promise chains the SDK owns
   * and does not hand back. Without this the member watched an empty panel while the
   * console filled with unhandled rejections. Falls back to `failed`, which is the one
   * phase that renders a retry.
   */
  function handleLoadError({ error }: { error: { type: string; message?: string } }) {
    if (!alive.current) return;
    setConnectInstance(null);
    setPhase('failed');
    setError(
      error.message ??
        'Stripe’s payout form could not load. Check your connection or any script ' +
          'blocker and try again.',
    );
  }

  function handleExit() {
    startTransition(async () => {
      const refreshed = await refreshPayoutStatus();
      if (!alive.current) return;
      if (!refreshed.ok) {
        setError(refreshed.message);
        return;
      }
      if (refreshed.data.settlementsEnabled) {
        
        onComplete();
        return;
      }
      setError(
        'Stripe still needs a few details before you can be paid. Pick up where you left off ' +
          'above — nothing you entered is lost.',
      );
    });
  }

  if (phase === 'idle' || phase === 'failed') {
    const fix = errorField ? FIELD_FIX[errorField] : undefined;

    return (
      <div className="space-y-group">
        {error ? (
          <div className="space-y-snug rounded-lg border border-destructive/40 bg-destructive/5 p-group">
            <p role="alert" className="text-body leading-relaxed text-destructive">
              {error}
            </p>
            {/* A stored-data failure needs the screen that can change it, not a retry
                that would resend the same value. */}
            {fix ? (
              <Button asChild size="sm" variant="outline">
                <Link href={fix.href}>
                  {fix.label}
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-cozy">
          <Button
            type="button"
            onClick={handleStart}
            variant={fix ? 'outline' : 'default'}
          >
            <HugeiconsIcon icon={LandmarkIcon} className="size-3.5" aria-hidden />
            {phase === 'failed' ? 'Try again' : 'Add payout details'}
          </Button>

          <CustodyNote>Your bank details go straight to Stripe.</CustodyNote>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-group">
      {error ? (
        <p role="alert" className="text-body leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      {/* Reserves height while the iframe boots, so the step does not jump when
          Stripe's form paints. Keyed off the PHASE alone: deriving the skeleton from
          `!connectInstance` would render it forever if the instance were ever missing
          in a phase that implies one. */}
      {phase === 'starting' ? (
        <div className="space-y-cozy" role="status" aria-label="Loading payout setup">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : connectInstance ? (
        /* FRAMED. The embedded component paints on a transparent background with no
           edge of its own, so unframed it bled into the dialog and its headings read as
           ours. The border makes the boundary between our page and Stripe's form
           visible, which is also the honest reading: everything inside it is theirs. */
        <div className="min-h-[22rem] rounded-xl border bg-muted/25 p-4">
          <ConnectComponentsProvider connectInstance={connectInstance}>
            <ConnectAccountOnboarding onExit={handleExit} onLoadError={handleLoadError} />
          </ConnectComponentsProvider>
        </div>
      ) : null}

      {/* No manual "check status" control. Stripe's own `onExit` is the completion
          signal and it drives the same `refreshPayoutStatus` read-back, so a button
          beside the form was a second way to do what finishing the form already does. */}
    </div>
  );
}
