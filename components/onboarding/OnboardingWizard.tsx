'use client';

// components/onboarding/OnboardingWizard.tsx
//
// THE WIZARD IS A COMPONENT, NOT THE ROUTE, so `app/onboarding/page.tsx` can read the
// query string on the SERVER and hand the starting step down. It used to be the page
// itself and pick its step in a mount effect, which meant a member returning from
// Stripe's hosted payout pages saw the welcome step painted from the server HTML before
// the effect swapped it — a visible flash on the one path where the member has just
// come back from somewhere else and most wants to see that it registered. A client
// component cannot avoid that: the server HTML is on screen before its effects run.
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
// wizard. Browsing needs no profile, so leaving is a legitimate choice: the footer
// links to the catalog, and `onboarding_completed_at` still gates every protected
// route (see `proxy.ts`). Sign-out is NOT offered here — it is reachable from the
// header on the catalog the footer links to, which is one hop rather than none.
//
// "Verify Identity" REDIRECTS TO THE PROVIDER, it does not route to /profile. It
// used to push `/profile#identity` — a page with no such anchor — where the member
// then had to save an optional shop name before a second click would finally open
// Stripe. Three clicks and a dead-end anchor stood between asking to verify and
// the only screen that can verify anything.

import { useEffect, useState } from 'react';
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
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { UnifiedOnboardingSurface } from '@/components/onboarding/UnifiedOnboardingSurface';
import { setTradingRegion } from '@/lib/actions/region';
import {
  listSelectableRegions,
  type SelectableRegion,
} from '@/lib/actions/regionOptions';
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

export type Step = 'welcome' | 'username' | 'region' | 'intent' | 'seller-onboarding';
type Intent = 'buyer' | 'seller' | null;

// The navigation spine the back button walks, and what the progress rail counts. It is
// every screen a member is walked THROUGH: `seller-onboarding` is deliberately absent
// because it sits off the end for sellers only, and counting it would tell a buyer they
// are on step 4 of 5 of something they will never see.
const STEPS: Step[] = ['welcome', 'username', 'region', 'intent'];
const PROGRESS_STEPS: Step[] = STEPS;

// Region choices are loaded at runtime, not read from the registry, because the real
// answer depends on which regions have a Stripe platform account configured — see
// `lib/actions/regionOptions.ts`. A browse-only region in this picker would badge the
// member ready to sell and then fail every payout.

export interface OnboardingWizardProps {
  /**
   * Which step to open on, resolved on the server from the return markers Stripe's
   * hosted pages append. Only ever chooses a SCREEN — completion is still decided by
   * the status read-backs inside `UnifiedOnboardingSurface`, never by a query param.
   */
  initialStep: Step;
}

