'use client';

// components/profile/PayoutOnboarding.tsx
//
// Seller payout onboarding (Req 3.9, 4.8-4.12). Two states in one card:
//
//   No account yet  -> one button that creates the Connect account and redirects
//                      to the provider's hosted setup in a single action.
//   Account exists   -> resume the hosted flow, or re-read status. Once the
//                      provider reports transfers active, the provider-reported
//                      name is available for the limited buyer disclosure.
//
// THIS IS STEP TWO, NOT THE IDENTITY_GATE. Until 0069 it was both, and this comment
// used to say so. Connect now gates only whether a member can RECEIVE money
// (`canReceiveFunds`); listing, selling, trade access and being a disclosed seller
// are gated by the identity check in `IdentityCheckCard`. Do not re-merge them: the
// reason to split was that Connect can defer document collection, so this card could
// never honestly claim a government ID or selfie had been checked.
//
// It must also not call an account "Verified" while `settlementsEnabled` is false —
// an empty Connect shell is not a finished setup, and saying so was the reason this
// card read "Verified Account / Payouts incomplete" at the same time.
//
// WHAT WE NO LONGER ASK FOR. The provider collects payout and bank details on its
// own pages. There are now NO local inputs at all: the optional shop name was
// display-only data sitting in the verification path, and the consent checkbox is
// stated next to the button that acts on it. Card or bank data must never enter
// this component.

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

