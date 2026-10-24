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
//   3. Region — the trading region every contract is scoped to. Only open countries are
//      offered: the "not open yet" waitlist group was removed from the picker.
//   4. Intent — a buyer goes straight to the catalog; a seller goes to Stripe Identity
//      and payouts on the next screen; someone adding a reference goes to the Stripe ID
//      check and then back to References (a reference needs a verified author).
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

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowLeftRightIcon, ArrowRight01Icon, BanknoteIcon, CheckmarkBadge01Icon, InfoIcon, MapPinIcon, ShieldCheckIcon, ShoppingBag01Icon, Store01Icon } from '@hugeicons/core-free-icons';

import { completeOnboarding } from '@/lib/actions/profile';
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { UnifiedOnboardingSurface } from '@/components/onboarding/UnifiedOnboardingSurface';
import { setTradingRegion } from '@/lib/actions/region';
import { identityStartHref } from '@/lib/identity/identityStart';
import { type SelectableRegion } from '@/lib/actions/regionOptions';
import type { ProviderReturn } from '@/components/onboarding/providerReturn';
import {
  findRegion,
  platformRegion,
  REGIONS,
  settlementCurrency,
} from '@/domain/region';
import { PendingLabel } from '@/components/ui/pending-label';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { chargesCurrencyConversion, FX_FEE_BPS } from '@/domain/fees/fxFee';
import { cn } from '@/lib/utils';

export type Step = 'welcome' | 'username' | 'region' | 'intent' | 'seller-onboarding';
/**
 * The member's first path. `reference` is someone who came to vouch for a trader: a
 * reference can only be published by an ID-verified member, so that path goes to the
 * Stripe ID check and then to References, with no seller or payout setup.
 */
type Intent = 'buyer' | 'seller' | 'reference' | null;

/** Whether the region step holds an open country the member can transact in. */
type RegionChoice = 'trade' | null;

/** Where the reference path lands after the ID check, absent a references destination. */
const REFERENCES_PATH = '/references';

// The navigation spine the back button walks, and what the progress rail counts. It is
// every screen a member is walked THROUGH: `seller-onboarding` is deliberately absent
// because it sits off the end for sellers only, and counting it would tell a buyer they
// are on step 4 of 5 of something they will never see.
const STEPS: Step[] = ['welcome', 'username', 'region', 'intent'];

/**
 * What choosing an open country means, said under the picker: the currency the member
 * is paid in, who they can deal with, and where the currency conversion fee still
 * applies (a trade's cash leg; cash sales are charged on behalf of the seller). All three are consequences of the country's PLATFORM, which is why
 * they are derived from it rather than written per country.
 */
