'use client';

// components/payments/AddPaymentMethodForm.tsx
//
// The card entry form itself, without any Dialog wrapper. Reusable inline:
// embedded inside BuyButton's dialog (step 1) and inside AddPaymentMethodDialog.
//
// PCI SCOPE. The card fields are rendered by Stripe inside its own iframe via
// Payment Element, so no card number, expiry, or CVC exists in this component's
// state, in our DOM, or in any validation code here. That is a deliberate
// reduction from the previous CaptureJS arrangement, which rendered our own card
// inputs and validated them before tokenising.
//
// Flow: beginCardSetup() -> mount Payment Element against the returned
// SetupIntent -> stripe.confirmSetup() -> completeCardSetup(setupId), which reads
// the vaulted card back FROM Stripe so the saved-method label cannot be spoofed.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Icon } from '@/components/ui/icon';
import { CircleNotchIcon, LockIcon, ShieldCheckIcon } from '@/components/ui/icons';

import { beginCardSetup, completeCardSetup } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';

/**
 * Sentinel publishable key returned by the MockService. Stripe.js would reject
 * it, so mock mode renders a simulated step instead of mounting Payment Element.
 */
const MOCK_PUBLISHABLE_KEY = 'pk_test_mock';

/** One Stripe.js load per publishable key, shared across mounts. */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(publishableKey: string): Promise<Stripe | null> {
  let cached = stripeCache.get(publishableKey);
  if (!cached) {
    cached = loadStripe(publishableKey);
    stripeCache.set(publishableKey, cached);
  }
  return cached;
}

/**
 * Save the confirmed setup. Only the opaque setup id goes to the server, plus the
 * platform when the card is for a sale on another one (0179).
 */
function saveCard(setupId: string, platform: string | null | undefined) {
  return platform ? completeCardSetup(setupId, { platform }) : completeCardSetup(setupId);
}

interface SetupSession {
  setupId: string;
  clientSecret: string;
  publishableKey: string;
}

export interface AddPaymentMethodFormProps {
  /** Called after a card is successfully attached. */
  onAttached?: () => void;
  /**
   * The PLATFORM the card is for (`platformForCurrency` of the sale's or listing's
   * currency), so a card for a purchase from a seller on another platform is saved
   * there (0179). Omit for the member's own platform. The server decides; an
   * unusable value falls back to the member's own.
   */
  platform?: string | null;
}

export function AddPaymentMethodForm({ onAttached, platform }: AddPaymentMethodFormProps) {
  const [session, setSession] = useState<SetupSession | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await (platform ? beginCardSetup({ platform }) : beginCardSetup());
      if (cancelled) return;
      if (result.ok) setSession(result.data);
      else setConfigError(result.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [retryCount, platform]);

  const stripePromise = useMemo(
    () =>
      session && session.publishableKey !== MOCK_PUBLISHABLE_KEY
        ? getStripe(session.publishableKey)
        : null,
    [session],
  );

  if (configError) {
    return (
      <div className="space-y-group">
        <p role="alert" className="text-body text-destructive">
          {configError}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            setConfigError(null);
            setRetryCount((c) => c + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!session) return null;

  // Mock provider: no real Stripe.js, so offer a simulated save so local UI
  // demos keep working without credentials.
  if (!stripePromise) {
    return <SimulatedCardSetup setupId={session.setupId} onAttached={onAttached} platform={platform} />;
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: session.clientSecret,
        appearance: { theme: 'flat', variables: { borderRadius: '0.5rem' } },
      }}
    >
      <CardSetupFields setupId={session.setupId} onAttached={onAttached} platform={platform} />
    </Elements>
  );
}

/** The Payment Element and submit handling, inside the Elements provider. */
function CardSetupFields({
  setupId,
  onAttached,
  platform,
}: {
  setupId: string;
  onAttached?: () => void;
  platform?: string | null;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!stripe || !elements) {
      setError('Secure card entry is not ready yet. Please wait a moment.');
      return;
    }

    startTransition(async () => {
      // Stripe validates and confirms against its own fields; `if_required`
      // keeps the user in the dialog unless the issuer demands a 3DS redirect.
      const confirmed = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      });

      if (confirmed.error) {
        setError(confirmed.error.message ?? 'The card could not be verified.');
        return;
      }

      const saved = await saveCard(setupId, platform);
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      onAttached?.();
    });
  }

  const busy = isPending || !ready;

  return (
    <form onSubmit={handleSubmit} className="space-y-group">
      {/* Stripe needs the node laid out to initialise, so it cannot be hidden with
          `display:none` until ready (`onReady` would never fire). The min height
          stops the dialog collapsing while the iframe grows. */}
      <div className={ready ? undefined : 'min-h-60'}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: 'tabs', fields: { billingDetails: { name: 'auto' } } }}
        />
      </div>

      <Button type="submit" disabled={busy} aria-busy={busy} className="w-full">
        {busy ? <Icon icon={CircleNotchIcon} className="animate-spin" aria-hidden /> : null}
        {!ready ? 'Loading secure checkout…' : isPending ? 'Saving…' : (
          <>
            <Icon icon={LockIcon} className="size-3.5" aria-hidden />
            Save card
          </>
        )}
      </Button>

      {/* Below the submit, so a declined card does not push the button down out from
          under the pointer that pressed it. */}
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}

      <ProcessorNote />
    </form>
  );
}

/**
 * Mock-provider stand-in. Mounting Payment Element needs a real SetupIntent, so
 * with `PAYMENTS_PROVIDER=mock` there is nothing to mount — this saves a
 * deterministic fake card so the rest of the UI can be demonstrated.
 */
function SimulatedCardSetup({
  setupId,
  onAttached,
  platform,
}: {
  setupId: string;
  onAttached?: () => void;
  platform?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const saved = await saveCard(setupId, platform);
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      onAttached?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-group">
      <div className="rounded-lg bg-muted/80 px-cozy py-snug text-body" role="note">
        <p className="font-medium text-foreground">Simulated card entry</p>
        <p className="text-muted-foreground">
          No payment provider is configured, so saving adds a demo card (Visa
          •••• 4242) without contacting anyone.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} aria-busy={isPending} className="w-full">
        {isPending ? <Icon icon={CircleNotchIcon} className="animate-spin" aria-hidden /> : null}
        {isPending ? 'Saving…' : 'Save demo card'}
      </Button>
    </form>
  );
}

function ProcessorNote() {
  return (
    <p className="flex items-start justify-center gap-tight text-center text-body text-muted-foreground">
      <Icon icon={ShieldCheckIcon} className="mt-0.5 size-3.5 shrink-0 text-trust" aria-hidden />
      <span>
        Payments processed by{' '}
        <a
          href="https://stripe.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Stripe
        </a>
        . Card data is not stored on NoDitto.
      </span>
    </p>
  );
}
