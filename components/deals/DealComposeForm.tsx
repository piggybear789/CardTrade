'use client';

// components/deals/DealComposeForm.tsx
//
// Start a private deal: sell a card, or trade cards. Anyone can write one. The
// account is asked for at Get link, after the work is done, and the draft — photos
// included — survives that sign-in in IndexedDB (`dealDraftStore`).
//
// ONE FORM BESIDE A LIVE PREVIEW, the way every "create a link" editor on Mobbin is
// built (Stripe, Contra and Square payment links, Mercury, Whop, 2026-11-22): a
// focused page with a close button and the title at the top left and the one action
// at the top right; the form on the left; and on a tinted canvas on the right, the
// page the other person will open, drawn live from what is being typed, in a phone
// or a browser window (Stripe's and Square's device toggle). The type of deal is a
// pair of radio cards at the top of the form (Contra's one-time vs subscription),
// preselected, so the form is usable from the first second.
//
// TWO SCREENS, EACH ONE SCREEN TALL. The form is about 1,300px as one page against
// roughly 780px of room on a 1440 x 900 laptop, so it is split where it divides
// naturally, the card and then its terms (Contra's Details / Content), and each half
// fits beside the preview with nothing to scroll. Numbered steps at the top switch
// between them; the footer's action under the form reads Next, then Get link.
//
// It replaced a four-step wizard (deal type, card, terms, review), first in an
// always-open dialog and then on a page. Both opened on a screen holding nothing but
// two tiles, and the review step only existed to show what the live preview now
// shows the whole time.
//
//   1 Your card   sell or trade, then photos, what it is, category and condition
//   2 Terms
//                 what they pay, the fee, what you receive              (sell)
//                 what you want, what yours is worth, the hold and fee  (trade)
//                 what happens next
//   then, only when needed, in place of the form:
//   Save your deal  sign in (a signed-out visitor)
//   Almost done     the name others see, and where they trade (a new account)
//
// THE PREVIEW IS THE REAL INVITE CARD. It renders `DealInviteFacts` and
// `dealInviteHeadline`, the same pieces `/t/[token]` draws, from the draft, so the
// preview cannot drift from the page it stands for.
//
// STRIPE IDENTITY IS NOT ASKED FOR HERE, AND THE COPY SAYS EXACTLY WHERE IT IS: a
// seller verifies before the buyer can pay (and sets up payouts first only for a sale
// charged on their own Stripe account, `dealNextSteps`), and BOTH
// traders verify before a swap can start. Those are the checks `acceptCashSaleTerms`
// and `acceptTradeTerms` enforce, stated in "What happens next" right above the
// action; nothing on this page may read as optional about them.
//
// KEPT from the previous composer: the line beside the action names the next thing
// to do while the button is disabled.

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import {
  ArrowSquareOutIcon,
  ArrowsLeftRightIcon,
  CaretLeftIcon,
  CheckIcon,
  CircleNotchIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DotsThreeIcon,
  EyeSlashIcon,
  LockIcon,
  MoneyIcon,
  XCircleIcon,
} from '@/components/ui/icons';
import { toast } from 'sonner';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  EMPTY_UNLISTED_DRAFT,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import {
  clearDealDraft,
  loadDealDraft,
  saveDealDraft,
  type DraftKind,
} from '@/components/deals/dealDraftStore';
import {
  DealCardStep,
  DealTermsStep,
  NextSteps,
  dealNextSteps,
  dealStepGap,
  draftTitle,
  useDraftThumb,
} from '@/components/deals/DealSteps';
import {
  DealInviteGuestCard,
  type DealInviteFactsInput,
} from '@/components/deals/DealInviteFacts';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { QuickProfileFields } from '@/components/deals/QuickProfileFields';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import {
  createDealInvite,
  revokeDealInvite,
  updateDealInvite,
  type DealInviteEditable,
  type HostReadiness,
} from '@/lib/actions/dealInvites';
import { isItemCondition } from '@/lib/catalog/conditions';
import { formatShortDate } from '@/lib/format';
import { DealLinkActions } from '@/components/deals/DealLinkActions';
import { HostVerificationNotice } from '@/components/deals/DealVerificationNotice';
import { InfoPopover } from '@/components/ui/info-popover';
import { completeQuickOnboarding } from '@/lib/actions/quickOnboarding';
import type { SelectableRegion } from '@/lib/actions/regionOptions';
import { DEAL_RESUME_PATH, dealHostPath, dealInvitePath } from '@/lib/deals/paths';
import { navigateWithType } from '@/lib/motion/navigate';
import { cn } from '@/lib/utils';
import {
  ActionFooter,
  EDITOR_CANVAS_CLASS,
  EDITOR_GRID_HEIGHT,
  EDITOR_GRID_HEIGHT_BARLESS,
  EditorBar,
  EditorPageHeader,
  EditorSteps,
  OptionCard,
} from '@/components/editor/EditorFrame';
import { BROWSER, BrowserDevice, DeviceStage, PHONE, PhoneDevice } from '@/components/editor/DevicePreview';

/** What the left pane shows. The account and profile panels stand in for the form. */
type Phase = 'edit' | 'account' | 'profile';

/**
 * The form's two screens. Each fits beside the preview on an ordinary laptop, so
 * the form and the page it builds are both in full view; a screen scrolls inside the
 * left pane only when it must (a short laptop, zoom, an error message).
 */
type Stage = 'card' | 'deal';

