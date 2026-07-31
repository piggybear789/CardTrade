'use client';

// components/deals/DealRoom.tsx
//
// THE DEAL ROOM — the live view of a private 1:1 binding deal, on the same three pieces
// as the cash sale and trade rooms:
//
//   header        deal title · money · You ⇄ Ada ✓ (or an open seat) · deal state
//   ┌ your move ─────────────────────┬ chat / share link ┐
//   └────────────────────────────────┴───────────────────┘
//   ●──●──○──○──○   Join Evidence Terms Confirm Binding Done
//   Summary · Items · Terms · Money · Collateral · History   (inspector tabs)
//
// A deal is created SOLO and shared as a LINK, so the room has two shapes: while nobody
// has joined, the conversation column carries the share link and the party line shows an
// open seat; once joined it is the full two-party contract.
//
// IDENTITY OR MONEY: verification is not a gate. Two verified parties make the deal
// binding with nothing held by default; if either is unverified — or the deal opts into
// DittoEscrow (`collateral_opt_in`) — BOTH are held for the deal's stake
// (`domain/deal/dealCollateral.ts`).
//
// CASH VIA PINCH: meetup/delivery is goods and inspection only. Any cash component
// is charged on confirm and settled through Pinch when both mark complete — never
// handed over as physical cash.
//
// CRITICAL RULE surfaced here: if either party edits a substantive term (including
// opt-in), the database clears BOTH confirmations. The action card says so and the
// confirm control resets for both sides.

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Handshake, Link2, Loader2, Pencil } from 'lucide-react';

import { PlaceMap } from '@/components/location';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  ContractActionCard,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
  ContractExchangePanel,
  ContractFocusProvider,
  ContractHeader,
  ContractHoldList,
  ContractLiveRow,
  ContractMoneyTable,
  ContractPartyLine,
  ContractProgressRail,
  ContractTimeline,
  useContractConversation,
  useContractFocus,
  type ContractActionTone,
  type ContractExchangeSide,
  type ContractHold,
  type ContractParty,
} from '@/components/contract';
import { DEAL_SECTIONS, currentStep, deriveDealSteps } from '@/domain/contract';
import { DealStateBadge, type DealState } from '@/components/deals/DealStateBadge';
import { EditTermsDialog } from '@/components/deals/EditTermsDialog';
import { ShareDealLink } from '@/components/deals/ShareDealLink';
import { useDealRealtime } from '@/lib/realtime/useDealRealtime';
import { resolveDealCollateral } from '@/domain/deal/dealCollateral';
import { formatAud, formatContractDateTime, itemImageUrl } from '@/lib/format';
import { deliveryNotesFromDetails } from '@/lib/handover/terms';
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
  type DealParty,
  type DealRole,
  type DealRow,
  type DealView,
} from '@/lib/actions/deals';

/** Short role label for a party badge. */
const ROLE_BADGE: Record<DealRole, string> = {
  BUYER: 'Buyer',
  SELLER: 'Seller',
  TRADER: 'Trader',
};

/** How loudly the action card should read for each deal state. */
const STATE_TONE: Partial<Record<DealState, ContractActionTone>> = {
  COMPLETED: 'success',
  ESCROW_LOCKED: 'success',
  ESCROW_PENDING: 'warning',
  CANCELLED: 'warning',
  DISPUTED: 'danger',
};

/** Friendly messages for the typed errors any deal action can return. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in again.',
  'not-participant': 'You are not part of this deal.',
  'not-permitted': 'You cannot do that on this deal.',
  'invalid-state': 'The deal has moved on — refreshing.',
  'not-joined': 'Nobody has joined this deal yet — share the link first.',
  'terms-incomplete': 'Set the handover terms before confirming.',
  'escrow-failed':
    'Escrow could not engage (collateral and/or deal cash via Pinch). Both confirmations were cleared — add a payment method, agree who pays, or verify your identity, and try again.',
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

/**
 * A party's label, falling back to a neutral name. Accepts `null` because an unjoined
 * deal has no counterparty yet.
 */
function nameOf(party: DealParty | null): string {
  return party?.displayName?.trim() || 'NoDitto member';
}

/**
 * Map a deal party into the shared contract party shape. A deal's collateral is
 * SYMMETRIC, so both sides show the same stake.
 */
