'use client';

// components/payments/AddPaymentMethodForm.tsx
//
// The card entry form itself, without any Dialog wrapper. Reusable inline:
// embedded inside BuyButton's dialog (step 1) and inside AddPaymentMethodDialog.
// Card details never leave the browser as plaintext — only the CaptureJS token
// reaches the server.

import { useEffect, useState, useTransition } from 'react';
import { CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';

import { attachPaymentSource, getTokenisationConfig } from '@/lib/actions/payments';
import { usePinchCapture } from './usePinchCapture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Detect card network from the leading digits. */
function detectCardBrand(cardNumber: string): string {
  if (/^4/.test(cardNumber)) return 'Visa';
  if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) return 'Mastercard';
  if (/^3[47]/.test(cardNumber)) return 'Amex';
  return 'Card';
}

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 12 }, (_, i) => String(CURRENT_YEAR + i));

export interface AddPaymentMethodFormProps {
  /** Called after a card is successfully attached. */
  onAttached?: () => void;
}

export function AddPaymentMethodForm({ onAttached }: AddPaymentMethodFormProps) {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [cardHolderName, setCardHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryMonth, setExpiryMonth] = useState(MONTHS[0]);
  const [expiryYear, setExpiryYear] = useState(YEARS[0]);
  const [cvc, setCvc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { status: captureStatus, capture, error: captureError } = usePinchCapture(publishableKey);

  // Fetch the publishable key on mount.
  useEffect(() => {
    if (publishableKey || configError) return;
    startTransition(async () => {
      const result = await getTokenisationConfig();
      if (result.ok) {
        setPublishableKey(result.data.publishableKey);
        setEnvironment(result.data.environment);
      } else {
        setConfigError(result.message);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!capture) {
      setError('The card entry library is not ready yet. Please wait a moment.');
      return;
    }
    const digitsOnlyCard = cardNumber.replace(/\s+/g, '');
    if (digitsOnlyCard.length < 12) {
      setError('Enter a valid card number.');
      return;
    }
    if (!/^\d{3,4}$/.test(cvc)) {
      setError('Enter a valid CVC.');
      return;
    }
    if (!cardHolderName.trim()) {
      setError('Enter the name on the card.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await capture.createToken({
          sourceType: 'credit-card',
          cardNumber: digitsOnlyCard,
          expiryMonth,
          expiryYear,
          cvc,
          cardHolderName: cardHolderName.trim(),
        });

        const attached = await attachPaymentSource(result.token, 'credit-card', {
          last4: digitsOnlyCard.slice(-4),
          brand: detectCardBrand(digitsOnlyCard),
        });
        if (!attached.ok) {
          setError(attached.message);
          return;
        }

        onAttached?.();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'The card could not be verified. Check the details and try again.',
        );
      }
    });
  }

  const isLoadingCapture = captureStatus === 'loading';
  const captureUnavailable = captureStatus === 'error' || Boolean(configError);
  const busy = isPending || isLoadingCapture;

  const brand = detectCardBrand(cardNumber.replace(/\s+/g, ''));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        className={cn(
          'flex gap-3 rounded-lg border px-3 py-2.5 cardtrade-trust-mark',
        )}
        role="note"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-trust" aria-hidden />
        <div className="min-w-0 space-y-0.5 text-sm leading-snug">
          <p className="font-medium text-foreground">
            Encrypted card entry — secured by Pinch Payments
          </p>
          <p className="text-muted-foreground">
            Your card number is tokenised in the browser. We never store the
            full number on our servers.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Accepted cards">
        {(['Visa', 'Mastercard', 'Amex'] as const).map((name) => (
          <span
            key={name}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground',
              brand === name && 'border-trust/40 text-foreground',
            )}
          >
            <CreditCard className="size-3.5" aria-hidden />
            {name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          <Lock className="size-3 text-gold" aria-hidden />
          TLS encrypted
        </span>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pm-name">Name on card</Label>
        <Input
          id="pm-name"
          autoComplete="cc-name"
          value={cardHolderName}
          onChange={(e) => setCardHolderName(e.target.value)}
          disabled={busy}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pm-number">Card number</Label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-gold"
            aria-hidden
          />
          <Input
            id="pm-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="•••• •••• •••• ••••"
            className="pl-9"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        {environment === 'test' ? (
          <p className="text-xs text-muted-foreground">
            Test mode: use 4242 4242 4242 4242 with any future expiry and CVC.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor="pm-month">Month</Label>
          <select
            id="pm-month"
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground"
            value={expiryMonth}
            onChange={(e) => setExpiryMonth(e.target.value)}
            disabled={busy}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pm-year">Year</Label>
          <select
            id="pm-year"
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground"
            value={expiryYear}
            onChange={(e) => setExpiryYear(e.target.value)}
            disabled={busy}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pm-cvc">CVC</Label>
          <Input
            id="pm-cvc"
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            value={cvc}
            onChange={(e) => setCvc(e.target.value)}
            disabled={busy}
            required
          />
        </div>
      </div>

      {captureUnavailable ? (
        <p role="alert" className="text-sm text-destructive">
          {configError ?? captureError ?? 'Card entry is not available right now.'}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy || captureUnavailable} aria-busy={busy} className="w-full">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {isLoadingCapture ? (
          'Loading secure checkout…'
        ) : isPending ? (
          'Saving…'
        ) : (
          <>
            <Lock className="size-3.5" aria-hidden />
            Save with Pinch Payments
          </>
        )}
      </Button>

      <p className="flex items-start justify-center gap-1.5 text-center text-[0.6875rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-trust" aria-hidden />
        <span>
          Payments processed by{' '}
          <a
            href="https://getpinch.com.au"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Pinch Payments
          </a>
          . Card data is not stored on NoDitto.
        </span>
      </p>
    </form>
  );
}