export interface DealComposerViewer {
  signedIn: boolean;
  /** A new account that has not yet given a display name and trading region. */
  needsOnboarding: boolean;
  displayName: string | null;
}

export interface DealComposeFormProps {
  viewer: DealComposerViewer;
  /** Regions a new account may choose, for the two-question step. */
  regions: SelectableRegion[];
  /** Where that picker starts: the member's region, else the one they browse. */
  suggestedRegion: string | null;
  /** The currency the price is quoted in, from the same region. */
  quoteCurrency: string;
  /** Returning from sign-in: pick the stored draft back up. */
  resume: boolean;
  /**
   * Where the host stands with Stripe for each kind of deal, so the preview's status
   * line says what the invite will ("Sam hasn't verified with Stripe Identity yet").
   */
  hostReadiness: { sale: HostReadiness; trade: HostReadiness };
  /**
   * An open deal of the host's, which turns the composer into the deal's own page:
   * the form filled in and saved with "Save changes", the deal type fixed, and the
   * link to share above the preview. Get link lands here, `/t/[token]` sends the host
   * here, and editing happens here rather than in a dialog.
   */
  existing?: ExistingDeal | null;
}

/** An open deal the composer is showing and editing. */
export interface ExistingDeal {
  inviteId: string;
  token: string;
  kind: 'CASH_SALE' | 'TRADE';
  editable: DealInviteEditable;
  expiresAt: string | null;
  /** Where the host stands with Stripe, for this deal's currency. */
  readiness: HostReadiness | null;
  /** Just made: Get link landed here. Says so once, in the link panel. */
  justCreated: boolean;
}

function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/** The editable fields, as text, for telling whether anything has changed. */
function snapshot(input: {
  card: UnlistedItemDraft;
  priceDollars: string;
  valueDollars: string;
  wanted: string;
}): string {
  const { images, ...card } = input.card;
  return JSON.stringify({
    card,
    images: images.length,
    price: dollarsToCents(input.priceDollars),
    value: dollarsToCents(input.valueDollars),
    wanted: input.wanted.trim(),
  });
}