function RegionOutcome({ regionCode }: { regionCode: string }) {
  const region = findRegion(regionCode);
  if (!region) return null;
  const code = region.currency.toUpperCase();
  const platform = platformRegion(region.code);
  const peers = REGIONS.filter((r) => r.tradingEnabled && r.platform === platform);
  const settles = (settlementCurrency(platform) ?? region.currency).toUpperCase();
  const converts = chargesCurrencyConversion(region.currency);
  const rate = `${FX_FEE_BPS / 100}%`;

  return (
    <div className="space-y-tight rounded-md border bg-muted p-cozy text-body">
      <p className="flex items-start gap-snug font-medium text-foreground">
        <HugeiconsIcon icon={MapPinIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          You&apos;re paid in {code}, and your listings are priced in {code}.
        </span>
      </p>
      <p className="text-pretty text-muted-foreground">
        {peers.length > 1
          ? `You can buy, sell and trade with members in ${peers.length} countries: the US, Canada, the UK and most of Europe. Every price shows its currency, and you pay in the seller's.`
          : `You can buy, sell and trade with other members in ${region.label}.`}
      </p>
      {converts ? (
        <p className="text-pretty text-muted-foreground">
          Purchases in {code} are paid in {code}, with no conversion fee. Cash paid as part
          of a trade is processed in {settles} and includes a {rate} currency conversion fee,
          paid by the trader paying it.
        </p>
      ) : null}
    </div>
  );
}

/** What the welcome step promises, one sentence each, in one voice. */
const WELCOME_POINTS = [
  {
    icon: ShieldCheckIcon,
    title: 'Everyone selling is verified',
    body: 'A photo ID and a matching selfie, checked by Stripe, before anyone can list or trade.',
  },
  {
    icon: BanknoteIcon,
    title: 'Money is held until delivery',
    body: 'The buyer pays upfront and the seller is paid once the item arrives and passes inspection.',
  },
  {
    icon: ArrowLeftRightIcon,
    title: 'Trades are backed by collateral',
    body: 'Each side puts a temporary hold on their card. No cash moves, and holds release on a confirmed swap.',
  },
] as const;

/** Phone: fills leftover viewport so Back/Continue pin to the bottom. md+: in-flow. */
const WIZARD_SCROLL =
  'max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-y-auto max-md:overscroll-contain';

/**
 * Phone: centres the step in whatever height is left between the progress dots and
 * the footer. md+: inert, because the desktop panel already shrink-wraps its content
 * and is centred by the dialog's own translate.
 *
 * `my-auto` on the flex CHILD rather than `justify-center` on the scroll parent, and
 * the difference is not cosmetic: `justify-content: center` in a scroll container
 * makes overflow spill past the START edge, where it is unreachable — the top of a
 * long step would be scrolled away with no way back to it. Auto margins absorb free
 * space when there is some and collapse to zero when there is none, so a short step
 * centres and a tall one behaves exactly like the top-aligned scroller it was.
 *
 * `shrink-0` because a flex child defaults to shrinking: without it a step taller than
 * the viewport is squeezed to fit and spills out of its own box instead of scrolling.
 */
const WIZARD_CENTER = 'max-md:my-auto max-md:shrink-0';

/** Phone: pinned under the scroll region. md+: in-card, matching DialogFooter. */
function WizardFooter({ children }: { children: ReactNode }) {
  return (
    <DialogFooter className="max-md:mt-auto max-md:shrink-0 max-md:border-t max-md:pt-cozy">
      {children}
    </DialogFooter>
  );
}

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
  /**
   * Where to go once onboarding is done — the path `proxy.ts` was taking the member to
   * when it diverted them here. Already validated as same-origin by the route; null
   * falls back to the catalog.
   */
  redirectTo?: string | null;
  /**
   * The regions with a configured Stripe platform, resolved by the page.
   *
   * Passed in rather than loaded on mount because an empty list is not a
   * neutral placeholder here: the step renders "No regions are open for deals
   * right now" when it has none, so every member was shown a misconfiguration
   * notice for the length of a round trip before the real buttons replaced it.
   */
  regions: SelectableRegion[];
  /**
   * The region the request IP resolves to, or null when there is no guess (local
   * development, a non-Vercel host, an IP outside the registry).
   *
   * A PRE-SELECTION ONLY. It decides which country the region picker opens on, when
   * NoDitto is open there; it is never written anywhere. A member whose guess is
   * wrong — a VPN, a holiday — changes it with one click.
   */
  guessedRegion?: string | null;
  /**
   * Which hosted Stripe flow the member has just come back from, when `initialStep`
   * is `seller-onboarding` because of a return marker. Handed to the seller surface so
   * the step they just finished reads "confirming with Stripe" on its first frame
   * rather than offering its button again.
   */
  providerReturn?: ProviderReturn | null;
  /**
   * An intent the member already gave before reaching the wizard, which removes the
   * intent step from the spine. Today only `seller`, for someone who signed up from the
   * Trusted Seller page (0152): asking "buy or sell?" of a member who just applied to
   * sell would be a question they have already answered.
   */
  presetIntent?: 'seller' | null;
}

