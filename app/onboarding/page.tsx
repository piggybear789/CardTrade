'use client';

// app/onboarding/page.tsx
//
// Post-signup onboarding presented as one focused modal wizard:
//   1. Welcome — explain how NoDitto protects cash sales and trades
//   2. Alias — choose the public display name shown to other members
//   3. Region — the trading region every contract is scoped to
//   4. Intent — buyer enters card setup; seller goes straight to Stripe Identity
//   5. Card Setup (buyer only, skippable) — Stripe Payment Element for vaulting a card
//
// ONBOARDING IS REQUIRED TO TRANSACT, NOT TO LOOK, so the wizard has a way out on
// every step. It previously had no dismiss control, on the reasoning that a member
// "completes the short flow or signs out" — but no sign-out control was offered
// either, so the honest description of the options was finish or abandon the site.
// Members were sent here merely for opening the catalog, and anyone whose `profiles`
// row was missing could not finish at all, which made it a locked door rather than a
// wizard. Browsing needs no profile, so leaving is a legitimate choice; the footer
// offers the catalog and sign-out, and `onboarding_completed_at` still gates every
// protected route (see `proxy.ts`).
//
// "Verify Identity" REDIRECTS TO THE PROVIDER, it does not route to /profile. It
// used to push `/profile#identity` — a page with no such anchor — where the member
// then had to save an optional shop name before a second click would finally open
// Stripe. Three clicks and a dead-end anchor stood between asking to verify and
// the only screen that can verify anything.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  ShoppingBag,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';

import { completeOnboarding } from '@/lib/actions/profile';
import { signOut } from '@/lib/actions/auth';
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { beginIdentityCheck } from '@/lib/actions/identity';
import { setTradingRegion } from '@/lib/actions/region';
import {
  listSelectableRegions,
  type SelectableRegion,
} from '@/lib/actions/regionOptions';
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

type Step = 'welcome' | 'username' | 'region' | 'intent' | 'card-setup';
type Intent = 'buyer' | 'seller' | null;

// The navigation spine the back button walks. `card-setup` is deliberately absent:
// it is reached only by a buyer choosing an intent, and stepping back into the intent
// question after a card has been vaulted is not a move the wizard offers.
const STEPS: Step[] = ['welcome', 'username', 'region', 'intent'];

// What the progress rail counts, which is SCREENS rather than spine entries. Leaving
// `card-setup` out made `STEPS.indexOf` return -1 on the last screen, so the rail
// emptied itself and announced "Step 0 of 4" at the very point a member most wants to
// know they are nearly done. A seller leaves at the intent step for the provider
// rather than advancing, so they simply never see the fifth dot fill.
const PROGRESS_STEPS: Step[] = [...STEPS, 'card-setup'];

// Region choices are loaded at runtime, not read from the registry, because the real
// answer depends on which regions have a Stripe platform account configured — see
// `lib/actions/regionOptions.ts`. A browse-only region in this picker would badge the
// member ready to sell and then fail every payout.