export function DealComposeForm({
  viewer,
  regions,
  suggestedRegion,
  quoteCurrency,
  resume,
  hostReadiness,
  existing = null,
}: DealComposeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // SELL IS PRESELECTED, as Contra preselects "One-time" and Square "Any amount": a
  // form with a choice already made is usable at once, and the preview has a shape.
  // An existing deal opens as it stands.
  const initial = existing
    ? {
        card: {
          title: existing.editable.title,
          description: existing.editable.description,
          category: existing.editable.category,
          // A grade that has left the scale opens empty, so the form asks for one
          // instead of holding a value its Select cannot show.
          condition: isItemCondition(existing.editable.condition) ? existing.editable.condition : '',
          keptPaths: existing.editable.imagePaths,
          images: [],
        },
        priceDollars: centsToDollars(existing.editable.priceCents),
        valueDollars: centsToDollars(existing.editable.valueCents),
        wanted: existing.editable.wantedDescription ?? '',
      }
    : { card: EMPTY_UNLISTED_DRAFT, priceDollars: '', valueDollars: '', wanted: '' };
  const [kind, setKind] = useState<DraftKind>(existing?.kind ?? 'CASH_SALE');
  const [phase, setPhase] = useState<Phase>('edit');
  // A deal Get link just made opens on Terms, the screen Get link was pressed on, so the
  // form does not jump back to the card as the page becomes the deal's.
  const [stage, setStage] = useState<Stage>(existing?.justCreated ? 'deal' : 'card');
  const [card, setCard] = useState<UnlistedItemDraft>(initial.card);
  const [priceDollars, setPriceDollars] = useState(initial.priceDollars);
  const [valueDollars, setValueDollars] = useState(initial.valueDollars);
  const [wanted, setWanted] = useState(initial.wanted);
  // What was last saved, so Save changes knows whether there is anything to save.
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initial));
  const [confirmingCancelLink, setConfirmingCancelLink] = useState(false);
  const [displayName, setDisplayName] = useState(viewer.displayName ?? '');
  const [regionCode, setRegionCode] = useState(suggestedRegion ?? regions[0]?.code ?? '');
  const [restoring, setRestoring] = useState(resume);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // PHONE BY DEFAULT. A private deal's link is sent in a DM or a text, so the page it
  // opens is usually seen on a phone.
  const [device, setDevice] = useState<PreviewDevice>('phone');

  // Back from sign-in: restore the draft. A new account answers its two questions
  // next; everyone else lands on the filled-in form and presses Get link.
  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    void loadDealDraft().then((stored) => {
      if (cancelled) return;
      setRestoring(false);
      if (!stored) return;
      setKind(stored.kind);
      setCard(stored.card);
      setPriceDollars(stored.priceDollars);
      setValueDollars(stored.valueDollars);
      setWanted(stored.wanted);
      // Get link was pressed on the deal screen, so that is where they come back to.
      setStage('deal');
      if (viewer.signedIn && viewer.needsOnboarding) setPhase('profile');
    });
    return () => {
      cancelled = true;
    };
  }, [resume, viewer.signedIn, viewer.needsOnboarding]);

  // A NEW SCREEN STARTS AT ITS TITLE, with focus on it, so a screen reader announces
  // it rather than staying on a button that no longer exists. The left pane scrolls on
  // its own from `lg`, so it goes back to its top as well as the window. Keyed on the
  // screen actually changing, because Strict Mode runs a mount effect twice.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const screen = `${phase}:${stage}`;
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    window.scrollTo({ top: 0 });
    paneRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const selling = kind === 'CASH_SALE';
  const readiness =
    existing?.readiness ?? (selling ? hostReadiness.sale : hostReadiness.trade);
  // What the invite will say once the link exists. Get link records the seller's
  // agreement to show their verified name, so disclosure-needed is already done by
  // the time anyone opens it.
  const previewReadiness: HostReadiness | null =
    readiness === 'disclosure-needed' ? 'ready' : readiness;
  const dirty = existing ? snapshot({ card, priceDollars, valueDollars, wanted }) !== savedSnapshot : false;
  const priceCents = dollarsToCents(priceDollars);
  const valueCents = dollarsToCents(valueDollars);
  const thumb = useDraftThumb(card);

  const shape = { card, selling, priceCents, wanted, valueCents };
  /** What the card screen still needs. It gates Next and the Terms step. */
  const cardGap = dealStepGap('card', shape);

  /**
   * What the current screen still needs, or `null` when it is complete. Drives the
   * line beside the action AND the button's disabled state, so the two cannot
   * disagree. Presence only — range rules come back as messages on Get link. Shared
   * with the editor (`dealStepGap`).
   */
  function gap(): string | null {
    if (phase === 'profile') {
      if (displayName.trim() === '') return 'Add the name other members see.';
      if (!regionCode) return 'Choose where you trade.';
      return null;
    }
    if (phase !== 'edit') return null;
    if (stage === 'card') return cardGap;
    return cardGap ?? dealStepGap('terms', shape);
  }
  const missing = gap();

  function goStage(next: Stage) {
    setError(null);
    setStage(next);
  }

  const hasWork = existing
    ? dirty
    : card.images.length > 0 ||
      card.keptPaths.length > 0 ||
      card.title.trim() !== '' ||
      card.description.trim() !== '' ||
      priceDollars !== '' ||
      valueDollars !== '' ||
      wanted.trim() !== '';

  function go(next: Phase) {
    setError(null);
    setPhase(next);
  }

  /** Close: back where they came from, else the catalog. Asks first if there is work. */
  function requestClose() {
    if (hasWork) {
      setConfirmingClose(true);
      return;
    }
    leave();
  }

  function leave() {
    // An existing deal lives in the host's sales or trades, so that is where its page
    // closes to; Back could be the composer that made it.
    if (existing) {
      navigateWithType(router, existing.kind === 'TRADE' ? '/trades' : '/sales', 'nav-back');
      return;
    }
    void clearDealDraft();
    if (window.history.length > 1) router.back();
    else router.push('/');
  }

  /** Save an existing deal's changes. The link stays the same. */
  function saveChanges() {
    if (!existing) return;
    setError(null);
    const cents = selling ? priceCents : valueCents;
    if (cents == null || cents < 1) {
      setError(selling ? 'Enter a price.' : 'Say what your card is worth.');
      return;
    }
    if (selling) {
      const problem = cashPriceProblem(cents);
      if (problem) {
        setError(problem);
        return;
      }
    }
    startTransition(async () => {
      const uploaded = await pathsFromUnlistedDraft(card, cents);
      if (!uploaded.ok) {
        setError(uploaded.message);
        toast.error(uploaded.message);
        return;
      }
      const { title, description, category, condition, images } = uploaded.item;
      const item = { title, description, category, condition, images };
      const result = selling
        ? await updateDealInvite({ inviteId: existing.inviteId, kind: 'CASH_SALE', item, priceCents: cents })
        : await updateDealInvite({
            inviteId: existing.inviteId,
            kind: 'TRADE',
            item,
            valueCents: cents,
            wantedDescription: wanted,
          });
      if (!result.ok) {
        const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
        setError(message);
        toast.error(message);
        return;
      }
      // The new photos are uploaded now and come back as kept paths on refresh.
      const saved = { ...card, keptPaths: images, images: [] };
      setCard(saved);
      setSavedSnapshot(snapshot({ card: saved, priceDollars, valueDollars, wanted }));
      toast.success('Deal updated. The link stays the same.');
      router.refresh();
    });
  }

  function cancelLink() {
    if (!existing) return;
    startTransition(async () => {
      const result = await revokeDealInvite(existing.inviteId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmingCancelLink(false);
      toast.success('Link cancelled');
      navigateWithType(router, existing.kind === 'TRADE' ? '/trades' : '/sales', 'nav-back');
    });
  }

  function getLink() {
    setError(null);
    if (selling) {
      const problem = cashPriceProblem(priceCents);
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (!viewer.signedIn) {
      // THE ONE WRITE. The draft is only ever restored on the way back from sign-in,
      // so it is saved here, as the visitor heads there, rather than on every edit
      // (which would rewrite every photo on each pause in typing). Pressing Get link
      // again after going back to edit saves the edited draft. Awaited, so the
      // sign-in buttons only appear once the write is done.
      const draftKind = kind;
      startTransition(async () => {
        await saveDealDraft({ kind: draftKind, card, priceDollars, valueDollars, wanted });
        go('account');
      });
      return;
    }
    if (viewer.needsOnboarding) {
      go('profile');
      return;
    }
    startTransition(async () => {
      await createLink();
    });
  }

  function finishProfile() {
    setError(null);
    startTransition(async () => {
      const done = await completeQuickOnboarding({ displayName: displayName.trim(), regionCode });
      if (!done.ok) {
        setError(done.message);
        return;
      }
      await createLink();
    });
  }

  async function createLink() {
    const fmvCents = selling ? priceCents : valueCents;
    if (fmvCents == null || fmvCents < 1) {
      setError(selling ? 'Enter a price.' : 'Say what your card is worth.');
      return;
    }
    const uploaded = await pathsFromUnlistedDraft(card, fmvCents);
    if (!uploaded.ok) {
      setError(uploaded.message);
      toast.error(uploaded.message);
      return;
    }
    const result = selling
      ? await createDealInvite({
          kind: 'CASH_SALE',
          hostRole: 'SELLER',
          item: uploaded.item,
          priceCents: fmvCents,
        })
      : // An even swap. Cash to even, if any, is agreed in the room.
        await createDealInvite({
          kind: 'TRADE',
          item: uploaded.item,
          wantedDescription: wanted,
          cashAmountCents: 0,
          cashDirection: 'PROPOSER_PAYS',
          declaredValueCents: fmvCents,
        });
    if (!result.ok) {
      const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
      setError(message);
      toast.error(message);
      return;
    }
    await clearDealDraft();
    // STAY IN THE EDITOR. The deal's own page is this composer, filled in, with the
    // link now above the preview, so Get link turns the page into the deal rather than
    // sending the host to a separate screen (Stripe's payment link page).
    router.replace(`${dealHostPath(result.data.token)}&created=1`, { scroll: false });
  }

  // The invite exactly as `/t/[token]` will read it, built from the draft.
  const invite: DealInviteFactsInput = {
    kind: selling ? 'CASH_SALE' : 'TRADE',
    hostRole: 'SELLER',
    hostName: viewer.displayName?.trim() || null,
    priceCents: selling ? (priceCents ?? 0) : null,
    wantedDescription: selling ? null : wanted.trim() || null,
    offerMessage: null,
    currency: quoteCurrency,
    item: {
      id: 'draft',
      // Empty until something is typed; the preview shows its muted stand-in then.
      title: card.title.trim() !== '' || card.description.trim() !== '' ? draftTitle(card) : '',
      imagePath: null,
      fmvCents: selling ? (priceCents ?? 0) : (valueCents ?? 0),
    },
  };

  // What the share sheet pre-fills beside the link.
  const subject = card.title.trim() || null;
  const shareText = selling
    ? `Deal on NoDitto${subject ? `: ${subject}` : ''}`
    : `Trade on NoDitto${subject ? `: ${subject}` : ''}`;

  const onCardScreen = phase === 'edit' && stage === 'card';
  const action =
    phase === 'profile'
      ? finishProfile
      : onCardScreen
        ? () => goStage('deal')
        : existing
          ? saveChanges
          : getLink;
  // An existing deal saves only when something changed; a missing field still wins.
  const actionBlocked = missing != null || (existing != null && !onCardScreen && !dirty);
  const showAction = !restoring && phase !== 'account';
  // Back, beside the action, on the deal screen: the steps at the top of the form do
  // the same, but on a phone they are a screen's length away from the thumb.
  const showBack = !restoring && phase === 'edit' && stage === 'deal';
  // THE NAME DISCLOSURE, STATED AT THE BUTTON THAT RECORDS IT (Req 4.8-4.12): Get link
  // and Save changes record the seller's agreement (`nameDisclosureConsent.ts`), so it
  // is never a step of its own.
  const disclosure =
    selling && !onCardScreen && phase === 'edit'
      ? 'Before they pay, they see the name on your ID.'
      : null;
  const note = error ?? (missing && !isPending ? missing : disclosure);

  const actionButton = (className?: string) => (
    <Button
      type="button"
      size="lg"
      className={className}
      onClick={action}
      disabled={isPending || actionBlocked}
      aria-busy={isPending}
    >
      {/* Width-stable: the pending text and spinner share the resting label's grid
          cell, so the bar does not slide while the link is made. */}
      <PendingLabel
        pending={isPending}
        pendingLabel={existing ? 'Saving…' : viewer.signedIn ? 'Creating link…' : 'Saving…'}
      >
        {onCardScreen ? 'Next' : existing ? 'Save changes' : 'Get link'}
      </PendingLabel>
    </Button>
  );

  const backButton = (className?: string) => (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className={className}
      onClick={() => goStage('card')}
      disabled={isPending}
    >
      <Icon icon={CaretLeftIcon} aria-hidden />
      Back
    </Button>
  );

  return (
    <main id="main-content" className="flex flex-1 flex-col">
      {/* THE EDITOR BAR, from `md`, ON AN OPEN DEAL ONLY: close, the page's name, the
          Live badge, View as them and the More menu. A new deal has none of those
          actions, so the bar held only a close beside a name, and it cost the
          one-screen editor its height (as `ItemForm` found): there the heading is
          visible in the form column with the close beside it. The form's actions sit
          in its own footer (`ActionFooter`) either way. On a phone the site's own back
          strip tops the page. */}
      {existing ? (
      <EditorBar title="Your private deal" onClose={requestClose}>
        {/* THE STATUS BESIDE THE NAME (Stripe's "Active" badge on a payment link). */}
        {existing ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-trust/10 px-snug py-0.5 text-meta font-medium text-trust">
            <span aria-hidden className="size-1.5 rounded-full bg-trust" />
            Live
          </span>
        ) : null}
        {existing ? (
          // THE RIGHT OF THE BAR, AS THE LINK PAGES DO IT: one plain way to see the page
          // the other person gets (Stripe's and Etsy's "Preview", Squarespace's "View"),
          // and everything else, cancelling included, behind a "More" menu (Stripe,
          // Square, Squarespace). A lone red "Cancel link" was the loudest thing in the
          // bar for the action least often wanted.
          <div className="ml-auto flex items-center gap-snug">
            <Button asChild variant="secondary" size="sm">
              <a href={dealInvitePath(existing.token)} target="_blank" rel="noreferrer">
                <Icon icon={ArrowSquareOutIcon} aria-hidden />
                View as them
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="More actions"
                  disabled={isPending}
                  className="size-8 md:size-8"
                >
                  <Icon icon={DotsThreeIcon} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link href={existing.kind === 'TRADE' ? '/trades' : '/sales'}>
                    {existing.kind === 'TRADE' ? 'Go to my trades' : 'Go to my sales'}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirmingCancelLink(true)}
                >
                  <Icon icon={XCircleIcon} aria-hidden />
                  Cancel link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </EditorBar>
      ) : null}

      {/* FROM `lg` THE EDITOR IS EXACTLY ONE SCREEN: the bars above it plus this
          grid fill the viewport, so the document never scrolls. Each pane manages its
          own height: the form scrolls inside itself if a screen outgrows it, and the
          preview centres in the space it has. Below `lg` there is no preview pane and
          the page scrolls as normal. */}
      <div className={cn('grid flex-1 lg:flex-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]', existing ? EDITOR_GRID_HEIGHT : EDITOR_GRID_HEIGHT_BARLESS)}>
        {/* THE FORM COLUMN: the fields, and under them the footer with the actions.
            From `lg` the fields scroll inside the column and the footer stays at its
            foot; below `lg` the footer sticks to the bottom of the screen. */}
        <div className="flex min-w-0 flex-col lg:min-h-0">
        <div
          ref={paneRef}
          className="min-w-0 flex-1 px-4 pb-section pt-group sm:px-6 md:px-8 md:pt-section lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:pb-8 lg:pt-8"
        >
          <div className="mx-auto w-full max-w-xl">
            {restoring ? (
              <Panel
                headingRef={headingRef}
                title="Picking up your deal"
                description="Restoring your card and photos."
              >
                <div role="status" className="flex justify-center py-section text-muted-foreground">
                  <Icon icon={CircleNotchIcon} className="size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Loading</span>
                </div>
              </Panel>
            ) : phase === 'account' ? (
              <Panel
                headingRef={headingRef}
                title="Save your deal"
                description="Sign in to get the link. Your draft is kept."
                onBack={() => go('edit')}
                backDisabled={isPending}
              >
                <div className="grid max-w-sm gap-snug">
                  <GoogleSignInButton mode="sign-up" redirectTo={DEAL_RESUME_PATH}>
                    Continue with Google
                  </GoogleSignInButton>
                  <Button asChild variant="secondary" size="lg" className="w-full">
                    <Link href={`/sign-up?redirectTo=${encodeURIComponent(DEAL_RESUME_PATH)}`}>
                      Continue with email
                    </Link>
                  </Button>
                  <p className="text-meta text-muted-foreground">
                    Already have an account?{' '}
                    <Link
                      href={`/sign-in?redirectTo=${encodeURIComponent(DEAL_RESUME_PATH)}`}
                      className="font-medium text-foreground underline underline-offset-4"
                    >
                      Sign in
                    </Link>
                  </p>
                </div>
              </Panel>
            ) : phase === 'profile' ? (
              <Panel
                headingRef={headingRef}
                title="Almost done"
                description="The name other members see, and where you trade."
                onBack={() => go('edit')}
                backDisabled={isPending}
              >
                <QuickProfileFields
                  idPrefix="deal"
                  displayName={displayName}
                  onDisplayName={setDisplayName}
                  regionCode={regionCode}
                  onRegion={setRegionCode}
                  regions={regions}
                  quoteCurrency={quoteCurrency}
                />
              </Panel>
            ) : (
              <>
                {/* The page's `<h1>`. On a phone it is the visible title, since the
                    editor bar is `md` and up. On an open deal the bar names the page from
                    `md`, so it stays for the outline only; a new deal has no bar, so it
                    stays visible with the editor's close beside it (as `ItemForm` keeps
                    its close at the end of its step-tab row). Outside the spaced column,
                    so the hidden copy adds no gap above the first section. */}
                {existing ? (
                  <header className="space-y-snug md:sr-only">
                    <h1 className="text-balance text-head font-bold tracking-[-0.025em]">
                      Your private deal
                    </h1>
                    <p className="text-pretty text-body text-muted-foreground">
                      Send the link, or change the deal here. The link stays the same.
                    </p>
                  </header>
                ) : (
                  <EditorPageHeader
                    title="Start a private deal"
                    description="Sell or swap a card with anyone. Send them a link and agree the details together."
                  />
                )}

                {/* Below `lg` there is no canvas, so the link leads the page: it is the
                    thing a host came back here to send. Cancel is in the editor bar's
                    More menu from `md`; on a phone it sits under the link. */}
                {existing ? (
                  <div className="mt-section grid gap-snug lg:hidden">
                    <LinkPanel existing={existing} shareText={shareText} readiness={readiness} />
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-self-start text-destructive hover:bg-destructive/5 hover:text-destructive md:hidden"
                      disabled={isPending}
                      onClick={() => setConfirmingCancelLink(true)}
                    >
                      Cancel link
                    </Button>
                  </div>
                ) : null}

              {/* `md:mt-0` only on an open deal, whose header is hidden from `md`; a new
                  deal's visible header needs the same gap above the tabs as a phone. */}
              <div className={cn('mt-section space-y-5', existing && 'md:mt-0')}>
                <StageSteps
                  stage={stage}
                  cardDone={cardGap === null}
                  onStage={goStage}
                  disabled={isPending}
                />
                {stage === 'card' ? (
                  <div className="space-y-group">
                    {/* SELL OR TRADE FIRST, as the composer always opened: it is the
                        first decision, it words the fields below ("What are you
                        selling?"), and the preview takes its shape from it. Compact rows
                        so the card screen still fits beside the preview. */}
                    {/* FIXED ONCE THE LINK EXISTS: a sale and a swap are different
                        contracts, so changing one into the other is a new link. */}
                    <div
                      role="radiogroup"
                      aria-label="Deal type"
                      className="grid gap-cozy sm:grid-cols-2"
                    >
                      <OptionCard
                        name="deal-kind"
                        id="deal-kind-cash"
                        checked={selling}
                        onSelect={() => setKind('CASH_SALE')}
                        icon={MoneyIcon}
                        label="Sell a card"
                        hint="Send a private link"
                        disabled={existing != null && !selling}
                      />
                      <OptionCard
                        name="deal-kind"
                        id="deal-kind-trade"
                        checked={!selling}
                        onSelect={() => setKind('TRADE')}
                        icon={ArrowsLeftRightIcon}
                        label="Trade cards"
                        hint="Swap safely"
                        disabled={existing != null && selling}
                      />
                    </div>
                    {existing ? (
                      <p className="-mt-snug text-meta text-muted-foreground">
                        To switch between selling and trading, cancel this link and start a new
                        one.
                      </p>
                    ) : null}
                    <DealCardStep
                      card={card}
                      onCard={setCard}
                      selling={selling}
                      idPrefix="deal-card"
                    />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-group">
                      <DealTermsStep
                        selling={selling}
                        idPrefix="deal"
                        currency={quoteCurrency}
                        priceDollars={priceDollars}
                        onPriceDollars={setPriceDollars}
                        wanted={wanted}
                        onWanted={setWanted}
                        valueDollars={valueDollars}
                        onValueDollars={setValueDollars}
                      />
                    </div>

                    {/* A tinted note at the end of the deal (Airtasker's "Please note"):
                        nothing here is filled in, and the Stripe Identity requirement is
                        the last thing read before Get link. */}
                    <aside className="space-y-cozy rounded-xl bg-muted/60 p-group">
                      <h3 className="text-body font-semibold text-foreground">What happens next</h3>
                      <NextSteps items={dealNextSteps(selling, quoteCurrency)} />
                    </aside>

                    {/* Below `lg` there is no canvas beside the form, so the preview ends
                        the deal screen, without a device frame: the reader is already on
                        the device. */}
                    <div className="space-y-cozy border-t border-border pt-5 lg:hidden">
                      <h3 className="text-subhead font-semibold text-foreground">
                        What they&rsquo;ll see
                      </h3>
                      <InvitePreview
                        invite={invite}
                        readiness={previewReadiness}
                        imageSrc={thumb}
                        frame="none"
                      />
                      <LinkFacts />
                    </div>
                  </div>
                )}
              </div>
              </>
            )}
          </div>
        </div>
        {showAction ? (
          <ActionFooter note={note} error={Boolean(error)}>
            {showBack ? backButton('shrink-0') : null}
            {actionButton('min-w-0 flex-1 sm:min-w-36 sm:flex-none')}
          </ActionFooter>
        ) : null}
        </div>

        {/* THE CANVAS, from `lg`: a tinted pane the full height of the editor, with a
            faint dot grid (Whop's canvas), so it reads as a surface the preview sits on
            rather than as an empty grey column. */}
        <div className={EDITOR_CANVAS_CLASS}>
          {/* THE PREVIEW FILLS THE PANE. The title row at the top, the link's terms at
              the bottom, and the device takes every pixel between them (Square,
              GitBook, Whop), centred and at its real proportions. */}
          <div className="flex min-h-0 flex-1 flex-col gap-group px-10 py-8">
            {/* ONE HEADER, THE SAME SHAPE BEFORE AND AFTER THE LINK EXISTS, so Get link
                fills it in rather than adding a row: a title line with the device
                toggle, then the link in an address field (Stripe puts the live URL under
                its title; Dribbble and Navan put Copy inside the field). Nothing under it
                moves, and the preview keeps every pixel it had. */}
            <CanvasHeader
              existing={existing}
              shareText={shareText}
              readiness={readiness}
              device={device}
              onDevice={setDevice}
            />
            {/* The device is centred both ways in the space between the title row and
                the link's terms, at its real proportions. */}
            <div className="min-h-0 flex-1 py-snug">
              <InvitePreview
                invite={invite}
                readiness={previewReadiness}
                imageSrc={thumb}
                frame={device}
              />
            </div>
            {/* Centred under the device as one block, the icon beside its text. Once
                the link exists the same terms sit behind the link row's (i). */}
            {existing ? null : <LinkFacts className="mx-auto max-w-sm" />}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingClose}
        onOpenChange={setConfirmingClose}
        title={existing ? 'Discard your changes?' : 'Discard this deal?'}
        description={
          existing
            ? 'The deal and its link stay as they were saved.'
            : 'Your card, photos and terms will not be saved.'
        }
        confirmLabel="Discard"
        confirmVariant="destructive"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmingClose(false);
          leave();
        }}
      />

      <ConfirmDialog
        open={confirmingCancelLink}
        onOpenChange={setConfirmingCancelLink}
        title="Cancel this link?"
        description="It stops working straight away."
        confirmLabel="Cancel link"
        confirmVariant="destructive"
        cancelLabel="Keep link"
        pending={isPending}
        onConfirm={cancelLink}
      />
    </main>
  );
}