import {
  createPayoutOnboardingLink,
  refreshPayoutStatus,
  startIdentityVerification,
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

const STATUS_BADGE: Record<
  MerchantStateData['merchantStatus'],
  { label: string; variant: BadgeProps['variant'] }
> = {
  NONE: { label: 'Setup required', variant: 'secondary' },
  PENDING: { label: 'Setup in progress', variant: 'secondary' },
  APPROVED: { label: 'Payouts active', variant: 'default' },
  REJECTED: { label: 'Action needed', variant: 'destructive' },
};

export function PayoutOnboarding({
  context,
  compact = false,
}: {
  context: PayoutSetupContext;
  compact?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState(context.state);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const needsPayoutCompletion = Boolean(state.merchantRef) && !state.settlementsEnabled;
  const needsSetup = !state.merchantRef || state.merchantStatus === 'REJECTED';
  // An account shell with transfers still inactive is an UNFINISHED setup, never a
  // verified one. `settlementsEnabled` is the only signal that Stripe has finished.
  const badge = needsPayoutCompletion
    ? { label: 'Setup incomplete', variant: 'secondary' as const }
    : (STATUS_BADGE[state.merchantStatus] ?? STATUS_BADGE.NONE);

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

  /**
   * Create the Connect account and open the provider's hosted setup in one action.
   * Pressing this is the buyer-disclosure consent (Req 4.8-4.12), stated below it.
   */
  function handleStart() {
    setError(null);

    startTransition(async () => {
      const result = await startIdentityVerification();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.data.url) {
        // Full navigation, not a router push: the destination is off-origin.
        window.location.assign(result.data.url);
        return;
      }
      // No hosted flow (MockService): creating the account was the whole flow.
      const refreshed = await refreshPayoutStatus();
      if (refreshed.ok) setState(refreshed.data);
      router.refresh();
      toast.success('Payout setup submitted.');
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
        result.data.settlementsEnabled
          ? 'Payouts are active. You can receive funds through Stripe.'
          : 'Stripe has not finished your setup yet. Continue with Stripe to complete it.',
      );
      router.refresh();
    });
  }

  if (compact && Boolean(state.merchantRef)) {
    return (
      <Card id="payout-setup" className="h-full scroll-mt-24">
        <CardHeader className="pb-3">
          {/* SAYS PAYOUT DESTINATION, NOT "Merchant identity". Connect answers where
              money goes; it says nothing about who the member is since 0069. */}
          <CardDescription>Payout destination</CardDescription>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {state.settlementsEnabled ? (
                <ShieldCheck className="size-4 shrink-0 text-trust" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {/* NEVER "Verified Account". That wording is the 0060 mistake this card
                  is named in `product.md` for making — it once read "Verified Account"
                  beside "Payouts incomplete" because both were true of one row. Since
                  0069 it is worse than confusing: "verified" now means the identity
                  check, and a member can be payable WITHOUT having passed it, so this
                  title would have claimed a verification Stripe never performed. */}
              {state.settlementsEnabled ? 'Payouts active' : 'Stripe Connect'}
            </CardTitle>
            <Badge variant={state.settlementsEnabled ? 'default' : 'secondary'}>
              {state.settlementsEnabled ? 'Ready' : 'Setup incomplete'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Payout name</dt>
              <dd className="min-w-0 truncate text-right font-medium">
                {state.legalEntityName ?? 'Awaiting Stripe name'}
              </dd>
            </div>
            {state.tradingName ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Store</dt>
                <dd className="min-w-0 truncate text-right font-medium">{state.tradingName}</dd>
              </div>
            ) : null}
            {state.settlementsEnabled && state.identityVerifiedAt ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Active since</dt>
                <dd className="font-medium">
                  {new Date(state.identityVerifiedAt).toLocaleDateString('en-AU')}
                </dd>
              </div>
            ) : null}
          </dl>
          {context.hostedOnboarding ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openHostedOnboarding}
              disabled={isPending}
              className="w-full"
            >
              {isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ExternalLink className="size-3.5" aria-hidden />
              )}
              {needsPayoutCompletion ? 'Continue with Stripe' : 'Manage with Stripe'}
            </Button>
          ) : null}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    // `id` is the anchor target for `/profile/payouts#payout-setup`.
    <Card id="payout-setup" className="h-full scroll-mt-24">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="size-4 shrink-0 text-trust" aria-hidden />
              Stripe Connect
            </CardTitle>
            <CardDescription>
              {/* SAYS PAYOUTS, NOT ACCESS. This read "Required before you can list,
                  sell, or trade", which after 0069 is the IDENTITY card's claim — and
                  `IdentityCheckCard` makes it. Two cards asserting the same
                  requirement is the "two answers to one question" failure the docs
                  warn about, and here only one of them was true. */}
              Required before you can receive money.
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {state.merchantStatus === 'APPROVED' && !needsPayoutCompletion ? (
          <div className="space-y-3">
            {/* PLAIN TEXT, NO NESTED BOX — see the same note in IdentityCheckCard.
                The card is the container; this note does not need a second one. */}
            <div className="space-y-0.5 text-sm leading-snug">
              <p className="font-medium text-foreground">This is what buyers may see</p>
              <p className="text-muted-foreground">
                Your provider-reported name may be disclosed to a buyer for an agreed sale.
                NoDitto never shows your address or bank details.
              </p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Payout account name</dt>
                <dd className="break-words font-medium">
                  {state.legalEntityName ?? 'Awaiting provider name'}
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
                  <dt className="text-muted-foreground">Payouts active</dt>
                  <dd>{new Date(state.identityVerifiedAt).toLocaleDateString('en-AU')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {needsPayoutCompletion ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Stripe has not finished your setup yet, so you cannot be paid. Continue
              with Stripe to complete it — you will pick up where you left off.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openHostedOnboarding} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : (
                  <ExternalLink className="size-3.5" aria-hidden />
                )}
                Continue with Stripe
              </Button>
              <Button variant="outline" onClick={handleRecheck} disabled={isPending}>
                <RefreshCw className="size-3.5" aria-hidden />
                Check status
              </Button>
            </div>
          </div>
        ) : null}

        {needsSetup ? (
          <div className="space-y-4">
            {state.merchantStatus === 'REJECTED' ? (
              <p className="flex gap-2 text-sm text-destructive">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Payout setup did not complete last time. You can start again.
              </p>
            ) : null}

            {/* No standalone explainer paragraph here. It said "Verify through
                Stripe Connect to list, sell, and trade. It takes one step and happens
                entirely on Stripe's pages" — which restated the card title, repeated
                "on Stripe's pages" from the note below, and duplicated what the
                description now carries. Three blocks of prose around one button read
                as a wall; the two that remain each say something the other does not. */}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="button" onClick={handleStart} disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : (
                <BadgeCheck className="size-3.5" aria-hidden />
              )}
              {context.hostedOnboarding ? 'Verify with Stripe' : 'Submit payout setup'}
            </Button>

            {/* Req 4.8-4.12: continuing is the consent, so it is stated here, next to
                the control that gives it. The second sentence is that consent and is
                deliberately left verbatim — the first now also carries the "one step,
                on Stripe's pages" reassurance the deleted paragraph was making. */}
            <p className="text-xs text-muted-foreground">
              One step, entirely on Stripe&apos;s pages — NoDitto never sees your bank
              details. You agree that the payout name Stripe reports can be shown to
              someone you have an agreed sale or trade with.
            </p>
          </div>
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