function toContractParty(
  party: DealParty,
  collateralRequired: boolean,
  collateralCents: number,
): ContractParty {
  return {
    name: nameOf(party),
    roleLabel: party.role ? ROLE_BADGE[party.role] : null,
    verified: party.isVerified,
    rating: party.rating,
    ratingCount: party.ratingCount,
    stats: [
      { label: 'Sales completed', value: party.completedSales },
      { label: 'Purchases completed', value: party.completedPurchases },
      collateralRequired
        ? { label: 'Collateral', value: formatAud(collateralCents) }
        : { label: 'Collateral', value: 'Not required', muted: true },
    ],
  };
}

/** Resolve a party's evidence photo paths into displayable URLs. */
function photoUrls(paths: string[]): string[] {
  return paths
    .map((path) => itemImageUrl(path))
    .filter((url): url is string => Boolean(url));
}

export interface DealRoomProps {
  /** Server-rendered snapshot from `getDeal`. */
  view: DealView;
  /** The signed-in user's id. */
  myUserId: string;
}

/** The live deal room for one private 1:1 binding deal. */
export function DealRoom(props: DealRoomProps) {
  // The focus context has to wrap the room so a control can expand the detail row it
  // refers to.
  return (
    <ContractFocusProvider>
      <DealRoomBody {...props} />
    </ContractFocusProvider>
  );
}