export default function OnboardingPage() {
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Leaving must work even if signing out fails, so a failed call still routes to
  // the public catalog rather than stranding the member on this screen again.
  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      // Swallowed deliberately: the redirect below is the escape either way.
    }
    window.location.assign('/listings');
  }
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  // Saved by AvatarUploadField the moment it is picked, so this only mirrors it for
  // the preview — it is not part of what `completeOnboarding` submits.
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  // Pre-selected when only one region trades, so the step is a confirmation rather
  // than a decision with one option. It is still SHOWN: this is the jurisdiction
  // their payouts and postage are pinned to, and silently assigning it would make
  // the later "your region is tied to your payout account" refusal come out of
  // nowhere.
  const [regionCode, setRegionCode] = useState<string | null>(null);
  const [regionChoices, setRegionChoices] = useState<SelectableRegion[]>([]);

  // Loaded on mount rather than computed here, because the answer depends on which
  // regions have a Stripe platform account configured and that is server-side state.
  useEffect(() => {
    let cancelled = false;
    void listSelectableRegions().then((regions) => {
      if (cancelled) return;
      setRegionChoices(regions);
      if (regions.length === 1) setRegionCode(regions[0].code);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [intent, setIntent] = useState<Intent>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const progressIndex = PROGRESS_STEPS.indexOf(step);

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
    setStep('region');
  }

  async function handleRegionContinue() {
    if (!regionCode) {
      setError('Choose where you are trading from.');
      return;
    }

    // Persisted HERE rather than alongside the intent step, so the member cannot
    // reach Stripe Connect without a region already on file. The Connect account is
    // created with a country derived from this value, and an account registered in
    // the wrong country cannot be paid — so the write has to precede it.
    setSaving(true);
    setError(null);
    const result = await setTradingRegion(regionCode);
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

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
      // STEP ONE OF TWO, and this is the step that changed with 0069. It used to open
      // Connect, which meant the first thing a new seller was asked for was their bank
      // account — before they had listed anything or found a buyer. The identity check
      // needs no bank details and unlocks listing, selling and trading on its own;
      // payout setup is deferred to the payouts page, where it is needed only once
      // money actually has to move.
      //
      // Pressing this button is the buyer-disclosure consent (Req 4.8-4.12), which is
      // why the disclosure is rendered directly below it.
      const verification = await beginIdentityCheck('/profile/payouts');

      if (verification.ok && verification.data.url) {
        // Full navigation, not a router push: the destination is off-origin.
        window.location.assign(verification.data.url);
        return;
      }

      // No hosted flow (MockService) or the session could not be created. Land on the
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
          {/* Progress indicator: shows which step you are on. Hidden on the welcome
              step because it has no back button and counting "1 of 5" before the
              member has committed to anything is noise.

              The dots are decoration and say so; the count is carried by text, because
              an `aria-label` on a plain <div> has no role to attach to and is not
              reliably announced. */}
          {step !== 'welcome' ? (
            <div className="mb-2 flex items-center justify-center gap-1.5">
              <span className="sr-only">
                Step {progressIndex + 1} of {PROGRESS_STEPS.length}
              </span>
              {PROGRESS_STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i <= progressIndex ? 'w-6 bg-primary' : 'w-3 bg-border',
                  )}
                  aria-hidden
                />
              ))}
            </div>
          ) : null}

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
                    Sellers and traders pass a Stripe identity check — a photo ID and a selfie — before they can list, sell, or enter a trade. Bank details are collected separately, only when there is money to pay out. Confirmed fraud permanently bans the responsible individual.
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

              {/* OPTIONAL, and never a gate on continuing. Onboarding already gates
                  on Connect for anyone who wants to sell, and an avatar carries no
                  assurance at all — it is self-chosen — so requiring one would add a
                  drop-off point for nothing. It saves on pick via its own action, so
                  it does not join `completeOnboarding`'s payload. */}
              <div
                role="group"
                aria-labelledby="onboarding-avatar-label"
                className="space-y-2 border-t pt-5"
              >
                <p
                  id="onboarding-avatar-label"
                  className="text-sm font-medium leading-none"
                >
                  Profile picture{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </p>
                <AvatarUploadField
                  avatarPath={avatarPath}
                  displayName={displayName || 'You'}
                  onChange={setAvatarPath}
                  hideHint
                />
                <p className="text-xs text-muted-foreground">
                  Helps members recognise you. You can add or change it any time from
                  your profile.
                </p>
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

          {step === 'region' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">Where are you trading from?</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  Deals are completed within one region, so postage, currency and
                  payouts all stay local.
                </DialogDescription>
              </DialogHeader>

              <fieldset className="grid gap-3">
                <legend className="sr-only">Your trading region</legend>
                {regionChoices.map((region) => (
                  <button
                    key={region.code}
                    type="button"
                    onClick={() => {
                      setRegionCode(region.code);
                      setError(null);
                    }}
                    aria-pressed={regionCode === region.code}
                    className={cn(
                      'flex items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                      regionCode === region.code
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:border-foreground/20 hover:bg-muted/50',
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                      <MapPin className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-medium">{region.label}</span>
                      <span className="block text-sm text-muted-foreground">
                        Buy, sell and trade in {region.currency.toUpperCase()} with
                        other members in {region.label}.
                      </span>
                    </span>
                  </button>
                ))}
                {/*
                  An empty list is a misconfiguration, not a member error: it means no
                  region has both product intent and a Stripe platform account. Say so
                  plainly rather than showing an empty step with a dead Continue
                  button, which reads as a broken page.
                */}
                {regionChoices.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No regions are open for deals right now. Please try again shortly —
                    you can still browse listings in the meantime.
                  </p>
                ) : null}
              </fieldset>

              {/*
                Stated plainly at the point of choosing, because it is not reversible
                from the UI once a payout account exists — `setTradingRegion` refuses
                and sends the member to support. Finding that out later would feel
                like a bug.
              */}
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                This is tied to your payout account, so it is not something you can
                switch later on your own. You can still browse listings in any region.
              </p>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={goBack}
                  disabled={saving}
                  className="flex-1"
                >
                  <ArrowLeft className="mr-2 size-4" aria-hidden />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleRegionContinue}
                  disabled={!regionCode || saving}
                  className="flex-1"
                >
                  {saving ? 'Saving…' : 'Continue'}
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
                      // "Continue", matching every other step in this wizard. It read
                      // "Next" here alone, which is a second word for one action and
                      // bought nothing. `Verify Identity` stays different because the
                      // action IS different — it leaves for Stripe.
                      : 'Continue'}
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
                  Continuing opens Stripe, which checks a photo ID and a selfie on its own
                  pages — NoDitto never sees the document. You agree that the name on it can
                  be shown to someone you have an agreed sale or trade with. Bank details
                  come later, only when you have money to collect.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'card-setup' ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-2xl">Add a payment card</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  A saved card lets you buy instantly or back a trade with collateral.
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

          {/* A WAY OUT, ON EVERY STEP.
              This wizard had no dismiss control, no sign-out and no link away, on the
              reasoning that a member "completes the short flow or signs out" — but
              signing out was not offered either, so the honest description was that
              they completed it or stopped using the site. Members were sent here
              merely for opening the catalog, and anyone whose profile row was missing
              could not complete it at all, which turned a wizard into a locked door.
              Browsing needs no profile, so leaving is always a legitimate choice. */}
          <div className="mt-6 flex flex-col items-center gap-2 border-t pt-4">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/listings">
                Not now — browse listings
                <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
              </Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You can finish this any time. Selling, buying and trading need it
              completed;{' '}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="underline underline-offset-2 hover:text-foreground disabled:opacity-60"
              >
                {isSigningOut ? 'signing out…' : 'or sign out'}
              </button>
              .
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