export function OnboardingWizard({
  initialStep,
  redirectTo,
  regions,
  guessedRegion = null,
  providerReturn = null,
  presetIntent = null,
}: OnboardingWizardProps) {
  const router = useRouter();
  const exitPath = redirectTo ?? '/';
  const [step, setStep] = useState<Step>(initialStep);
  const [displayName, setDisplayName] = useState('');
  // Saved by AvatarUploadField the moment it is picked, so this only mirrors it for
  // the preview — it is not part of what `completeOnboarding` submits.
  const [avatarPath, setAvatarPath] = useState<string | null>(null);

  // THE IP GUESS PRE-SELECTS THE COUNTRY when it is open, and is never written anywhere
  // by itself: the member sees it in the picker and confirms or changes it. A guess
  // outside the open list leaves the picker empty rather than choosing for them. With dozens
  // of open countries the guess is what makes this step a confirmation for most people.
  const guessedOpenRegion =
    guessedRegion && regions.some((region) => region.code === guessedRegion)
      ? guessedRegion
      : null;
  // Which country is chosen, decided on the first render from what the server already
  // knows — this used to settle a tick after mount and move the selection under anyone
  // who had got there first. The IP's open country is pre-selected, or the one open
  // region when there is only one, so the step is a confirmation rather than a decision.
  // It is still SHOWN either way: the trading region is the jurisdiction payouts and
  // postage are pinned to, and silently assigning it would make the later "your region
  // is tied to your payout account" refusal come out of nowhere.
  const [regionChoice, setRegionChoice] = useState<RegionChoice>(
    guessedOpenRegion || regions.length === 1 ? 'trade' : null,
  );
  const [regionCode, setRegionCode] = useState<string | null>(
    guessedOpenRegion ?? (regions.length === 1 ? regions[0].code : null),
  );
  const regionChoices = regions;
  // Arriving from References (signed up to leave a reference) starts on that answer.
  // A pre-selection only: the step is still shown and any tile can be chosen.
  const referencesDestination = redirectTo?.startsWith(REFERENCES_PATH) ? redirectTo : null;
  const [intent, setIntent] = useState<Intent>(
    presetIntent ?? (referencesDestination ? 'reference' : null),
  );
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

  // A preset intent takes the intent step off the spine entirely, so Back never lands
  // on a question the member was not asked.
  const spine = presetIntent ? STEPS.filter((s) => s !== 'intent') : STEPS;
  const stepIndex = spine.indexOf(step);
  const progressSteps = spine;
  const progressIndex = progressSteps.indexOf(step);

  // Stripe's hosted pages return to this path. With a destination to finish on, carry
  // it through the round trip, or a Trusted Seller applicant who set up payouts on
  // Stripe would come back to a wizard that no longer knows where they were going.
  const sellerReturnPath =
    presetIntent && redirectTo
      ? `/onboarding?redirectTo=${encodeURIComponent(redirectTo)}`
      : '/onboarding';

  function goBack() {
    const previous = spine[stepIndex - 1];
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
    if (regionChoice !== 'trade' || !regionCode) {
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

    // Intent already given (a Trusted Seller applicant): go straight on as a seller.
    if (presetIntent) {
      await handleIntentContinue();
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

    if (intent === 'reference') {
      // STRAIGHT TO THE ID CHECK. A reference is only published by a verified member,
      // so there is nothing else to set up: `/api/identity/start` opens Stripe and the
      // member comes back to References (or the reference they came here to leave).
      // A full navigation, because the destination is off-origin. `saving` stays true
      // so the button keeps reading "Opening Stripe…" until the page is replaced.
      window.location.assign(identityStartHref(referencesDestination ?? REFERENCES_PATH));
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
    
    router.push(exitPath);
  }

  return (
    <main
      className="min-h-[calc(100dvh-var(--chrome-top))] bg-muted/30"
      aria-label="Member onboarding"
    >
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          showClose={false}
          // Phone: full-viewport page (`mobile="page"`), not the default
          // bottom sheet — a sheet only fills ~⅔ of the screen and then
          // Back/Continue eat the leftover. From `md` the panel is the same
          // centred card as before (`max-w-2xl`). Height still must not jump
          // between steps — see the skeleton in `UnifiedOnboardingSurface`.
          mobile="page"
          className="md:w-[calc(100%-2rem)] md:max-w-2xl md:p-6"
        >
          {/* Progress indicator: shows which step you are on. Hidden on the welcome
              step because it has no back button and counting "1 of 5" before the
              member has committed to anything is noise.

              The dots are decoration and say so; the count is carried by text, because
              an `aria-label` on a plain <div> has no role to attach to and is not
              reliably announced. */}
          {step !== 'welcome' && step !== 'seller-onboarding' ? (
            <div className="mb-snug flex shrink-0 items-center justify-center gap-tight">
              <span className="sr-only">
                Step {progressIndex + 1} of {progressSteps.length}
              </span>
              {progressSteps.map((s, i) => (
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

          <div className={WIZARD_SCROLL}>
          <div className={WIZARD_CENTER}>
          {step === 'welcome' ? (
            <div className="space-y-group">
              <DialogHeader className="space-y-snug pr-0 text-center">
                <DialogTitle className="text-head">Welcome to NoDitto</DialogTitle>
                <DialogDescription className="text-pretty">
                  Two ways to transact, both designed to protect both sides.
                </DialogDescription>
              </DialogHeader>

              {/* THREE LINES, NOT THREE ESSAYS. This was three bordered cards of
                  Title Case headings and four-sentence paragraphs — a policy page
                  wearing a wizard's chrome, on the one screen where nobody has
                  committed to anything yet. Each promise now gets one sentence in
                  one voice; the detail lives on the pages that enforce it. */}
              <ul className="space-y-cozy text-left">
                {WELCOME_POINTS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex items-center gap-cozy">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                      aria-hidden
                    >
                      <HugeiconsIcon icon={Icon} className="size-4" />
                    </span>
                    <div className="min-w-0 space-y-tight">
                      <p className="text-body font-medium">{title}</p>
                      <p className="text-pretty text-body text-muted-foreground">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {step === 'username' ? (
            <div className="space-y-group">
              <DialogHeader className="space-y-snug pr-0 text-center">
                <DialogTitle className="text-head">Choose your username</DialogTitle>
                <DialogDescription className="text-pretty">
                  This is how other members see you.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-snug">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. PokeTrader99, Sam K."
                  maxLength={255}
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
                className="flex items-center gap-group border-t pt-group"
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
                  <p className="text-pretty text-meta text-muted-foreground">
                    Helps members recognise you. Change it any time from your profile.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'region' ? (
            <div className="space-y-group">
              <DialogHeader className="space-y-snug pr-0 text-center">
                <DialogTitle className="text-head">Where are you trading from?</DialogTitle>
                <DialogDescription className="text-pretty">
                  Your country sets the currency you are paid in and who you can deal
                  with. It is tied to your payout account.
                </DialogDescription>
              </DialogHeader>

              {/* ONE PICKER, NOT A TILE PER COUNTRY. With the US platform serving the
                  UK, the EEA, Canada and Switzerland there are dozens of open countries,
                  and a tile each would be a wall. The IP guess pre-selects the country,
                  so for most members this is a confirmation. Only open countries are
                  listed. */}
              <div className="space-y-snug">
                <Label htmlFor="trading-country">Your country</Label>
                <Select
                  value={regionCode ?? ''}
                  onValueChange={(value) => {
                    setError(null);
                    setRegionChoice('trade');
                    setRegionCode(value);
                  }}
                  disabled={saving}
                >
                  <SelectTrigger id="trading-country" className="bg-card">
                    <SelectValue placeholder="Choose your country" />
                  </SelectTrigger>
                  {/* One flat list. The "Open for deals" heading only meant something
                      beside the "Not open yet" group, which is gone. */}
                  <SelectContent className="z-[60] max-h-80">
                    {regionChoices.map((region) => (
                      <SelectItem key={region.code} value={region.code}>
                        {region.label} · {region.currency.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {regionChoice === 'trade' && regionCode ? (
                <RegionOutcome regionCode={regionCode} />
              ) : null}

              <fieldset className="contents">
                <legend className="sr-only">Your trading region</legend>
                {/*
                  An empty list is a misconfiguration, not a member error: it means no
                  region has both product intent and a Stripe platform account. Say so
                  plainly rather than showing an empty step with a dead Continue
                  button, which reads as a broken page.
                */}
                {regionChoices.length === 0 ? (
                  <p className="rounded-lg border border-border bg-muted p-group text-body text-muted-foreground">
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
              <p className="text-pretty text-body text-muted-foreground">
                This is tied to your payout account, so it is not something you can
                switch later on your own. You can still browse listings in any region.
              </p>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'intent' ? (
            <div className="space-y-group">
              <DialogHeader className="space-y-snug pr-0 text-center">
                <DialogTitle className="text-head">What brings you here?</DialogTitle>
                <DialogDescription className="text-pretty">
                  You can always do the others later. This only gets your first path ready.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-snug">
                <button
                  type="button"
                  onClick={() => setIntent('buyer')}
                  className={cn(
                    'flex items-center gap-group rounded-md border border-input bg-card p-group text-left transition-colors',
                    intent === 'buyer'
                      ? 'border-foreground bg-accent text-accent-foreground'
                      : 'hover:border-foreground/60 hover:bg-muted/50',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                    <HugeiconsIcon icon={ShoppingBag01Icon} className="size-5" aria-hidden />
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
                    'flex items-center gap-group rounded-md border border-input bg-card p-group text-left transition-colors',
                    intent === 'seller'
                      ? 'border-foreground bg-accent text-accent-foreground'
                      : 'hover:border-foreground/60 hover:bg-muted/50',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                    <HugeiconsIcon icon={Store01Icon} className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">I want to sell or trade</span>
                    <span className="block text-body text-muted-foreground">
                      List items, accept offers, and get paid securely.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIntent('reference')}
                  className={cn(
                    'flex items-center gap-group rounded-md border border-input bg-card p-group text-left transition-colors',
                    intent === 'reference'
                      ? 'border-foreground bg-accent text-accent-foreground'
                      : 'hover:border-foreground/60 hover:bg-muted/50',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                    <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">I&apos;m adding a reference</span>
                    <span className="block text-body text-muted-foreground">
                      Vouch for a trader you&apos;ve dealt with. It starts with a quick photo ID
                      check.
                    </span>
                  </span>
                </button>
              </div>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'seller-onboarding' ? (
            <div className="space-y-group">
              {/* TITLE PLUS WHY. The spine states what each step is; this is only the
                  reason they exist at all, parked on an (i) so it isn't a third
                  paragraph competing with the steps. */}
              <DialogHeader className="mx-auto max-w-2xl space-y-snug pr-0 text-center">
                <div className="flex items-center justify-center gap-tight">
                  <DialogTitle className="text-head">
                    Two steps to start selling
                  </DialogTitle>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:border-ring"
                        aria-label="Why we need these details"
                      >
                        <HugeiconsIcon icon={InfoIcon} className="size-3.5" aria-hidden />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="center"
                      className="z-[60] max-w-[18rem] text-pretty text-body"
                    >
                      Photo ID so other members know who they&apos;re dealing
                      with. Bank details so we can pay you when a sale settles.
                      Stripe checks both.
                    </PopoverContent>
                  </Popover>
                </div>
              </DialogHeader>

              <UnifiedOnboardingSurface
                returnPath={sellerReturnPath}
                returningFrom={providerReturn}
                onSettledChange={setSellerSettled}
                onComplete={() => {
                  router.push(exitPath);
                }}
              />

            </div>
          ) : null}
          </div>
          </div>

          {step === 'welcome' ? (
            <WizardFooter>
              <Button type="button" onClick={() => setStep('username')}>
                Get started
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
              </Button>
            </WizardFooter>
          ) : null}

          {step === 'username' ? (
            <WizardFooter>
              <Button type="button" variant="outline" onClick={goBack}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                type="button"
                onClick={handleUsernameContinue}
                disabled={!displayName.trim()}
              >
                Continue
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
              </Button>
            </WizardFooter>
          ) : null}

          {step === 'region' ? (
            <WizardFooter>
              <Button
                type="button"
                variant="outline"
                onClick={goBack}
                disabled={saving}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                type="button"
                onClick={handleRegionContinue}
                disabled={saving || !regionCode || !regionChoice}
                aria-busy={saving}
              >
                {/* WIDTH-STABLE: "Continue" → "Saving…" resized the button under the
                    pointer and slid Back beside it in the right-aligned footer. */}
                <PendingLabel
                  pending={saving}
                  spinner={false}
                  pendingLabel={presetIntent === 'seller' ? 'Opening Stripe…' : 'Saving…'}
                >
                  {presetIntent === 'seller' ? 'Verify Identity' : 'Continue'}
                </PendingLabel>
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
              </Button>
            </WizardFooter>
          ) : null}

          {step === 'intent' ? (
            <WizardFooter>
              <Button type="button" variant="outline" onClick={goBack} disabled={saving}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                type="button"
                onClick={handleIntentContinue}
                disabled={!intent || saving}
                aria-busy={saving}
              >
                {/* "Continue", matching every other step in this wizard. It read
                    "Next" here alone, which is a second word for one action and
                    bought nothing. `Verify Identity` stays different because the
                    action IS different — it leaves for Stripe. Width-stable for the
                    same reason as the region step's button. */}
                {/* Seller and reference both leave for Stripe, so both say so. */}
                <PendingLabel
                  pending={saving}
                  spinner={false}
                  pendingLabel={intent === 'seller' || intent === 'reference' ? 'Opening Stripe…' : 'Saving…'}
                >
                  {intent === 'seller' || intent === 'reference' ? 'Verify Identity' : 'Continue'}
                </PendingLabel>
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
              </Button>
            </WizardFooter>
          ) : null}

          {/* A way back to the intent question — this step sits off the wizard's
              main spine, so `goBack` does not reach it. Shown only once the status is
              KNOWN and outstanding: dropped when both steps are done, because the
              surface renders its own forward action and "Back" beside it is the more
              prominent of two controls pointing opposite ways — and withheld while
              still unknown, so it does not appear and then retract.

              WITHHELD IS NOT ABSENT. While the status is unknown the footer is laid
              out with the button `invisible` (not focusable, not announced), so the
              slot already exists when the answer lands. Mounting it only then grew
              the panel by a footer: on a phone the centred step jumped up by half of
              it, and from `md` the translate-centred card moved bodily. A settled
              answer swaps this slot for the surface's own exit, which is about the
              same height. */}
          {step === 'seller-onboarding' && sellerSettled !== true ? (
            <WizardFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(presetIntent ? 'region' : 'intent')}
                disabled={sellerSettled === null}
                aria-hidden={sellerSettled === null || undefined}
                className={sellerSettled === null ? 'invisible' : undefined}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>
              {/* A TRUSTED SELLER APPLICANT CAN LEAVE BEFORE PAYOUTS. The review needs
                  their ID, not their bank details, and the application page says what
                  is still outstanding — so they are not held here until both steps are
                  done. Onboarding is already complete at this point. Same reserve rule
                  as Back: laid out invisible while the status is unknown. */}
              {presetIntent ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push(exitPath)}
                  disabled={sellerSettled === null}
                  aria-hidden={sellerSettled === null || undefined}
                  className={sellerSettled === null ? 'invisible' : undefined}
                >
                  Continue to application
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
                </Button>
              ) : null}
            </WizardFooter>
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