function DealRoomBody({ view, myUserId }: DealRoomProps) {
  const router = useRouter();
  const { focusSection } = useContractFocus();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const { deal: liveDeal, holds: liveHolds, connectionStatus } = useDealRealtime(
    view.deal.id,
  );

  // Realtime is authoritative once it has loaded; otherwise use the SSR snapshot.
  const deal = liveDeal ?? view.deal;
  const holds = liveHolds.length > 0 ? liveHolds : view.holds;

  const iAmCreator = deal.creator_id === myUserId;
  // Nobody has taken the share link yet: there is no counterparty to render.
  const awaitingJoin = deal.counterparty_id === null;
  const me: DealParty = iAmCreator ? view.creator : (view.counterparty ?? view.creator);
  const them: DealParty | null = iAmCreator ? view.counterparty : view.creator;

  const myConfirmed =
    (iAmCreator ? deal.creator_confirmed_at : deal.counterparty_confirmed_at) !== null;
  const theirConfirmed =
    (iAmCreator ? deal.counterparty_confirmed_at : deal.creator_confirmed_at) !== null;

  // Identity or money (or opt-in). Match server `collateralForDeal` so the room
  // reflects verified-to-verified, unverified, and DittoEscrow opt-in the same way.
  const collateralOutcome = resolveDealCollateral({
    creator: view.creator.isVerified,
    counterparty:
      deal.counterparty_id === null
        ? null
        : iAmCreator
          ? (view.counterparty?.isVerified ?? false)
          : me.isVerified,
    optIn: deal.collateral_opt_in,
    basis: {
      collateralCents: deal.collateral_cents,
      cashAmountCents: deal.cash_amount_cents,
    },
    policy: {
      defaultCents: DEAL_DEFAULT_COLLATERAL_CENTS,
      minCents: DEAL_COLLATERAL_MIN,
      maxCents: DEAL_COLLATERAL_MAX,
    },
  });
  const collateralRequired = collateralOutcome.required;
  const collateralStakeCents = collateralOutcome.stakeCents;
  const termsComplete = termsCompleteFor(deal);
  const creatorBringsGoods =
    deal.creator_role === 'SELLER' ||
    (deal.creator_role === 'TRADER' &&
      deal.creator_offer_kinds.some((kind) => kind === 'CARDS' || kind === 'ITEMS'));
  const counterpartyRole =
    deal.creator_role === 'BUYER'
      ? 'SELLER'
      : deal.creator_role === 'SELLER'
        ? 'BUYER'
        : deal.creator_role;
  const counterpartyBringsGoods =
    counterpartyRole === 'SELLER' || counterpartyRole === 'TRADER';
  const contributionsComplete =
    !awaitingJoin &&
    (!creatorBringsGoods ||
      (Boolean(deal.creator_item_text?.trim()) && deal.creator_photo_paths.length > 0)) &&
    (!counterpartyBringsGoods ||
      (Boolean(deal.counterparty_item_text?.trim()) &&
        deal.counterparty_photo_paths.length > 0));
  const escrowEngaged =
    deal.state === 'ESCROW_PENDING' ||
    deal.state === 'ESCROW_LOCKED' ||
    deal.state === 'COMPLETED' ||
    deal.state === 'DISPUTED';

  const iMarkedComplete = view.completeMarkedBy.includes(myUserId);
  const theyMarkedComplete = them ? view.completeMarkedBy.includes(them.id) : false;

  const canEditTerms =
    deal.state === 'INVITED' ||
    deal.state === 'TERMS' ||
    deal.state === 'CONFIRMATION';
  const canConfirm = deal.state === 'TERMS' || deal.state === 'CONFIRMATION';
  const canCancel =
    deal.state === 'INVITED' || deal.state === 'TERMS' || deal.state === 'CONFIRMATION';
  const confirmBlocked = awaitingJoin || !contributionsComplete || !termsComplete;

  // The terms were edited after the deal opened and nobody is confirmed: the DB trigger
  // cleared both ticks, so say so plainly.
  const termsChangedNotice =
    deal.state === 'CONFIRMATION' &&
    Boolean(deal.terms_updated_at) &&
    !myConfirmed &&
    !theirConfirmed &&
    new Date(deal.terms_updated_at ?? 0).getTime() >
      new Date(deal.created_at).getTime() + 1000;

  // Deals joined before chat existed (or an interrupted join) heal on first view.
  // Unjoined deals have no second participant, so there is nothing to open yet.
  const chat = useContractConversation(
    deal.conversation_id ?? view.conversationId,
    async () => {
      const result = await ensureDealConversation(deal.id);
      return result.ok ? result.conversationId : null;
    },
    { enabled: deal.counterparty_id !== null },
  );

  const cashCents = deal.cash_amount_cents;
  const deliveryCents = deal.delivery_cost_cents ?? 0;

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

  const steps = deriveDealSteps({
    state: deal.state,
    joined: !awaitingJoin,
    counterpartyName: them ? nameOf(them) : null,
    contributionsComplete,
    termsComplete,
    myConfirmed,
    theirConfirmed,
    collateralRequired,
    iMarkedComplete,
    theyMarkedComplete,
  });
  const step = currentStep(steps);

  // Collateral holds, labelled relative to the viewer for the shared hold list.
  const contractHolds: ContractHold[] = holds.map((hold) => ({
    id: hold.id,
    label:
      hold.party_id === myUserId ? 'Your collateral' : `${nameOf(them)}'s collateral`,
    amountCents: hold.amount_cents,
    status: hold.status,
  }));

  const myItemText = iAmCreator ? deal.creator_item_text : deal.counterparty_item_text;
  const theirItemText = iAmCreator ? deal.counterparty_item_text : deal.creator_item_text;
  const myPhotos = iAmCreator ? deal.creator_photo_paths : deal.counterparty_photo_paths;
  const theirPhotos = iAmCreator
    ? deal.counterparty_photo_paths
    : deal.creator_photo_paths;

  const deliveryNotes = deliveryNotesFromDetails(deal.delivery_details);
  const termsSummary =
    deal.handover_method === 'IN_PERSON'
      ? `Meet at ${deal.meeting_location ?? 'a place to be agreed'}`
      : deal.handover_method === 'DELIVERY'
        ? deal.delivery_cost_cents == null
          ? 'Delivery — set postage'
          : deal.delivery_cost_cents === 0
            ? 'Free delivery'
            : `${formatAud(deal.delivery_cost_cents)} postage`
        : 'Not agreed yet';
  const cashPayment = (view.payments ?? [])[0] ?? null;
  const moneySummary =
    cashCents == null
      ? 'No cash — goods for goods'
      : deal.cash_payer_id === myUserId
        ? `You pay ${formatAud(cashCents)} via Pinch`
        : deal.cash_payer_id
          ? `${nameOf(them)} pays ${formatAud(cashCents)} via Pinch`
          : `${formatAud(cashCents)} · payer not agreed`;
  const collateralSummary = collateralRequired
    ? collateralOutcome.reason === 'OPT_IN'
      ? `DittoEscrow · both sides post ${formatAud(collateralStakeCents)}`
      : `Both sides post ${formatAud(collateralStakeCents)}`
    : 'None required — both parties verified';

  const exchangeSides: ContractExchangeSide[] = [
    {
      heading: 'Your side',
      partyName: nameOf(me),
      items: [],
      note: myItemText,
      images: photoUrls(myPhotos),
      isMine: true,
      emptyLabel: 'Add your item details and evidence photos.',
      badge: me.role ? (
        <Badge variant="outline">{ROLE_BADGE[me.role]}</Badge>
      ) : null,
    },
    {
      heading: 'Their side',
      partyName: them ? nameOf(them) : 'Nobody yet',
      items: [],
      note: theirItemText,
      images: photoUrls(theirPhotos),
      emptyLabel: them
        ? 'Waiting for their item evidence.'
        : 'Nobody has joined this deal yet.',
      badge: them?.role ? (
        <Badge variant="outline">{ROLE_BADGE[them.role]}</Badge>
      ) : null,
    },
  ];

  const editTriggerClass =
    'h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5';

  const latestEvent =
    view.events.length > 0 ? view.events[view.events.length - 1] : null;

  /** The share-link card stands in for chat until somebody takes the seat. */
  const conversationPanel = awaitingJoin ? (
    <Card id={DEAL_SECTIONS.share} className="flex h-full flex-col border-border/90">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" aria-hidden />
          Share this link
        </CardTitle>
        <CardDescription>
          Whoever opens it and signs in joins as the other party — then chat opens here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ShareDealLink shareToken={view.shareToken} title={deal.title} />
        <p className="text-xs text-muted-foreground">
          The first person to open it takes the seat. Cancel the deal and the link stops
          working.
        </p>
      </CardContent>
    </Card>
  ) : (
    <ContractConversationPanel
      conversationId={chat.conversationId}
      currentUserId={myUserId}
      counterpartyName={nameOf(them)}
      title="Chat"
      placeholder="Message about the deal…"
      emptyHint="Use chat to coordinate. Only the saved terms are binding."
      failed={chat.failed}
      onRetry={chat.retry}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ContractHeader
        title={deal.title}
        money={
          cashCents == null ? 'Goods only' : `${formatAud(cashCents)} via Pinch`
        }
        parties={
          <ContractPartyLine
            me={toContractParty(me, collateralRequired, collateralStakeCents)}
            them={
              them ? toContractParty(them, collateralRequired, collateralStakeCents) : null
            }
          />
        }
        status={<DealStateBadge state={deal.state} />}
        connectionStatus={connectionStatus}
      />

      <ContractLiveRow
        action={
          <ContractActionCard step={step} tone={STATE_TONE[deal.state]}>
            {/* Terms were edited, so both confirmations were cleared. */}
            {termsChangedNotice ? (
              <p
                role="status"
                aria-live="polite"
                className="cardtrade-warning flex items-start gap-2 rounded-md border p-2 text-xs"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <strong>Terms changed</strong> — both parties must confirm again.
                </span>
              </p>
            ) : null}

            {deal.state === 'INVITED' ? (
              <>
                <Button
                  type="button"
                  onClick={() => focusSection(DEAL_SECTIONS.share)}
                >
                  Share the link
                </Button>
                {canCancel ? (
                  <ReasonDialog
                    title="Cancel this deal?"
                    description="You can cancel until the deal becomes binding. Once collateral is locked, you must complete or dispute it."
                    confirmLabel="Cancel deal"
                    triggerLabel="Cancel this deal"
                    triggerVariant="ghost"
                    triggerSize="sm"
                    triggerClassName="self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:self-end"
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
              </>
            ) : null}

            {canConfirm ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {myConfirmed ? (
                    <Button
                      type="button"
                      variant="outline"
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
                      Withdraw my confirmation
                    </Button>
                  ) : confirmBlocked ? (
                    <Button
                      type="button"
                      onClick={() =>
                        focusSection(
                          awaitingJoin
                            ? DEAL_SECTIONS.share
                            : !contributionsComplete
                              ? DEAL_SECTIONS.items
                              : DEAL_SECTIONS.terms,
                        )
                      }
                    >
                      {awaitingJoin
                        ? 'Share the link'
                        : !contributionsComplete
                          ? 'Add your side'
                          : 'Set the handover'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={isPending || deal.state !== 'CONFIRMATION'}
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
                        : 'Confirm'}
                    </Button>
                  )}
                </div>

                {/* The fire exit sits below the primary action as a quiet
                    link, never beside it — same treatment as the cash-sale
                    room. */}
                {canCancel ? (
                  <ReasonDialog
                    title="Cancel this deal?"
                    description="You can cancel until the deal becomes binding. Once collateral is locked, you must complete or dispute it."
                    confirmLabel="Cancel deal"
                    triggerLabel="Cancel this deal"
                    triggerVariant="ghost"
                    triggerSize="sm"
                    triggerClassName="self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:self-end"
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
              </>
            ) : null}

            {deal.state === 'ESCROW_LOCKED' ? (
              <div className="flex flex-wrap items-center gap-2">
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
                  triggerSize="default"
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
            ) : null}

            {deal.state === 'CANCELLED' ? (
              <p className="text-xs text-muted-foreground">
                {deal.cancel_reason ?? 'No reason was given.'}
              </p>
            ) : null}
          </ContractActionCard>
        }
        conversation={conversationPanel}
        progress={<ContractProgressRail steps={steps} />}
      >
        <ContractDetailList>
        <ContractDetailRow
          id={DEAL_SECTIONS.summary}
          label="Summary"
          defaultOpen
          summary="Items, terms, money and collateral at a glance"
          contentClassName="space-y-3"
        >
          {deal.description ? (
            <div className="rounded-lg border-l-4 border-l-primary bg-muted/35 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Shared notes
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{deal.description}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Items
              </p>
              {canEditTerms ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={editTriggerClass}
                  onClick={() => focusSection(DEAL_SECTIONS.items)}
                >
                  <Pencil aria-hidden />
                  {myItemText?.trim() || myPhotos.length > 0
                    ? 'Edit items'
                    : 'Add your side'}
                </Button>
              ) : null}
            </div>
            <ContractExchangePanel sides={exchangeSides} compact />
          </div>

          <DealSummaryRow
            label="Terms"
            value={termsSummary}
            action={
              canEditTerms ? (
                <EditTermsDialog
                  deal={deal}
                  section="terms"
                  iAmCreator={iAmCreator}
                  someoneConfirmed={myConfirmed || theirConfirmed}
                  triggerLabel={termsComplete ? 'Edit terms' : 'Set terms'}
                  triggerClassName={editTriggerClass}
                />
              ) : null
            }
          />
          <DealSummaryRow
            label="Money"
            value={moneySummary}
            action={
              canEditTerms ? (
                <EditTermsDialog
                  deal={deal}
                  section="money"
                  iAmCreator={iAmCreator}
                  someoneConfirmed={myConfirmed || theirConfirmed}
                  triggerLabel={cashCents == null ? 'Set cash' : 'Edit cash'}
                  triggerClassName={editTriggerClass}
                />
              ) : null
            }
          />
          <DealSummaryRow
            label="Collateral"
            value={collateralSummary}
            action={
              canEditTerms ? (
                <EditTermsDialog
                  deal={deal}
                  section="collateral"
                  iAmCreator={iAmCreator}
                  someoneConfirmed={myConfirmed || theirConfirmed}
                  triggerLabel="Set value"
                  triggerClassName={editTriggerClass}
                />
              ) : null
            }
          />
        </ContractDetailRow>

        <ContractDetailRow
          id={DEAL_SECTIONS.items}
          label="Items"
          summary={
            contributionsComplete
              ? 'Both sides documented'
              : 'Item details and evidence photos outstanding'
          }
          action={
            canEditTerms ? (
              <EditTermsDialog
                deal={deal}
                section="exchange"
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel={
                  myItemText?.trim() || myPhotos.length > 0
                    ? 'Edit your side'
                    : 'Add your side'
                }
                triggerClassName={editTriggerClass}
              />
            ) : null
          }
          contentClassName="space-y-3"
        >
          <ContractExchangePanel
            sides={exchangeSides}
            footnote="Descriptions and photos become part of the deal record. Changing either side clears both confirmations."
          />
        </ContractDetailRow>

        <ContractDetailRow
          id={DEAL_SECTIONS.terms}
          label="Terms"
          summary={termsSummary}
          action={
            canEditTerms ? (
              <EditTermsDialog
                deal={deal}
                section="terms"
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel={termsComplete ? 'Edit terms' : 'Set terms'}
                triggerClassName={editTriggerClass}
              />
            ) : null
          }
          contentClassName="space-y-3"
        >
          {deal.handover_method === null ? (
            <p className="text-muted-foreground">
              Not agreed yet — choose a face-to-face meeting or a delivery.
            </p>
          ) : (
            <>
              <ContractMoneyTable
                ariaLabel="Handover terms"
                rows={
                  deal.handover_method === 'IN_PERSON'
                    ? [
                        {
                          label: 'Meeting point',
                          hint: deal.meeting_location,
                          value: '',
                        },
                        {
                          label: 'When',
                          value:
                            formatContractDateTime(deal.meeting_at) ??
                            'Not agreed yet',
                          muted: !deal.meeting_at,
                        },
                      ]
                    : [
                        {
                          label: 'Postage',
                          value:
                            deal.delivery_cost_cents == null
                              ? 'Not set'
                              : deal.delivery_cost_cents === 0
                                ? 'Free'
                                : formatAud(deal.delivery_cost_cents),
                          muted: deal.delivery_cost_cents == null,
                        },
                        ...(deliveryNotes
                          ? [{ label: 'Notes', hint: deliveryNotes, value: '' }]
                          : []),
                      ]
                }
              />
              {deal.handover_method === 'IN_PERSON' &&
              (deal.meeting_lat != null || deal.meeting_location) ? (
                <PlaceMap
                  lat={deal.meeting_lat}
                  lng={deal.meeting_lng}
                  label={deal.meeting_location}
                  heightClassName="h-40"
                />
              ) : null}
            </>
          )}
          {canEditTerms ? (
            <p className="text-xs text-muted-foreground">
              Editing terms clears both confirmations. The deal becomes binding only once
              you both confirm the same terms.
              {deal.terms_updated_at
                ? ` Last updated ${formatContractDateTime(deal.terms_updated_at)}.`
                : ''}
            </p>
          ) : null}
        </ContractDetailRow>

        <ContractDetailRow
          id={DEAL_SECTIONS.money}
          label="Money"
          summary={moneySummary}
          action={
            canEditTerms ? (
              <EditTermsDialog
                deal={deal}
                section="money"
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel={cashCents == null ? 'Set cash' : 'Edit cash'}
                triggerClassName={editTriggerClass}
              />
            ) : null
          }
          contentClassName="space-y-3"
        >
          {cashCents == null ? (
            <p className="text-muted-foreground">
              No cash component — this deal is goods for goods.
            </p>
          ) : (
            <ContractMoneyTable
              ariaLabel="Money terms"
              rows={[
                { label: 'Cash amount', value: formatAud(cashCents) },
                {
                  label:
                    deal.cash_payer_id === myUserId
                      ? 'You pay (via Pinch)'
                      : deal.cash_payer_id
                        ? `${nameOf(them)} pays (via Pinch)`
                        : 'Payer not agreed',
                  value: formatAud(cashCents),
                  total: true,
                },
                ...(deal.handover_method === 'DELIVERY'
                  ? [
                      {
                        label: 'Postage (agreed separately)',
                        value:
                          deliveryCents === 0
                            ? 'Free'
                            : formatAud(deliveryCents),
                      },
                    ]
                  : []),
                ...(cashPayment
                  ? [
                      {
                        label: 'Pinch status',
                        value:
                          cashPayment.status === 'HELD'
                            ? 'Held on confirm'
                            : cashPayment.status === 'SETTLED'
                              ? 'Settled'
                              : cashPayment.status === 'REFUNDED'
                                ? 'Refunded'
                                : cashPayment.status,
                      },
                    ]
                  : deal.state === 'CONFIRMATION' ||
                      deal.state === 'TERMS' ||
                      deal.state === 'INVITED'
                    ? [
                        {
                          label: 'Pinch status',
                          value: 'Charges when you both confirm',
                          muted: true,
                        },
                      ]
                    : []),
              ]}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {deal.handover_method === 'IN_PERSON'
              ? 'Meetup is for goods and inspection only. Deal cash settles through Pinch when the deal locks — not handed over in person.'
              : deal.handover_method === 'DELIVERY'
                ? 'Delivery hands over goods only. Deal cash settles through Pinch when the deal locks — not paid to a courier.'
                : 'Deal cash settles through Pinch when you both confirm. Handover is for goods only.'}{' '}
            Collateral, when required, is a separate Pinch hold.
          </p>
        </ContractDetailRow>

        <ContractDetailRow
          id={DEAL_SECTIONS.collateral}
          label="Collateral"
          summary={collateralSummary}
          action={
            canEditTerms ? (
              <EditTermsDialog
                deal={deal}
                section="collateral"
                iAmCreator={iAmCreator}
                someoneConfirmed={myConfirmed || theirConfirmed}
                triggerLabel="Set value"
                triggerClassName={editTriggerClass}
              />
            ) : null
          }
          contentClassName="space-y-3"
        >
          {(() => {
            const goodsInvolved = creatorBringsGoods || counterpartyBringsGoods;
            const valueUnset = deal.collateral_cents == null;
            // Goods carry value the platform can't price (deal items are text + photos,
            // no FMV), so a cash-only fallback understates a card-inclusive trade.
            const understated = valueUnset && goodsInvolved;
            return (
              <div
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2',
                  understated
                    ? 'cardtrade-warning'
                    : 'bg-muted/25',
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium">Agreed trade value</p>
                  <p className="text-xs text-muted-foreground">
                    {understated
                      ? 'Sized from the cash only — cards add value that is not counted. Set an agreed value so collateral matches the real trade.'
                      : valueUnset
                        ? 'Automatic — based on the cash value or the default stake.'
                        : 'Each hold is 100% of this value when collateral is required.'}
                  </p>
                </div>
                <p className="text-base font-semibold tabular-nums">
                  {formatAud(collateralStakeCents)}
                </p>
              </div>
            );
          })()}

          {!collateralRequired ? (
            <p className="text-muted-foreground">
              {them
                ? 'You are both DittoShield verified, so this deal is binding on your identities alone. You can still opt into DittoEscrow from Edit value.'
                : 'You are DittoShield verified. If an unverified member joins, both sides post collateral. You can also require DittoEscrow from Edit value.'}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {collateralOutcome.reason === 'OPT_IN'
                  ? them === null
                    ? 'DittoEscrow is on, so both sides will post collateral once the deal is confirmed — even if the other party is verified.'
                    : 'DittoEscrow is on, so both sides post collateral even though you are both DittoShield verified.'
                  : them === null
                    ? 'You are not DittoShield verified, so both sides will post collateral once the deal is confirmed.'
                    : !me.isVerified && !them.isVerified
                      ? 'Neither of you is DittoShield verified, so both sides post collateral.'
                      : !me.isVerified
                        ? 'You are not DittoShield verified, so both sides post collateral.'
                        : `${nameOf(them)} is not DittoShield verified, so both sides post collateral.`}{' '}
                Held via Pinch when you both confirm, released as soon as you both mark
                the deal complete.
              </p>
              <ContractMoneyTable
                ariaLabel="Collateral"
                rows={[
                  { label: 'Your collateral', value: formatAud(collateralStakeCents) },
                  {
                    label: them
                      ? `${nameOf(them)}'s collateral`
                      : "The other party's collateral",
                    value: formatAud(collateralStakeCents),
                  },
                ]}
              />
              {!me.isVerified && !escrowEngaged ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/profile#payouts">Use DittoShield instead</Link>
                </Button>
              ) : null}
            </>
          )}

          {escrowEngaged ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Live holds
              </p>
              <ContractHoldList
                holds={contractHolds}
                ariaLabel="Collateral holds"
                emptyLabel={
                  deal.state === 'ESCROW_PENDING' || collateralRequired
                    ? 'No holds recorded yet.'
                    : 'No collateral held — both parties are DittoShield verified.'
                }
              />
            </div>
          ) : null}
        </ContractDetailRow>

        <ContractDetailRow
          label="History"
          summary={
            latestEvent
              ? `${view.events.length} events · ${latestEvent.event
                  .toLowerCase()
                  .replace(/_/g, ' ')}`
              : 'Nothing has happened yet'
          }
        >
          <ContractTimeline
            events={view.events}
            myUserId={myUserId}
            ariaLabel="Deal history"
          />
        </ContractDetailRow>
      </ContractDetailList>
      </ContractLiveRow>
    </div>
  );
}

/** Compact label + value row used on the Summary tab. */
function DealSummaryRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm">{value}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
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
  triggerClassName,
  reasonRequired,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  triggerVariant: 'outline' | 'ghost' | 'destructive';
  triggerSize?: 'sm' | 'lg' | 'default';
  triggerClassName?: string;
  reasonRequired: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const inputId = `reason-${confirmLabel.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={inputId}>Reason{reasonRequired ? '' : ' (optional)'}</Label>
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
