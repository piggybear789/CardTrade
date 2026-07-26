'use client';

// components/deals/DealRoom.tsx
//
// THE DEAL ROOM — the live view of a private 1:1 binding deal, laid out as the
// same bilateral contract room as the cash sale (`components/sales/CashSaleView`)
// so the two flows read identically:
//
//   header (eyebrow + title + money summary + live status badge)
//   agree-and-engage bar   <- pinned directly beneath the header, exactly like
//                             the sale room's "agree and pay", so the one action
//                             that moves the deal forward is never below the fold
//   what's being dealt
//   party column · chat · party column
//   progress → handover terms → money terms → collateral → binding contract
//   history
//
// A deal is created SOLO and shared as a LINK, so the room has two shapes:
//   * UNJOINED (state INVITED, `counterparty_id` null): the middle column is the
//     share link, and the second party column is an empty seat.
//   * JOINED: the full two-party contract above.
//
// IDENTITY OR MONEY: verification is not a gate. Two verified parties make the
// deal binding with nothing held; if either is unverified, BOTH are held for the
// deal's stake instead (`domain/deal/dealCollateral.ts`). The Collateral card
// states which of the two is happening before anybody confirms.
//
// CRITICAL RULE surfaced here: if either party edits a substantive term, the
// database clears BOTH confirmations. The room shows "Terms changed — both
// parties must confirm again" and the confirm control resets for both sides.

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Ban,
  Check,
  CircleDot,
  Clock,
  Handshake,
  Link2,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
  UserPlus,
  UserRound,
  Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DealStateBadge } from '@/components/deals/DealStateBadge';
import { EditTermsDialog } from '@/components/deals/EditTermsDialog';
import { ShareDealLink } from '@/components/deals/ShareDealLink';
import { ContractChat } from '@/components/messages/ContractChat';
import { ContractWorkspace } from '@/components/layout/ContractWorkspace';
import { useDealRealtime } from '@/lib/realtime/useDealRealtime';
import { dealStakeCents } from '@/domain/deal/dealCollateral';
import { formatAud, formatRelativeTime, itemImageUrl } from '@/lib/format';
import {
  DEAL_COLLATERAL_MAX,
  DEAL_COLLATERAL_MIN,
  DEAL_DEFAULT_COLLATERAL_CENTS,
  DEAL_REASON_MAX,
} from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';
import {
  cancelDeal,
  completeDeal,
  confirmDeal,
  ensureDealConversation,
  raiseDealDispute,
  unconfirmDeal,
  type DealOfferKind,
  type DealParty,
  type DealRole,
  type DealRow,
  type DealView,
} from '@/lib/actions/deals';

/** Short role label for a party column badge (matches the sale room's badge). */
const ROLE_BADGE: Record<DealRole, string> = {
  BUYER: 'Buyer',
  SELLER: 'Seller',
  TRADER: 'Trader',
};

/** How the creator's declared side reads in the terms. */
const CREATOR_ROLE_LABELS: Record<DealRole, string> = {
  BUYER: 'Buying (pays cash)',
  SELLER: 'Selling (receives cash)',
  TRADER: 'Trading',
};

/** How each tradable component the creator put up reads in the room. */
const OFFER_LABELS: Record<DealOfferKind, string> = {
  CARDS: 'cards',
  CASH: 'cash',
  ITEMS: 'other items',
};

/** Label a stored offer kind, falling back to the raw value for safety. */
function offerLabel(kind: string): string {
  return OFFER_LABELS[kind as DealOfferKind] ?? kind;
}

/** Friendly messages for the typed errors any deal action can return. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in again.',
  'not-participant': 'You are not part of this deal.',
  'not-permitted': 'You cannot do that on this deal.',
  'invalid-state': 'The deal has moved on — refreshing.',
  'not-joined': 'Nobody has joined this deal yet — share the link first.',
  'terms-incomplete': 'Agree the handover before confirming.',
  'escrow-failed':
    'The collateral hold could not be placed. Both confirmations were cleared — add a payment method, or verify your identity, and try again.',
  'already-recorded': 'You have already marked this deal complete.',
  'invalid-reason': 'Add a short reason.',
  'persistence-error': 'Something went wrong. Please try again.',
};

function messageFor(error: string, detail?: string): string {
  return ERROR_MESSAGES[error] ?? detail ?? 'Something went wrong.';
}

/** True when the handover terms are fully specified for the chosen method. */
function termsCompleteFor(deal: DealRow): boolean {
  if (deal.handover_method === 'IN_PERSON') {
    return Boolean(deal.meeting_location && deal.meeting_location.trim());
  }
  if (deal.handover_method === 'DELIVERY') {
    return Boolean(deal.delivery_details && deal.delivery_details.trim());
  }
  return false;
}