/**
 * The deal's link, once it exists: one compact bar with the link, Copy, Share and the
 * QR code, how long it lasts, and a real to-do from Stripe while there is one. For the
 * top of the form below `lg`; from `lg` the canvas's title row is the link (`LinkRow`).
 */
function LinkPanel({
  existing,
  shareText,
  readiness,
  className,
}: {
  existing: ExistingDeal;
  shareText: string;
  readiness: HostReadiness | null;
  className?: string;
}) {
  // The expiry in the viewer's own calendar: the server has no time zone to print,
  // so the line keeps its place and the date fills in on hydration.
  const expires = useSyncExternalStore(
    subscribeNever,
    () => formatShortDate(existing.expiresAt),
    () => null,
  );
  const todo = linkTodo(existing.kind, readiness);
  return (
    // The card edge (`.surface`) rather than a border, and the solid success disc the
    // contract timeline uses rather than a ringed tick inside a tinted ring (2026-11-28).
    <div className={cn('surface grid gap-snug rounded-xl bg-card p-cozy', className)}>
      <div className="flex items-center gap-snug px-tight">
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-trust text-white"
        >
          <Icon icon={CheckIcon} className="size-3" />
        </span>
        <p className="min-w-0 truncate text-body font-semibold text-foreground" role="status">
          {existing.justCreated ? 'Your link is ready' : 'Your link is live'}
        </p>
        <p className="ml-auto flex min-h-[1lh] shrink-0 items-center gap-tight text-meta text-muted-foreground">
          <span className={expires ? undefined : 'invisible'}>Expires {expires ?? 'soon'}</span>
          <InfoPopover label="About this link">
            Only people with the link can see it. The first person to join gets the deal. You can edit it until then.
          </InfoPopover>
        </p>
      </div>
      <DealLinkActions variant="bar" path={dealInvitePath(existing.token)} shareText={shareText} />
      {todo ? <TodoLine todo={todo} readiness={readiness} /> : null}
    </div>
  );
}