export function OnboardingWizard({ initialStep }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
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
  // Whether the seller step reports both its gates satisfied. Owned here rather than
  // re-read, because the surface already knows and two readers of one fact drift.
  //
  // `null` MEANS NOT YET KNOWN, and that distinction is the whole point. Defaulting to
  // `false` made "Back" render immediately and then vanish the moment the status read
  // came back settled — a control appearing and disappearing on its own while the panel
  // beside it was still a skeleton.
  const [sellerSettled, setSellerSettled] = useState<boolean | null>(null);
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
      // UNIFIED ONBOARDING (unified-seller-onboarding). Both steps live on the next
      // screen of this wizard: identity in an embedded Stripe modal, payouts on
      // Stripe's hosted pages, returning to `?payouts=complete`. Either way the payout
      // account is silently prefilled from the verified identity, because the prefill
      // is written to the account at creation rather than to the surface.
      setSaving(false);
      setStep('seller-onboarding');
      return;
    }

    // BUYERS GO STRAIGHT IN. There is nothing left to ask them: a card is not needed
    // until they open a contract, and `AddPaymentMethodForm` is on the profile at the
    // point it becomes relevant. The wizard used to show a card step here with a "Skip
    // for now" beneath it, which is a screen whose best outcome is being dismissed.
    setSaving(false);
    toast.success('Welcome! Browse listings and find something you love.');
    router.push('/listings');
  }

  return (
    <main className="min-h-dvh bg-muted/30" aria-label="Member onboarding">
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          mobile="center"
          showClose={false}
          // CENTRED, which is a deliberate choice with a known cost. Centring means the
          // top edge sits at (viewport - height) / 2, so any height change moves the
          // panel — a step swap, a validation message, a status read resolving. An
          // earlier revision top-anchored it to hold the panel still and that read as
          // wrong, because a lone modal on an otherwise empty page belongs in the middle
          // of it. The fix for the movement is therefore to stop the HEIGHT jumping
          // (see the skeleton in `UnifiedOnboardingSurface`, shaped like what replaces
          // it), not to move the panel off centre.
          className="w-[calc(100%-2rem)] max-w-lg p-5 sm:p-6"
        >
          {/* Progress indicator: shows which step you are on. Hidden on the welcome
              step because it has no back button and counting "1 of 5" before the
              member has committed to anything is noise.

              The dots are decoration and say so; the count is carried by text, because
              an `aria-label` on a plain <div> has no role to attach to and is not
              reliably announced. */}
          {step !== 'welcome' && step !== 'seller-onboarding' ? (
            <div className="mb-2 flex items-center justify-center gap-tight">
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
            <div className="space-y-5">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-head">Welcome to NoDitto</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  Two ways to transact, both designed to protect both sides.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="eligibility-onboarding-title"
                >
                  <h2 id="eligibility-onboarding-title" className="text-body font-semibold">
                    All Sellers and Traders Are Verified Through Stripe
                  </h2>
                  <p className="mt-1 text-pretty text-body leading-relaxed text-muted-foreground">
                    Sellers and traders pass a Stripe identity check — a photo ID and a selfie — before they can list, sell, or enter a trade. Bank details are collected separately, only when there is money to pay out. Confirmed fraud permanently bans the responsible individual.
                  </p>
                </section>

                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="cash-sale-onboarding-title"
                >
                  <h2 id="cash-sale-onboarding-title" className="text-body font-semibold">
                    Buy & Sell with Payment Protection
                  </h2>
                  <p className="mt-1 text-pretty text-body leading-relaxed text-muted-foreground">
                    Buyer pays upfront; NoDitto holds the proceeds until delivery and inspection resolve, then pays the seller.
                  </p>
                </section>

                <section
                  className="rounded-xl border bg-muted/25 p-4"
                  aria-labelledby="trade-onboarding-title"
                >
                  <h2 id="trade-onboarding-title" className="text-body font-semibold">
                    Trade with Collateral
                  </h2>
                  <p className="mt-1 text-pretty text-body leading-relaxed text-muted-foreground">
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
            <div className="space-y-5">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-head">Choose your username</DialogTitle>
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
                  <p id="name-error" role="alert" className="text-body text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>

              {/* OPTIONAL, and never a gate on continuing. Onboarding already gates
                  on Connect for anyone who wants to sell, and an avatar carries no
                  assurance at all — it is self-chosen — so requiring one would add a
                  drop-off point for nothing. It saves on pick via its own action, so
                  it does not join `completeOnboarding`'s payload. */}
              {/* ONE ROW, COMPACT PICKER. This was a stacked block — a heading, a full
                  row of labelled Upload/Remove buttons, then a hint — which gave an
                  optional field more vertical weight and louder controls than the
                  display name it sits under. The `compact` variant puts the picker on
                  the avatar as a camera badge, so the label and hint can sit beside it
                  instead of above and below. */}
              <div
                role="group"
                aria-labelledby="onboarding-avatar-label"
                className="flex items-center gap-group border-t pt-4"
              >
                <AvatarUploadField
                  compact
                  avatarPath={avatarPath}
                  displayName={displayName || 'You'}
                  onChange={setAvatarPath}
                  hideHint
                />
                <div className="min-w-0 space-y-tight">
                  <p
                    id="onboarding-avatar-label"
                    className="text-body font-medium leading-none"
                  >
                    Profile picture{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </p>
                  <p className="text-pretty text-meta leading-relaxed text-muted-foreground">
                    Helps members recognise you. Change it any time from your profile.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
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
            <div className="space-y-5">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-head">Where are you trading from?</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  Deals are completed within one region, so postage, currency and
                  payouts all stay local.
                </DialogDescription>
              </DialogHeader>

              <fieldset className="grid gap-2">
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
                      <span className="block text-body text-muted-foreground">
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
                  <p className="rounded-lg border border-dashed p-4 text-body text-muted-foreground">
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
              <p className="text-pretty text-body leading-relaxed text-muted-foreground">
                This is tied to your payout account, so it is not something you can
                switch later on your own. You can still browse listings in any region.
              </p>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
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
            <div className="space-y-5">
              <DialogHeader className="space-y-2 pr-0 text-center">
                <DialogTitle className="text-head">What brings you here?</DialogTitle>
                <DialogDescription className="text-pretty leading-relaxed">
                  You can always do both later. This only gets your first path ready.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-2">
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
                    <span className="block text-body text-muted-foreground">
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
                    <span className="block text-body text-muted-foreground">
                      List items, accept offers, and get paid securely.
                    </span>
                  </span>
                </button>
              </div>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
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

            </div>
          ) : null}

          {step === 'seller-onboarding' ? (
            <div className="space-y-5">
              {/* TITLE ONLY. The step spine below states what each step is, and the
                  embedded provider form states what IT is asking for, so a description
                  here was a third voice introducing the same thing. */}
              <DialogHeader className="mx-auto max-w-lg space-y-2 pr-0 text-center">
                <DialogTitle className="text-head">Two steps to start selling</DialogTitle>
              </DialogHeader>

              <UnifiedOnboardingSurface
                returnPath="/onboarding"
                onSettledChange={setSellerSettled}
                onComplete={() => {
                  toast.success('You\u2019re all set. Start listing and selling.');
                  router.push('/listings');
                }}
              />

              {/* A way back to the intent question — this step sits off the wizard's
                  main spine, so `goBack` does not reach it. Rendered only once the status
                  is KNOWN and outstanding: dropped when both steps are done, because the
                  surface renders its own forward action and "Back" beside it is the more
                  prominent of two controls pointing opposite ways — and withheld while
                  still unknown, so it does not appear and then retract. */}
              {sellerSettled === false ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('intent')}
                  className="mx-auto w-full text-muted-foreground sm:w-auto"
                >
                  <ArrowLeft className="mr-2 size-4" aria-hidden />
                  Back
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* NO ESCAPE FOOTER. It used to offer the catalog and a sign-out on every
              step, because setup was required to transact and a member with no way out
              of a wizard is behind a locked door. That reasoning is answered differently
              now rather than ignored: a BUYER is never detained — choosing "buy" on the
              intent step completes onboarding and routes straight to the catalog — and a
              seller who does not want to verify reaches the same exit by pressing Back
              and choosing to buy instead. So the exit exists, it is just a real answer
              to the intent question rather than a bar pinned under every screen. */}
        </DialogContent>
      </Dialog>
    </main>
  );
}