/** Format an ISO timestamp as a readable local date + time. */
function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A party's label, falling back to a neutral name. Accepts `null` because an
 * unjoined deal has no counterparty yet.
 */
function nameOf(party: DealParty | null): string {
  return party?.displayName?.trim() || 'Poke-xchange member';
}

export interface DealRoomProps {
  /** Server-rendered snapshot from `getDeal`. */
  view: DealView;
  /** The signed-in user's id. */
  myUserId: string;
}

/** The live deal room for one private 1:1 binding deal. */
export function DealRoom({ view, myUserId }: DealRoomProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(view.conversationId);
  const [chatError, setChatError] = useState(false);

  const { deal: liveDeal, holds: liveHolds, connectionStatus } = useDealRealtime(
    view.deal.id,
  );

  // Realtime is authoritative once it has loaded; otherwise use the SSR snapshot.
  const deal = liveDeal ?? view.deal;
  const holds = liveHolds.length > 0 ? liveHolds : view.holds;

  const iAmCreator = deal.creator_id === myUserId;
  // Nobody has taken the share link yet: there is no counterparty to render.
  const awaitingJoin = deal.counterparty_id === null;
  const me: DealParty = iAmCreator
    ? view.creator
    : (view.counterparty ?? view.creator);
  const them: DealParty | null = iAmCreator ? view.counterparty : view.creator;

  const myConfirmedAt = iAmCreator
    ? deal.creator_confirmed_at
    : deal.counterparty_confirmed_at;
  const theirConfirmedAt = iAmCreator
    ? deal.counterparty_confirmed_at
    : deal.creator_confirmed_at;
  const myConfirmed = myConfirmedAt !== null;
  const theirConfirmed = theirConfirmedAt !== null;

  const bothVerified = them !== null && me.isVerified && them.isVerified;
  // Identity or money. Two verified parties hold nothing; anything else and BOTH
  // sides are held for the deal's stake, recomputed from the live terms.
  const collateralRequired = them === null ? !me.isVerified : !bothVerified;
  const collateralStakeCents = dealStakeCents(
    {
      collateralCents: deal.collateral_cents,
      cashAmountCents: deal.cash_amount_cents,
    },
    {
      defaultCents: DEAL_DEFAULT_COLLATERAL_CENTS,
      minCents: DEAL_COLLATERAL_MIN,
      maxCents: DEAL_COLLATERAL_MAX,
    },
  );
  const termsComplete = termsCompleteFor(deal);
  const bothConfirmed = myConfirmed && theirConfirmed;
  const escrowEngaged =
    deal.state === 'ESCROW_PENDING' ||
    deal.state === 'ESCROW_LOCKED' ||
    deal.state === 'COMPLETED' ||
    deal.state === 'DISPUTED';

  const iMarkedComplete = view.completeMarkedBy.includes(myUserId);
  const theyMarkedComplete = them
    ? view.completeMarkedBy.includes(them.id)
    : false;

  const canEditTerms = deal.state === 'TERMS' || deal.state === 'CONFIRMATION';
  const canConfirm = deal.state === 'TERMS' || deal.state === 'CONFIRMATION';
  const canCancel =
    deal.state === 'INVITED' || deal.state === 'TERMS' || deal.state === 'CONFIRMATION';

  // The terms were edited after the deal opened and nobody is confirmed: the DB
  // trigger cleared both ticks, so say so plainly.
  const termsChangedNotice =
    deal.state === 'CONFIRMATION' &&
    Boolean(deal.terms_updated_at) &&
    !myConfirmed &&
    !theirConfirmed &&
    new Date(deal.terms_updated_at ?? 0).getTime() >
      new Date(deal.created_at).getTime() + 1000;

  // Deals joined before chat existed (or an interrupted join) heal on first
  // view: the server resolves or creates the participant thread. Unjoined deals
  // have no second participant, so there is nothing to open yet.
  useEffect(() => {
    const linked = deal.conversation_id ?? view.conversationId;
    if (linked) {
      setChatId(linked);
      return;
    }
    if (deal.counterparty_id === null) return;
    let cancelled = false;
    void ensureDealConversation(deal.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setChatId(result.conversationId);
      else setChatError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [deal.id, deal.conversation_id, deal.counterparty_id, view.conversationId]);

  const cashCents = deal.cash_amount_cents;
  const deliveryCents = deal.delivery_cost_cents ?? 0;
  const totalCents = (cashCents ?? 0) + deliveryCents;

  /** Run a deal action, toasting the outcome and refreshing server data. */
  function run(
    key: string,
    action: () => Promise<{ ok: true } | { ok: false; error: string; detail?: string }>,
    successMessage: string,
  ) {
    setPendingAction(key);
    startTransition(async () => {
      const result = await action();
      setPendingAction(null);
      if (result.ok) {
        toast.success(successMessage);
      } else {
        toast.error(messageFor(result.error, result.detail));
      }
      router.refresh();
    });
  }

  const busy = (key: string) => isPending && pendingAction === key;

  const steps: { label: string; done: boolean }[] = [
    { label: 'Other party joined', done: them !== null },
    { label: 'Handover agreed', done: termsComplete },
    { label: 'Both confirmed', done: bothConfirmed || escrowEngaged },
    {
      label: collateralRequired ? 'Collateral locked' : 'Contract binding',
      done:
        deal.state === 'ESCROW_LOCKED' ||
        deal.state === 'COMPLETED' ||
        deal.state === 'DISPUTED',
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Private deal
          </p>
          {/* The page-level <h1> is the shell's "Deal Room"; the deal's own
              title is the section heading beneath it. */}
          <h2 className="truncate text-2xl font-semibold tracking-tight">
            {deal.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {cashCents == null
              ? 'No cash — goods only'
              : `${formatAud(totalCents)} total · ${formatAud(cashCents)} cash`}
            {deliveryCents > 0 ? ` · ${formatAud(deliveryCents)} delivery` : ''}
            {' · '}
            {them ? `with ${nameOf(them)}` : 'waiting for someone to join'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Same connection treatment as the sale room: announced to screen
              readers, and a distinct Offline state once reconnects are
              exhausted rather than showing "Connecting" forever. */}
          {(() => {
            const live = connectionStatus === 'live';
            const offline = connectionStatus === 'error';
            const label = live ? 'Live' : offline ? 'Offline' : 'Connecting';
            return (
              <span
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
                aria-label={`Connection status: ${label}`}
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    live
                      ? 'bg-emerald-500'
                      : offline
                        ? 'bg-destructive'
                        : 'bg-amber-500',
                  )}
                  aria-hidden
                />
                {label}
              </span>
            );
          })()}
          <DealStateBadge state={deal.state} />
        </div>
      </header>

      {/* Terms-changed notice (the critical rule) */}
      {termsChangedNotice ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong>Terms changed</strong> — both parties must confirm again before
            the deal becomes binding.
          </p>
        </div>
      ) : null}

      {/* Both parties must confirm the same terms before the deal binds */}
      {canConfirm ? (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="size-4 text-primary" aria-hidden />
              Agree and engage
            </CardTitle>
            <CardDescription>
              {collateralRequired
                ? `When you both confirm, each side agrees we can charge their card ${formatAud(collateralStakeCents)} if they do not hold up their end. Nothing is charged otherwise.`
                : 'When you both confirm, the deal becomes binding on your verified identities — no card is involved.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {awaitingJoin ? (
              <p className="text-sm text-muted-foreground">
                Share the link first — a deal only binds between two parties.
              </p>
            ) : !termsComplete ? (
              <p className="text-sm text-muted-foreground">
                Agree the handover above, then you can both confirm.
              </p>
            ) : null}

            {/* Pill-style acceptance ticks, matching the sale room's bar. */}
            <ul className="flex flex-wrap items-center gap-2" aria-live="polite">
              {(
                [
                  { label: 'You', confirmed: myConfirmed },
                  { label: nameOf(them), confirmed: theirConfirmed },
                ] as const
              ).map((entry) => (
                <li
                  key={entry.label}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1',
                    entry.confirmed
                      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700'
                      : 'border-border bg-muted/50 text-muted-foreground',
                  )}
                >
                  {entry.confirmed ? (
                    <Check className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <CircleDot className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 truncate text-xs font-medium">
                    {entry.label} {entry.confirmed ? '✓' : '— pending'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 sm:flex-row">
              {myConfirmed ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="sm:flex-1"
                  disabled={isPending || deal.state !== 'CONFIRMATION'}
                  aria-busy={busy('unconfirm')}
                  onClick={() =>
                    run(
                      'unconfirm',
                      () => unconfirmDeal(deal.id),
                      'Confirmation withdrawn.',
                    )
                  }
                >
                  {busy('unconfirm') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  You confirmed — withdraw
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="sm:flex-1"
                  disabled={
                    isPending || deal.state !== 'CONFIRMATION' || !termsComplete
                  }
                  aria-busy={busy('confirm')}
                  onClick={() =>
                    run(
                      'confirm',
                      () => confirmDeal(deal.id),
                      "Confirmed — you're happy with the deal.",
                    )
                  }
                >
                  {busy('confirm') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  {theirConfirmed
                    ? 'Confirm — this makes it binding'
                    : "I'm happy with the deal"}
                </Button>
              )}

              {canCancel ? (
                <ReasonDialog
                  title="Cancel this deal?"
                  description="You can cancel until the deal becomes binding. Once collateral is locked, you must complete or dispute it."
                  confirmLabel="Cancel deal"
                  triggerLabel="Cancel"
                  triggerVariant="outline"
                  triggerSize="lg"
                  reasonRequired={false}
                  onConfirm={(reason) =>
                    run(
                      'cancel',
                      () => cancelDeal(deal.id, reason || undefined),
                      'Deal cancelled.',
                    )
                  }
                />
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              Cancelling before you both confirm is free. Either of you can still
              edit the terms, which clears both confirmations.
            </p>
          </CardContent>
        </Card>
      ) : null}


      {/* What is being dealt — the deal's own description, goods and photos. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What&apos;s being dealt</CardTitle>
          {deal.creator_role ? (
            <CardDescription>
              {iAmCreator ? 'You are' : `${nameOf(them)} is`}{' '}
              {CREATOR_ROLE_LABELS[deal.creator_role].toLowerCase()}
              {deal.creator_offer_kinds.length > 0
                ? ` — putting up ${deal.creator_offer_kinds.map(offerLabel).join(', ')}`
                : ''}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {deal.description ? (
            <p className="whitespace-pre-wrap">{deal.description}</p>
          ) : (
            <p className="text-muted-foreground">No description was added.</p>
          )}

          {deal.creator_photo_paths.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {deal.creator_photo_paths.map((path) => {
                const url = itemImageUrl(path);
                if (!url) return null;
                return (
                  <li
                    key={path}
                    className="aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Photo attached to this deal"
                      className="h-full w-full object-cover"
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TermsField
              label="You bring"
              value={iAmCreator ? deal.creator_item_text : deal.counterparty_item_text}
            />
            <TermsField
              label={them ? `${nameOf(them)} brings` : 'They bring'}
              value={iAmCreator ? deal.counterparty_item_text : deal.creator_item_text}
            />
          </div>

          {/* The terms editor also lives as a small button on the Handover card,
              but a joiner naturally looks for "what I bring" here — so surface a
              clear entry point right beside their own side. */}
          {canEditTerms ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                {(iAmCreator ? deal.creator_item_text : deal.counterparty_item_text)
                  ? 'Need to change what you\u2019re putting up, the cash, or the collateral?'
                  : 'Add the items you\u2019re bringing to this deal, plus any cash or collateral.'}
              </p>
              <EditTermsDialog
                deal={deal}
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel={
                  (iAmCreator ? deal.creator_item_text : deal.counterparty_item_text)
                    ? 'Edit your items'
                    : 'Add your items'
                }
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Compact participant summary beside a properly bounded conversation
          panel (demo-contract-ux Req 1, 2). */}
      <ContractWorkspace
        parties={
          <>
            <PartyColumn
              party={me}
              isMe
              confirmed={myConfirmed}
              collateralRequired={collateralRequired}
              collateralCents={collateralStakeCents}
            />
            {them ? (
              <PartyColumn
                party={them}
                isMe={false}
                confirmed={theirConfirmed}
                collateralRequired={collateralRequired}
                collateralCents={collateralStakeCents}
              />
            ) : (
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <UserPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    Open seat
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Whoever opens your share link takes this seat. You&apos;ll see
                  their name, reputation and verification here.
                </CardContent>
              </Card>
            )}
          </>
        }
        conversation={
          awaitingJoin ? (
            <Card className="border-primary/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="size-4 text-primary" aria-hidden />
                  Share this link
                </CardTitle>
                <CardDescription>
                  Whoever opens it and signs in joins as the other party — then
                  chat opens here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ShareDealLink shareToken={view.shareToken} title={deal.title} />
                <p className="text-xs text-muted-foreground">
                  Only send it to the person you mean to deal with: the first
                  person to open it takes the seat. Cancel the deal and the link
                  stops working.
                </p>
              </CardContent>
            </Card>
          ) : chatId ? (
            <ContractChat
              conversationId={chatId}
              currentUserId={myUserId}
              counterpartyName={nameOf(them)}
              title="Deal chat"
              placeholder="Message about the deal…"
              emptyHint="Use chat to coordinate. Only the saved terms are binding."
              contractHref={`/messages/${chatId}`}
            />
          ) : (
            <Card className="grid flex-1 place-items-center">
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                {chatError ? (
                  <>
                    Chat could not be opened.{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-4"
                      onClick={() => {
                        setChatError(false);
                        void ensureDealConversation(deal.id).then((result) => {
                          if (result.ok) setChatId(result.conversationId);
                          else setChatError(true);
                        });
                      }}
                    >
                      Try again
                    </button>
                  </>
                ) : (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Opening chat…
                  </span>
                )}
              </CardContent>
            </Card>
          )
        }
      />

      {/* Progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Progress</CardTitle>
          <CardDescription>
            {awaitingJoin
              ? 'Share the link to bring in the other party.'
              : escrowEngaged
                ? 'This deal is binding.'
                : 'Agree the handover, then you both confirm.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Deal progress">
            {steps.map((step, index) => (
              <li
                key={step.label}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                  step.done && 'border-gold/50 bg-gold/10 font-medium',
                )}
              >
                {step.done ? (
                  <Check className="size-4 shrink-0 text-gold" aria-hidden />
                ) : (
                  <span
                    className="grid size-4 shrink-0 place-items-center text-xs text-muted-foreground"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                )}
                <span className="min-w-0 truncate">{step.label}</span>
                <span className="sr-only">{step.done ? 'Complete' : 'Not complete'}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Handover terms */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Handover terms
              {deal.terms_updated_at ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  updated {formatRelativeTime(deal.terms_updated_at)}
                </span>
              ) : null}
            </CardTitle>
            {canEditTerms ? (
              <EditTermsDialog
                deal={deal}
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel={termsComplete ? 'Edit terms' : 'Agree terms'}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {deal.handover_method === 'IN_PERSON' ? (
            <>
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-primary" aria-hidden />
                Meet at {deal.meeting_location}
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                {formatDateTime(deal.meeting_at) ?? 'No time agreed yet.'}
              </p>
            </>
          ) : deal.handover_method === 'DELIVERY' ? (
            <p className="flex items-start gap-2">
              <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="whitespace-pre-wrap">{deal.delivery_details}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Not agreed yet — choose a face-to-face meeting or a delivery.
            </p>
          )}
          {canEditTerms ? (
            <p className="text-xs text-muted-foreground">
              Editing terms clears both confirmations. The deal becomes binding only
              once you both confirm the same terms.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Money terms */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Money terms</CardTitle>
        </CardHeader>
        <CardContent>
          {cashCents == null ? (
            <p className="text-sm text-muted-foreground">
              No cash component — this deal is goods for goods.
            </p>
          ) : (
            <dl className="rounded-md border text-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-muted-foreground">Cash amount</dt>
                <dd className="font-medium tabular-nums">{formatAud(cashCents)}</dd>
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3">
                <dt className="text-muted-foreground">
                  {deal.handover_method === 'DELIVERY'
                    ? 'Delivery'
                    : 'Delivery (not applicable)'}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatAud(deliveryCents)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3">
                <dt className="font-semibold">
                  {deal.cash_payer_id === myUserId
                    ? 'You pay'
                    : deal.cash_payer_id
                      ? `${nameOf(them)} pays`
                      : 'Payer not agreed'}
                </dt>
                <dd className="text-base font-semibold tabular-nums">
                  {formatAud(totalCents)}
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Cash and goods change hands between the two of you at the handover.
            Poke-xchange holds only the collateral below.
          </p>
        </CardContent>
      </Card>

      {/* Collateral — identity or money */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-primary" aria-hidden />
            Collateral
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!collateralRequired ? (
            <p className="text-muted-foreground">
              No collateral required.{' '}
              {them
                ? 'You are both identity verified, so this deal is binding on your identities alone.'
                : 'You are identity verified. If an unverified member joins, both sides post collateral.'}
            </p>
          ) : (
            <>
              <p>
                {them === null
                  ? 'You are not identity verified, so both sides will post collateral once the deal is confirmed.'
                  : !me.isVerified && !them.isVerified
                    ? 'Neither of you is identity verified, so both sides post collateral.'
                    : !me.isVerified
                      ? 'You are not identity verified, so both sides post collateral.'
                      : `${nameOf(them)} is not identity verified, so both sides post collateral.`}
              </p>
              <dl className="rounded-md border">
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-muted-foreground">Your collateral</dt>
                  <dd className="font-medium tabular-nums">
                    {formatAud(collateralStakeCents)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <dt className="text-muted-foreground">
                    {them ? `${nameOf(them)}'s collateral` : "The other party's collateral"}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatAud(collateralStakeCents)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Held when you both confirm, released as soon as you both mark the
                deal complete. Collateral is symmetric so neither side carries the
                risk alone.
              </p>
              {!me.isVerified && !escrowEngaged ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/profile#payouts">Verify my identity instead</Link>
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Binding contract + collateral holds */}
      {escrowEngaged ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-primary" aria-hidden />
              Binding contract
            </CardTitle>
            <CardDescription>
              {deal.state === 'ESCROW_PENDING'
                ? 'Engaging the contract…'
                : deal.state === 'DISPUTED'
                  ? 'Each side’s card stays on the line while the dispute is resolved.'
                  : deal.state === 'COMPLETED'
                    ? 'Deal complete — nobody was charged.'
                    : holds.length === 0
                      ? 'Binding on both parties’ verified identities — no card is involved.'
                      : `Each side has agreed we can charge their card up to ${formatAud(view.collateralCents)}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="space-y-2" aria-label="Collateral holds">
              {holds.length === 0 ? (
                <li className="text-muted-foreground">
                  {deal.state === 'ESCROW_PENDING'
                    ? 'No holds recorded yet.'
                    : 'No collateral held — both parties are identity verified.'}
                </li>
              ) : (
                holds.map((hold) => (
                  <li
                    key={hold.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <span className="min-w-0 truncate">
                      {hold.party_id === myUserId
                        ? 'Your collateral'
                        : `${nameOf(them)}'s collateral`}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-medium tabular-nums">
                        {formatAud(hold.amount_cents)}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {hold.status.toLowerCase().replace('_', ' ')}
                      </span>
                    </span>
                  </li>
                ))
              )}
            </ul>

            {deal.state === 'ESCROW_LOCKED' ? (
              <div className="space-y-3 rounded-md border p-3">
                <p className="font-medium">Both parties confirm the handover</p>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {iMarkedComplete ? 'You confirmed. ' : 'You pending. '}
                  {theyMarkedComplete
                    ? `${nameOf(them)} confirmed.`
                    : `${nameOf(them)} pending.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={isPending || iMarkedComplete}
                    aria-busy={busy('complete')}
                    onClick={() =>
                      run('complete', () => completeDeal(deal.id), 'Marked complete.')
                    }
                  >
                    {busy('complete') ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Handshake aria-hidden />
                    )}
                    {iMarkedComplete ? 'Marked complete' : 'Mark complete'}
                  </Button>
                  <ReasonDialog
                    title="Raise a dispute?"
                    description="Collateral stays held while the dispute is reviewed. Tell us what went wrong."
                    confirmLabel="Raise dispute"
                    triggerLabel="Raise dispute"
                    triggerVariant="destructive"
                    reasonRequired
                    onConfirm={(reason) =>
                      run(
                        'dispute',
                        () => raiseDealDispute(deal.id, reason),
                        'Dispute raised.',
                      )
                    }
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Cancelled summary */}
      {deal.state === 'CANCELLED' ? (
        <Card>
          <CardContent className="flex items-start gap-2 pt-6 text-sm">
            <Ban className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">This deal was cancelled</p>
              <p className="text-muted-foreground">
                {deal.cancel_reason ?? 'No reason was given.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {view.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ol className="space-y-3" aria-label="Deal history">
              {view.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <CircleDot
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {event.event.toLowerCase().replace(/_/g, ' ')}
                      {event.actor_id === myUserId ? ' (you)' : ''}
                    </p>
                    {event.detail ? (
                      <p className="text-muted-foreground">{event.detail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(event.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

/**
 * One participant column: who they are, how they are backed, and what they have
 * agreed to. Deliberately the same shape as the cash sale room's party column.
 */
function PartyColumn({
  party,
  isMe,
  confirmed,
  collateralRequired,
  collateralCents,
}: {
  party: DealParty;
  isMe: boolean;
  confirmed: boolean;
  collateralRequired: boolean;
  collateralCents: number;
}) {
  return (
    <Card className={isMe ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{isMe ? 'You' : nameOf(party)}</span>
          </CardTitle>
          {party.role ? (
            <Badge variant="outline" className="shrink-0 text-xs">
              {ROLE_BADGE[party.role]}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isMe ? (
          <p className="truncate text-xs text-muted-foreground">{nameOf(party)}</p>
        ) : null}

        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            // Teal (trust) is the reserved token for verified identity; an
            // unverified party is a caution, not an error. Matches the sale room.
            party.isVerified ? 'text-trust' : 'text-amber-700 dark:text-amber-400',
          )}
        >
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {party.isVerified ? 'Identity verified (KYC)' : 'Identity not verified'}
        </p>

        <dl className="space-y-1.5 border-t pt-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Feedback</dt>
            <dd className="flex items-center gap-1 font-medium">
              {party.rating === null ? (
                <span className="text-muted-foreground">No reviews yet</span>
              ) : (
                <>
                  <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {Number(party.rating).toFixed(1)}
                  <span className="font-normal text-muted-foreground">
                    ({party.ratingCount})
                  </span>
                </>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Sales completed</dt>
            <dd className="font-medium tabular-nums">{party.completedSales}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Purchases completed</dt>
            <dd className="font-medium tabular-nums">{party.completedPurchases}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Collateral</dt>
            <dd className="font-medium tabular-nums">
              {collateralRequired ? (
                formatAud(collateralCents)
              ) : (
                <span className="font-normal text-muted-foreground">Not required</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="flex items-center gap-2 border-t pt-3 text-xs" aria-live="polite">
          {confirmed ? (
            <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <CircleDot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {confirmed ? 'Confirmed the current terms' : 'Has not confirmed the current terms'}
        </p>
      </CardContent>
    </Card>
  );
}

/** A confirm dialog that collects an optional or required short reason. */
function ReasonDialog({
  title,
  description,
  confirmLabel,
  triggerLabel,
  triggerVariant,
  triggerSize = 'sm',
  reasonRequired,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  triggerVariant: 'outline' | 'ghost' | 'destructive';
  triggerSize?: 'sm' | 'lg' | 'default';
  reasonRequired: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const inputId = `reason-${confirmLabel.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size={triggerSize}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={inputId}>
            Reason{reasonRequired ? '' : ' (optional)'}
          </Label>
          <Textarea
            id={inputId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={DEAL_REASON_MAX}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant={triggerVariant === 'destructive' ? 'destructive' : 'default'}
            disabled={reasonRequired && reason.trim().length === 0}
            onClick={() => {
              onConfirm(reason.trim());
              setOpen(false);
              setReason('');
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled read-only terms field with an empty fallback. */
function TermsField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        {value?.trim() ? value : <span className="text-muted-foreground">Not set</span>}
      </p>
    </div>
  );
}