/**
 * The canvas's header. Line one: what the pane is ("Preview"), or once the link
 * exists that it is live and until when, with a real to-do from Stripe in the same
 * place when there is one. Line two: the link as an address field with Copy, Share
 * and the QR code inside it, or the same field, empty, saying where the link will
 * appear. Both lines are a fixed height in every state.
 */
function CanvasHeader({
  existing,
  shareText,
  readiness,
  device,
  onDevice,
}: {
  existing: ExistingDeal | null;
  shareText: string;
  readiness: HostReadiness | null;
  device: PreviewDevice;
  onDevice: (next: PreviewDevice) => void;
}) {
  const expires = useSyncExternalStore(
    subscribeNever,
    () => (existing ? formatShortDate(existing.expiresAt) : null),
    () => null,
  );
  const todo = existing ? linkTodo(existing.kind, readiness) : null;
  return (
    <div className="grid gap-cozy">
      <div className="flex items-start justify-between gap-group">
        <div className="min-w-0">
          <h2 className="flex items-center gap-snug text-body font-semibold text-foreground">
            {existing ? (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-trust" />
                <span role="status">
                  {existing.justCreated ? 'Your link is ready' : 'Your link is live'}
                </span>
              </>
            ) : (
              'Preview'
            )}
          </h2>
          <p className="flex min-h-[1lh] items-center gap-tight text-meta text-muted-foreground">
            {!existing ? (
              'What they see when they open your link'
            ) : todo ? (
              <span className="truncate text-action-foreground">
                {todo}{' '}
                <Link
                  href="/profile?tab=verification"
                  className="font-semibold underline underline-offset-4"
                >
                  {readiness === 'payout-setup-needed' ? 'Set up' : 'Verify'}
                </Link>
              </span>
            ) : (
              <>
                <span className={expires ? 'truncate' : 'invisible'}>
                  Expires {expires ?? 'soon'}. Only people with the link can open it.
                </span>
                <InfoPopover label="About this link">
                  Hidden from the catalog. The first person to join gets the deal. You can edit it until then.
                </InfoPopover>
              </>
            )}
          </p>
        </div>
        <DeviceToggle device={device} onDevice={onDevice} />
      </div>
      {existing ? (
        <DealLinkActions
          variant="field"
          path={dealInvitePath(existing.token)}
          shareText={shareText}
        />
      ) : (
        <div className="flex h-11 items-center gap-snug rounded-xl border border-border bg-card/70 px-cozy text-body text-muted-foreground">
          <Icon icon={LockIcon} className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Your link will appear here</span>
        </div>
      )}
    </div>
  );
}

