'use client';

// app/onboarding/page.tsx
//
// Required post-signup onboarding presented as one focused modal wizard:
//   1. Welcome — explain how NoDitto protects cash sales and trades
//   2. Alias — choose the public display name shown to other members
//   3. Intent — buyer enters card setup; seller goes straight to Stripe Connect
//   4. Card Setup (buyer only, skippable) — Stripe Payment Element for vaulting a card
//
// The modal intentionally has no dismiss control. `onboarding_completed_at` gates
// protected app entry, so a member completes the short flow or signs out.
//
// "Verify Identity" REDIRECTS TO THE PROVIDER, it does not route to /profile. It
// used to push `/profile#identity` — a page with no such anchor — where the member
// then had to save an optional shop name before a second click would finally open
// Stripe. Three clicks and a dead-end anchor stood between asking to verify and
// the only screen that can verify anything.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';

import { completeOnboarding } from '@/lib/actions/profile';
import { startIdentityVerification } from '@/lib/actions/merchant';
import { AddPaymentMethodForm } from '@/components/payments/AddPaymentMethodForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Step = 'welcome' | 'username' | 'intent' | 'card-setup';
type Intent = 'buyer' | 'seller' | null;

const STEPS: Step[] = ['welcome', 'username', 'intent'];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [intent, setIntent] = useState<Intent>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);

  function goBack() {
    const previous = STEPS[stepIndex - 1];
    if (previous) {
      setError(null);
      setStep(previous);
    }
  }

  function handleUsernameContinue() {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('Pick a name with at least 2 characters.');
      return;
    }

    setError(null);
    setStep('intent');
  }

  async function handleIntentContinue() {
    if (!intent) return;

    setSaving(true);
    setError(null);
    const result = await completeOnboarding(displayName.trim());

    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }

    if (intent === 'seller') {
      // Create the Connect recipient account and mint a hosted link in one call,
      // then leave the app. Pressing this button is the buyer-disclosure consent
      // (Req 4.8-4.12), which is why the disclosure is rendered directly below it.
      const verification = await startIdentityVerification('/profile/payouts');

      if (verification.ok && verification.data.url) {
        // Full navigation, not a router push: the destination is off-origin.
        window.location.assign(verification.data.url);
        return;
      }

      // No hosted flow (MockService) or the link could not be minted. Land on the
      // setup card so the member can retry, rather than stranding them here.
      if (!verification.ok) toast.error(verification.message);
      router.push('/profile/payouts#identity');
    } else {
      // Buyer path: offer card setup before entering the marketplace.
      setSaving(false);
      setStep('card-setup');
    }
  }

  function handleCardSetupComplete() {
    toast.success('Payment method saved! Browse listings and find something you love.');
    router.push('/listings');
  }

  function handleSkipCardSetup() {
    toast.success('Welcome! You can add a card later from your profile.');
    router.push('/listings');
  }

  return (
    <main className="min-h-dvh bg-muted/30" aria-label="Member onboarding">
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          mobile="center"
          animation="fade"
          showClose={false}
          className="w-[calc(100%-2rem)] max-w-lg p-5 sm:p-6"
        >
          {step === 'welcome' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">Welcome to NoDitto</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  Two ways to transact, both designed to protect both sides.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="eligibility-onboarding-title"
                >
                  <h2 id="eligibility-onboarding-title" className="text-sm font-semibold">
                    All Sellers and Traders Are Verified Through Stripe
                  </h2>
                  <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                    Sellers and traders complete Stripe Connect payout onboarding before they can list, sell, receive money, or enter a trade. Confirmed fraud permanently bans the responsible individual.
                  </p>
                </section>

                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="cash-sale-onboarding-title"
                >
                  <h2 id="cash-sale-onboarding-title" className="text-sm font-semibold">
                    Buy & Sell with Payment Protection
                  </h2>
                  <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                    Buyer pays upfront; NoDitto holds the proceeds until delivery and inspection resolve, then pays the seller.
                  </p>
                </section>

                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="trade-onboarding-title"
                >
                  <h2 id="trade-onboarding-title" className="text-sm font-semibold">
                    Trade with Collateral
                  </h2>
                  <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                    Both parties agree on a trade value, backed by a temporary card authorization on each side. No cash changes hands - holds are released after a successful trade is confirmed.
                  </p>
                </section>
              </div>

              <Button type="button" onClick={() => setStep('username')} className="w-full" size="lg">
                Get started
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          ) : null}

          {step === 'username' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">Choose your username</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  This is how other members see you.  
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. PokeTrader99, Phil Y."
                  maxLength={255}
                  autoFocus
                  autoComplete="off"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleUsernameContinue();
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'name-error' : undefined}
                />
                {error ? (
                  <p id="name-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={goBack} className="flex-1">
                  <ArrowLeft className="mr-2 size-4" aria-hidden />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleUsernameContinue}
                  disabled={!displayName.trim()}
                  className="flex-1"
                >
                  Continue
                  <ArrowRight className="ml-2 size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'intent' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">What brings you here?</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  You can always do both later. This only gets your first path ready.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setIntent('buyer')}
                  className={cn(
                    'flex items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                    intent === 'buyer'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:border-foreground/20 hover:bg-muted/50',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                    <ShoppingBag className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">I want to buy</span>
                    <span className="block text-sm text-muted-foreground">
                      Browse and purchase collectibles from other members.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIntent('seller')}
                  className={cn(
                    'flex items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                    intent === 'seller'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:border-foreground/20 hover:bg-muted/50',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                    <Store className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">I want to sell or trade</span>
                    <span className="block text-sm text-muted-foreground">
                      List items, accept offers, and get paid securely.
                    </span>
                  </span>
                </button>
              </div>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={goBack} disabled={saving} className="flex-1">
                  <ArrowLeft className="mr-2 size-4" aria-hidden />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleIntentContinue}
                  disabled={!intent || saving}
                  className="flex-1"
                >
                  {saving
                    ? intent === 'seller'
                      ? 'Opening Stripe…'
                      : 'Saving…'
                    : intent === 'seller'
                      ? 'Verify Identity'
                      : 'Next'}
                  <ArrowRight className="ml-2 size-4" aria-hidden />
                </Button>
              </div>

              {/*
                The buyer-disclosure consent (Req 4.8-4.12). Continuing IS the
                consent, so it is stated here rather than collected as a checkbox
                on a later screen.
              */}
              {intent === 'seller' ? (
                <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                  Continuing opens Stripe Connect, which collects your payout and bank
                  details on its own pages — NoDitto never sees them. You agree that the
                  payout name Stripe reports can be shown to someone you have an agreed
                  sale or trade with.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'card-setup' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">Add a payment card</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  A saved card lets you buy instantly or enter trade escrow.
                  You can always add one later from your profile.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border bg-muted/25 p-4">
                <AddPaymentMethodForm onAttached={handleCardSetupComplete} />
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={handleSkipCardSetup}
                className="w-full text-muted-foreground"
              >
                Skip for now
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
