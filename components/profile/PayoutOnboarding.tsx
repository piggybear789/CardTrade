'use client';

// components/profile/PayoutOnboarding.tsx
//
// Seller payout onboarding (Req 3.9, 4.8-4.12). Three states in one card:
//
//   NONE / REJECTED -> a consent gate, then a redirect into the provider's own
//     hosted onboarding flow.
//   PENDING         -> "finish setup" (a fresh link) plus a status re-check.
//   APPROVED        -> the exact identity buyers see at checkout.
//
// WHAT WE NO LONGER ASK FOR. This used to be a three-step, fifteen-field form
// collecting BSB, account number, ABN/ACN, date of birth and residential
// address, because Stripe required all of it in the request body and offered no
// tokenised alternative for a settlement account. The provider now collects and
// verifies every one of those fields on its own pages, so the only thing left
// here is the disclosure consent and an optional shop name.
//
// The identity shown to Buyers is the provider's VERIFIED legal name — checked
// against a government document — not a value the Seller typed. That is why this
// component never renders an editable legal-name field.

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, ExternalLink, Loader2, RefreshCw, ShieldAlert, Wallet } from 'lucide-react';

import { DittoShieldMark } from '@/components/brand/DittoShieldMark';
import {
  createPayoutOnboardingLink,
  refreshPayoutStatus,
  submitMerchantOnboarding,
  type MerchantStateData,
  type PayoutSetupContext,
} from '@/lib/actions/merchant';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUS_BADGE: Record<
  MerchantStateData['merchantStatus'],
  { label: string; variant: BadgeProps['variant'] }
> = {
  NONE: { label: 'Not set up', variant: 'secondary' },
  PENDING: { label: 'Verifying', variant: 'secondary' },
  APPROVED: { label: 'Verified', variant: 'default' },
  REJECTED: { label: 'Action needed', variant: 'destructive' },
};

export function PayoutOnboarding({ context }: { context: PayoutSetupContext }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState(context.state);
  const [consent, setConsent] = useState(false);
  const [tradingName, setTradingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const badge = STATUS_BADGE[state.merchantStatus] ?? STATUS_BADGE.NONE;
  const needsSetup = state.merchantStatus === 'NONE' || state.merchantStatus === 'REJECTED';

  // Returning from the provider does NOT prove the Seller can be paid, so re-read
  // the authoritative state rather than assuming success. `payouts=refresh` means
  // the link expired mid-flow, so a new one is needed.
  const returned = searchParams.get('payouts');
  useEffect(() => {
    if (returned !== 'complete' && returned !== 'refresh') return;
    startTransition(async () => {
      const result = await refreshPayoutStatus();
      if (result.ok) setState(result.data);
      if (returned === 'refresh') {
        setError('That setup link expired. Start it again to pick up where you left off.');
      }
    });
    // Only react to the redirect marker itself.
  }, [returned]);

  /** Send the Seller into the provider's hosted flow. */
  function openHostedOnboarding() {
    startTransition(async () => {
      const link = await createPayoutOnboardingLink();
      if (!link.ok) {
        setError(link.message);
        return;
      }
      // Full navigation, not a router push: the destination is off-origin.
      window.location.assign(link.data.url);
    });
  }

  function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!consent) {
      setError('Buyers must be able to see who they are paying, so this is required.');
      return;
    }

    startTransition(async () => {
      const result = await submitMerchantOnboarding({
        tradingName: tradingName.trim() || undefined,
        buyerDisclosureConsent: true,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setState(result.data);
      router.refresh();

      if (!context.hostedOnboarding) {
        toast.success('Payout setup submitted.');
        return;
      }
      openHostedOnboarding();
    });
  }

  function handleRecheck() {
    startTransition(async () => {
      const result = await refreshPayoutStatus();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setState(result.data);
      toast.success(
        result.data.merchantStatus === 'APPROVED'
          ? 'Payouts are ready.'
          : 'Still verifying — we will update this automatically.',
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4" aria-hidden />
              Getting paid
            </CardTitle>
            <CardDescription>
              Verify who you are so buyers know who they are paying, and so cash
              can reach your bank account.
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {state.merchantStatus === 'APPROVED' ? (
          <div className="space-y-3">
            <div className="flex gap-3 rounded-lg border px-3 py-2.5">
              <DittoShieldMark className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 space-y-0.5 text-sm leading-snug">
                <p className="font-medium text-foreground">This is what buyers see</p>
                <p className="text-muted-foreground">
                  Verified against your government ID. Your address, date of
                  birth and bank details are never shown.
                </p>
              </div>
            </div>
            <dl className="grid gap-2 text-sm">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Verified name</dt>
                <dd className="break-words font-medium">
                  {state.legalEntityName ?? 'Awaiting verified name'}
                </dd>
              </div>
              {state.tradingName ? (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Store</dt>
                  <dd className="break-words font-medium">{state.tradingName}</dd>
                </div>
              ) : null}
              {state.identityVerifiedAt ? (
                <div>
                  <dt className="text-muted-foreground">Verified</dt>
                  <dd>{new Date(state.identityVerifiedAt).toLocaleDateString('en-AU')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {state.merchantStatus === 'PENDING' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Verification is in progress. If you did not finish every step, pick
              up where you left off.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openHostedOnboarding} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : (
                  <ExternalLink className="size-3.5" aria-hidden />
                )}
                Finish payout setup
              </Button>
              <Button variant="outline" onClick={handleRecheck} disabled={isPending}>
                <RefreshCw className="size-3.5" aria-hidden />
                Check status
              </Button>
            </div>
          </div>
        ) : null}

        {needsSetup ? (
          <form onSubmit={handleStart} className="space-y-4">
            {state.merchantStatus === 'REJECTED' ? (
              <p className="flex gap-2 text-sm text-destructive">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Verification did not pass last time. You can start again.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="tradingName">Store name (optional)</Label>
              <Input
                id="tradingName"
                name="tradingName"
                value={tradingName}
                onChange={(event) => setTradingName(event.target.value)}
                disabled={isPending}
                placeholder="e.g. Harbour City Cards"
              />
              <p className="text-xs text-muted-foreground">
                Shown alongside your verified name. Leave blank to sell under your
                own name.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="buyerDisclosureConsent"
                className="mt-0.5 size-4 shrink-0"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={isPending}
              />
              <span className="text-muted-foreground">
                I agree that buyers can see my verified name before they pay me.
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : (
                <BadgeCheck className="size-3.5" aria-hidden />
              )}
              {context.hostedOnboarding ? 'Verify my identity' : 'Submit payout setup'}
            </Button>

            <p className="text-xs text-muted-foreground">
              You will be taken to our payment provider to confirm your identity
              and bank account. NoDitto never sees your bank details.
            </p>
          </form>
        ) : null}

        {error && !needsSetup ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