/**
 * A real to-do from Stripe, or null. Agreeing to show the verified name is recorded
 * by Get link and Save changes (`nameDisclosureConsent.ts`), so it is never one.
 */
function linkTodo(kind: 'CASH_SALE' | 'TRADE', readiness: HostReadiness | null): string | null {
  if (readiness === 'identity-needed') {
    return kind === 'TRADE'
      ? 'Verify with Stripe Identity before the holds go on.'
      : 'Verify with Stripe Identity so they can pay.';
  }
  if (readiness === 'payout-setup-needed') {
    return 'Finish payout setup so they can pay. Stripe needs it for this currency.';
  }
  return null;
}

function TodoLine({ todo, readiness }: { todo: string; readiness: HostReadiness | null }) {
  return (
    <p className="flex items-center gap-snug rounded-lg bg-action/25 px-cozy py-snug text-meta text-action-foreground">
      <span className="min-w-0 flex-1 text-pretty">{todo}</span>
      <Link href="/profile?tab=verification" className="shrink-0 font-semibold underline underline-offset-4">
        {readiness === 'payout-setup-needed' ? 'Set up' : 'Verify'}
      </Link>
    </p>
  );
}

function subscribeNever() {
  return () => {};
}

/**
 * The two screens as numbered steps above the form (Contra's Details / Content).
 * Either can be chosen; the deal screen waits until the card is complete, the same
 * rule that enables Next. A finished card step shows a tick.
 */
function StageSteps({
  stage,
  cardDone,
  onStage,
  disabled,
}: {
  stage: Stage;
  cardDone: boolean;
  onStage: (next: Stage) => void;
  disabled: boolean;
}) {
  return (
    <EditorSteps
      steps={[
        { label: 'Your card', done: cardDone && stage === 'deal', enabled: true },
        { label: 'Terms', done: false, enabled: cardDone },
      ]}
      current={stage === 'card' ? 0 : 1}
      onSelect={(index) => onStage(index === 0 ? 'card' : 'deal')}
      disabled={disabled}
    />
  );
}
/** A panel that stands in for the form: sign-in, or a new account's two questions. */
function Panel({
  headingRef,
  title,
  description,
  onBack,
  backDisabled = false,
  children,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  description: string;
  onBack?: () => void;
  backDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-section">
      <div className="space-y-cozy">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="-ml-1 inline-flex items-center gap-tight rounded-sm border border-transparent text-body font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:border-ring disabled:opacity-50"
          >
            <Icon icon={CaretLeftIcon} className="size-4" aria-hidden />
            Back to your deal
          </button>
        ) : null}
        <div className="space-y-snug">
          {/* `tabIndex={-1}`: focus moves here when the panel opens. Never in the tab
              order. */}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-balance text-head font-bold tracking-[-0.025em] focus:outline-none md:text-display"
          >
            {title}
          </h1>
          <p className="text-pretty text-body text-muted-foreground md:text-lead">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

type PreviewDevice = 'phone' | 'desktop';

/** Phone or desktop preview, as Stripe and Square switch theirs. */
function DeviceToggle({
  device,
  onDevice,
}: {
  device: PreviewDevice;
  onDevice: (next: PreviewDevice) => void;
}) {
  const options = [
    { value: 'phone', label: 'Phone preview', icon: DeviceMobileIcon },
    { value: 'desktop', label: 'Desktop preview', icon: DesktopIcon },
  ] as const;
  return (
    // A segmented control (2026-11-28): a tinted track with the chosen segment
    // raised in white, the iOS and Airbnb shape, instead of a bordered white box.
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
      {options.map((option) => {
        const active = device === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => onDevice(option.value)}
            className={cn(
              'grid size-8 place-items-center rounded-md border border-transparent transition-colors focus:outline-none focus-visible:border-ring',
              active
                ? 'bg-card text-foreground shadow-[0_1px_2px_hsl(var(--obsidian)/0.12)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon icon={option.icon} className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The invite as the page at the end of the link draws it, in the frame for the
 * chosen device, or bare for the in-form preview on a phone. The card is
 * `DealInviteGuestCard`, the component `/t/[token]` itself renders for a signed-out
 * visitor, so this is the page rather than a drawing of it. `inert` and hidden from
 * assistive tech: it is a picture, and its button does nothing here.
 */
function InvitePreview({
  invite,
  readiness,
  imageSrc,
  frame,
}: {
  invite: DealInviteFactsInput;
  readiness: HostReadiness;
  imageSrc: string | null;
  frame: PreviewDevice | 'none';
}) {
  const card = (
    <DealInviteGuestCard
      invite={invite}
      readiness={readiness}
      imageSrc={imageSrc}
      placeholders={{
        amount: invite.kind === 'TRADE' ? "Your card's value" : 'Your price',
        title: 'Your card',
      }}
      action={
        <Button size="lg" className="w-full" tabIndex={-1}>
          Sign in
        </Button>
      }
    />
  );

  if (frame === 'none') {
    return (
      <div aria-hidden inert className="pointer-events-none select-none rounded-xl bg-muted/60 p-cozy">
        {card}
      </div>
    );
  }

  return (
    <div aria-hidden inert className="pointer-events-none size-full select-none">
      {frame === 'phone' ? (
        <DeviceStage width={PHONE.width} height={PHONE.height}>
          <PhoneDevice>{card}</PhoneDevice>
        </DeviceStage>
      ) : (
        <DeviceStage width={BROWSER.width} height={BROWSER.height}>
          <BrowserDevice>{card}</BrowserDevice>
        </DeviceStage>
      )}
    </div>
  );
}


/** The link's own terms, under the preview. */
function LinkFacts({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-snug text-pretty text-meta text-muted-foreground',
        className,
      )}
    >
      <Icon icon={EyeSlashIcon} className="mt-px size-4 shrink-0" aria-hidden />
      Only people with the link can see it. It lasts 14 days, and you can cancel it any time.
    </p>
  );
}

