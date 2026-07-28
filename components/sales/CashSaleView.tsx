'use client';

// components/sales/CashSaleView.tsx
//
// The live cash-sale contract room (Req 4).
//
//   header        Charizard PSA 9 · $1,240 · You ⇄ Ada ✓ · Agreeing terms
//   ┌ your move ─────────────────────┬ chat ──────┐
//   └────────────────────────────────┴────────────┘
//   ●──●──○──○──○   Terms Accept Payment Ship Done
//   Item · Terms · Money · Collateral · History      (collapsed rows)
//
// The room says each fact ONCE. Status lives in the header badge; what to do now lives
// only in the action card; where we are lives only in the progress rail; the numbers and
// the fine print live in the collapsed rows. There are no owner badges, consent ticks or
// duplicate status banners, because the action card states ownership in words.
//
// The action plan itself is `deriveCashSaleSteps` — a pure function in `domain/contract`
// — so "what happens next and whose move is it" is data rather than nested status
// ternaries. This component only decides which controls belong to the live step.
//
// Flow-specific knowledge that stays here: the Cash_Sale status vocabulary, versioned
// terms, and the asymmetric seller bond (the buyer pays up front, so only an unverified
// seller posts collateral).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Check,
  Clock,
  ExternalLink,
  Handshake,
  Loader2,
  PackageCheck,
  Truck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
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
  ContractLiveRow,
  ContractMoneyTable,
  ContractPartyDetails,
  ContractPartyLine,
  ContractProgressRail,
  ContractTimeline,
  useContractConversation,
  useContractFocus,
  type ContractActionTone,
  type ContractParty,
  type ContractPartyStat,
} from '@/components/contract';
import {
  CASH_SALE_SECTIONS,
  currentStep,
  deriveCashSaleSteps,
} from '@/domain/contract';
import { CashSalePriceDialog } from './CashSalePriceDialog';
import { CashSaleTermsDialog } from './CashSaleTermsDialog';
import { CashSaleDemoControls } from './CashSaleDemoControls';
import { HandoverFailedDialog } from './HandoverFailedDialog';
import { requiredBondCents } from '@/domain/bond/bondPolicy';
import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { formatAud, formatContractDateTime, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCashSaleRealtime } from '@/lib/realtime/useCashSaleRealtime';
import type { Tables } from '@/lib/supabase/database.types';
import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  updateCashSaleTerms,
  cancelCashSaleAgreement,
  confirmCashSaleHandover,
  disputeCashSale,
  ensureCashSaleConversation,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  syncCashSaleTracking,
  type CashSaleActionResult,
} from '@/lib/actions/cashSale';

type CashSaleRow = Tables<'cash_sales'>;

export interface SaleParty {
  id: string;
  name: string;
  role: 'Buyer' | 'Seller';
  /** Identity verification (KYC) state of this member. */
  verified: boolean;
  /** Average review score out of 5, or null when never reviewed. */
  rating: number | null;
  ratingCount: number;
  completedSales: number;
  completedPurchases: number;
  /** Provider-approved legal identity, snapshotted for the seller. */
  legalEntityName?: string | null;
  registrationNumber?: string | null;
  identityVerifiedAt?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'no-payment-method': 'Add a payment method before terms can be accepted.',
  'seller-identity-changed': 'The seller identity changed. Review it before continuing.',
  'seller-not-payable': 'The seller cannot receive payment right now.',
  'not-participant': 'You are not part of this contract.',
  'not-permitted': 'Only the other party can do that.',
  'invalid-terms': 'Complete the fulfillment terms first.',
  'stale-terms': 'The terms changed. Review the current version.',
  'already-recorded': 'You already did that.',
  'invalid-state': 'This contract has moved on.',
  'transfer-failed': 'The payment could not be collected.',
};

function messageFor(result: Extract<CashSaleActionResult, { ok: false }>): string {
  return result.message ?? ERROR_MESSAGES[result.error] ?? 'Something went wrong.';
}

/** How loudly the action card should read for each status. */
const STATUS_TONE: Partial<Record<CashSaleRow['status'], ContractActionTone>> = {
  COMPLETED: 'success',
  ESCROW_HELD: 'success',
  PAYMENT_PENDING: 'warning',
  REFUNDED: 'warning',
  CANCELLED: 'warning',
  FAILED: 'danger',
  DISPUTED: 'danger',
};

/**
 * Map a sale party into the shared contract party shape. A Cash_Sale is asymmetric —
 * only the seller carries a legal identity snapshot and only an unverified seller posts
 * a bond — so the extra rows differ per side.
 */
function toContractParty(party: SaleParty, bondCents: number): ContractParty {
  const stats: ContractPartyStat[] = [
    { label: 'Sales completed', value: party.completedSales },
    { label: 'Purchases completed', value: party.completedPurchases },
  ];
  if (bondCents > 0) {
    stats.push(
      party.role === 'Seller'
        ? { label: 'Bond', value: formatAud(bondCents) }
        : { label: 'Bond', value: 'Not required', muted: true },
    );
  }
  return {
    name: party.name,
    roleLabel: party.role,
    verified: party.verified,
    rating: party.rating,
    ratingCount: party.ratingCount,
    stats,
    legalEntityName: party.legalEntityName,
    registrationNumber: party.registrationNumber,
  };
}

export interface CashSaleViewProps {
  /** Server snapshot; realtime replaces it once connected. */
  initialSale: CashSaleRow;
  myUserId: string;
  buyer: SaleParty;
  seller: SaleParty;
  conversationId: string | null;
}

/** The bilateral cash-sale contract room. */
export function CashSaleView(props: CashSaleViewProps) {
  // The focus context has to wrap the room so a step's control can expand the detail
  // row it refers to.
  return (
    <ContractFocusProvider>
      <CashSaleRoom {...props} />
    </ContractFocusProvider>
  );
}

function CashSaleRoom({
  initialSale,
  myUserId,
  buyer,
  seller,
  conversationId,
}: CashSaleViewProps) {
  const router = useRouter();
  const { focusSection } = useContractFocus();
  const { sale: liveSale, events, connectionStatus } = useCashSaleRealtime(
    initialSale.id,
  );
  const sale = liveSale ?? initialSale;

  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  // Which irreversible action (if any) is awaiting explicit confirmation.
  const [confirming, setConfirming] = useState<'cancel' | 'dispute' | null>(null);
  // Which method the selector picked while its required details are still missing.
  const [detailsFor, setDetailsFor] = useState<'DELIVERY' | 'IN_PERSON' | null>(null);

  // Contracts opened before chat was linked (or an interrupted create) heal on first
  // view: the server resolves or creates the participant thread.
  const chat = useContractConversation(
    sale.conversation_id ?? conversationId,
    async () => {
      const result = await ensureCashSaleConversation(sale.id);
      return result.ok ? (result.sale.conversationId ?? null) : null;
    },
  );

  const iAmBuyer = sale.buyer_id === myUserId;
  const me = iAmBuyer ? buyer : seller;
  const them = iAmBuyer ? seller : buyer;
  const iAmSeller = !iAmBuyer;
  const myAcceptedVersion = iAmBuyer
    ? sale.buyer_terms_accepted_version
    : sale.seller_terms_accepted_version;
  const theirAcceptedVersion = iAmBuyer
    ? sale.seller_terms_accepted_version
    : sale.buyer_terms_accepted_version;

  const termsSet = sale.fulfillment_method !== null;
  const iAccepted = myAcceptedVersion === sale.terms_version;
  const theyAccepted = theirAcceptedVersion === sale.terms_version;
  const editable = sale.status === 'AGREEMENT';
  const isDelivery = sale.fulfillment_method === 'DELIVERY';

  function run(
    key: string,
    operation: () => Promise<CashSaleActionResult>,
    successMessage: string,
  ) {
    setAction(key);
    startTransition(async () => {
      const result = await operation();
      setAction(null);
      if (result.ok) {
        toast.success(successMessage);
        router.refresh();
      } else {
        toast.error(messageFor(result));
      }
    });
  }

  const busy = (key: string) => isPending && action === key;

  /**
   * Pick a fulfillment method from the selector. When the method's mandatory details
   * already exist we save straight away; otherwise the details dialog opens pre-set to
   * that method so the terms are never saved half-specified.
   */
  function chooseMethod(method: 'DELIVERY' | 'IN_PERSON') {
    if (sale.fulfillment_method === method) {
      setDetailsFor(method);
      return;
    }
    const haveDetails =
      method === 'DELIVERY'
        ? Boolean(sale.delivery_address?.trim())
        : Boolean(sale.meeting_location?.trim());
    if (!haveDetails) {
      setDetailsFor(method);
      return;
    }
    run(
      'method',
      () =>
        updateCashSaleTerms(sale.id, sale.terms_version, {
          fulfillmentMethod: method,
          shippingCostCents: sale.shipping_cost_cents,
          shippingNotes: sale.shipping_notes,
          deliveryAddress: sale.delivery_address,
          meetingLocation: sale.meeting_location,
          meetingAt: sale.meeting_at,
        }),
      method === 'DELIVERY' ? 'Shipping selected.' : 'Face-to-face selected.',
    );
  }

  const itemTotal = sale.agreed_price_cents;

  // Countdown to automatic completion, rendered from the stored deadline so both
  // parties see the same instant regardless of clock skew.
  const autoCompleteLabel = (() => {
    if (!sale.inspection_deadline_at) return null;
    const msLeft = new Date(sale.inspection_deadline_at).getTime() - Date.now();
    if (Number.isNaN(msLeft)) return null;
    if (msLeft <= 0) return 'Completing automatically now';
    const days = Math.floor(msLeft / 86_400_000);
    const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);
    const remaining =
      days > 0
        ? `${days} day${days === 1 ? '' : 's'}`
        : `${hours} hour${hours === 1 ? '' : 's'}`;
    return `Completes automatically in ${remaining}`;
  })();

  // Collateral on a Cash_Sale is ASYMMETRIC, unlike a 2-way trade. The buyer's whole
  // payment is collected before the seller ships, so the buyer is already committed and
  // posts nothing. The only unsecured risk is an unverified seller taking the money and
  // not delivering, so the bond falls on them alone.
  const sellerBondCents = requiredBondCents({
    verified: seller.verified,
    fmvCents: sale.agreed_price_cents,
  });

  const steps = deriveCashSaleSteps({
    status: sale.status,
    viewerRole: iAmBuyer ? 'BUYER' : 'SELLER',
    counterpartyName: them.name,
    termsSet,
    termsVersion: sale.terms_version,
    iAccepted,
    theyAccepted,
    isDelivery,
    hasTracking: Boolean(sale.tracking_number),
    myHandoverConfirmed: Boolean(
      iAmBuyer ? sale.buyer_handover_confirmed_at : sale.seller_handover_confirmed_at,
    ),
    theirHandoverConfirmed: Boolean(
      iAmBuyer ? sale.seller_handover_confirmed_at : sale.buyer_handover_confirmed_at,
    ),
    disputeRaisedByMe: sale.disputed_by === myUserId,
  });
  const step = currentStep(steps);

  const itemImages = (sale.item_image_paths ?? [])
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src));

  const termsSummary = !termsSet
    ? 'Not proposed yet'
    : isDelivery
      ? `Ship to ${sale.delivery_address?.split('\n')[0] ?? 'the buyer'} · ${formatAud(
          sale.shipping_cost_cents,
        )}`
      : `Meet at ${sale.meeting_location}`;

  const latestEvent = events.length > 0 ? events[events.length - 1] : null;

  /** A pre-redesign contract has no terms and can never reach fulfillment. */
  const isLegacy = !editable && !termsSet && sale.status !== 'CANCELLED';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ContractHeader
        title={sale.item_title}
        money={`${formatAud(sale.amount_cents)} total`}
        parties={
          <ContractPartyLine
            me={toContractParty(me, sellerBondCents)}
            them={toContractParty(them, sellerBondCents)}
            showDetails={false}
          />
        }
        connectionStatus={connectionStatus}
      />

      <ContractLiveRow
        action={
          <ContractActionCard
            step={step}
            counterpartyName={them.name}
            tone={isLegacy ? 'warning' : STATUS_TONE[sale.status]}
            eyebrow={isLegacy ? 'Cannot continue' : undefined}
            title={isLegacy ? 'This contract cannot be continued' : undefined}
            detail={
              isLegacy
                ? 'It was created by the earlier pay-immediately flow, so it has no agreed terms. Start a new purchase from the listing.'
                : undefined
            }
          >
            {isLegacy ? (
              <Button asChild variant="outline">
                <Link href={`/listings/${sale.item_id}`}>Go to the listing</Link>
              </Button>
            ) : null}

            {/* Agree the terms, then accept them. */}
            {editable && !isLegacy ? (
              <div className="flex flex-wrap items-center gap-2">
                {!termsSet ? (
                  <Button
                    type="button"
                    onClick={() => focusSection(CASH_SALE_SECTIONS.terms)}
                  >
                    Choose a method
                  </Button>
                ) : !iAccepted ? (
                  <>
                    <Button
                      type="button"
                      disabled={isPending}
                      aria-busy={busy('accept')}
                      onClick={() =>
                        run(
                          'accept',
                          () => acceptCashSaleTerms(sale.id, sale.terms_version),
                          'Terms accepted.',
                        )
                      }
                    >
                      {busy('accept') ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Check aria-hidden />
                      )}
                      {iAmBuyer
                        ? `Accept terms & pay ${formatAud(sale.amount_cents)}`
                        : 'Accept terms'}
                    </Button>
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                  aria-haspopup="dialog"
                  disabled={isPending}
                  onClick={() => setConfirming('cancel')}
                >
                  <X aria-hidden />
                  Cancel
                </Button>
              </div>
            ) : null}

            {/* The mock provider settles payment; this fires that webhook by hand. */}
            {sale.status === 'PAYMENT_PENDING' ? (
              <CashSaleDemoControls cashSaleId={sale.id} />
            ) : null}

            {/* Ship (seller, shipping branch). */}
            {sale.status === 'ESCROW_HELD' && isDelivery && iAmSeller ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                    placeholder="Carrier (e.g. Australia Post)"
                    aria-label="Carrier"
                  />
                  <Input
                    value={trackingNumber}
                    onChange={(event) => setTrackingNumber(event.target.value)}
                    placeholder="Tracking number"
                    aria-label="Tracking number"
                  />
                </div>
                <Button
                  type="button"
                  disabled={
                    !carrier.trim() || trackingNumber.trim().length < 2 || isPending
                  }
                  aria-busy={busy('ship')}
                  onClick={() =>
                    run(
                      'ship',
                      () => recordCashSaleShipment(sale.id, carrier, trackingNumber),
                      'Shipment recorded.',
                    )
                  }
                >
                  {busy('ship') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Truck aria-hidden />
                  )}
                  Record shipment
                </Button>
              </div>
            ) : null}

            {/* Live tracking, while it matters. */}
            {sale.tracking_number && sale.status === 'IN_TRANSIT' ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/60 px-3 py-2 text-xs">
                <span className="min-w-0 break-all font-medium">
                  {sale.tracking_carrier} · {sale.tracking_number}
                </span>
                {sale.tracking_status ? (
                  <span className="uppercase tracking-wide text-muted-foreground">
                    {sale.tracking_status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1.5 py-0.5 text-xs"
                  disabled={isPending}
                  aria-busy={busy('track')}
                  onClick={() =>
                    run('track', () => syncCashSaleTracking(sale.id), 'Tracking refreshed.')
                  }
                >
                  {busy('track') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Refresh
                </Button>
                {sale.tracking_url ? (
                  <a
                    href={sale.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                  >
                    Track <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
            ) : null}

            {/* Confirm receipt (buyer, shipping branch). */}
            {sale.status === 'IN_TRANSIT' && iAmBuyer ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={isPending}
                  aria-busy={busy('receive')}
                  onClick={() =>
                    run('receive', () => recordCashSaleReceipt(sale.id), 'Receipt recorded.')
                  }
                >
                  {busy('receive') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <PackageCheck aria-hidden />
                  )}
                  I received the item
                </Button>
                <HandoverFailedDialog
                  cashSaleId={sale.id}
                  triggerLabel="Not received"
                />
              </div>
            ) : null}

            {/* Mutual handover (in-person branch). */}
            {sale.status === 'HANDOVER' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={
                    isPending ||
                    Boolean(
                      iAmBuyer
                        ? sale.buyer_handover_confirmed_at
                        : sale.seller_handover_confirmed_at,
                    )
                  }
                  aria-busy={busy('handover')}
                  onClick={() =>
                    run(
                      'handover',
                      () => confirmCashSaleHandover(sale.id),
                      'Handover confirmed.',
                    )
                  }
                >
                  {busy('handover') ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Handshake aria-hidden />
                  )}
                  Handover concluded
                </Button>
                <HandoverFailedDialog
                  cashSaleId={sale.id}
                  triggerLabel="Handover failed"
                />
              </div>
            ) : null}

            {/* Inspect and finish (buyer). */}
            {sale.status === 'INSPECTION' ? (
              <>
                {sale.inspection_deadline_at ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    {autoCompleteLabel}
                    {formatContractDateTime(sale.carrier_delivered_at)
                      ? ` · delivered ${formatContractDateTime(sale.carrier_delivered_at)}`
                      : ''}
                  </p>
                ) : null}

                {iAmBuyer ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      disabled={isPending}
                      aria-busy={busy('inspect')}
                      onClick={() =>
                        run(
                          'inspect',
                          () => acceptCashSaleInspection(sale.id),
                          'Purchase completed.',
                        )
                      }
                    >
                      {busy('inspect') ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Check aria-hidden />
                      )}
                      Accept the item
                    </Button>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
                        Something wrong?
                      </summary>
                      <div className="mt-2 space-y-2">
                        <Label htmlFor="cash-sale-dispute-reason" className="text-xs">
                          Describe the issue to raise a dispute.
                        </Label>
                        <Textarea
                          id="cash-sale-dispute-reason"
                          value={disputeReason}
                          onChange={(event) => setDisputeReason(event.target.value)}
                          placeholder="e.g. The card arrived with a crease not shown in the photos…"
                          rows={2}
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={!disputeReason.trim() || isPending}
                          aria-busy={busy('dispute')}
                          onClick={() => setConfirming('dispute')}
                        >
                          Raise dispute
                        </Button>
                      </div>
                    </details>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* The reason a dispute was raised belongs with the dispute. */}
            {sale.status === 'DISPUTED' && sale.dispute_reason ? (
              <p className="rounded-md border bg-background/60 p-2 text-xs">
                <span className="font-medium">Reason given: </span>
                <span className="whitespace-pre-wrap break-words">
                  {sale.dispute_reason}
                </span>
              </p>
            ) : null}

            {sale.status === 'CANCELLED' || sale.status === 'FAILED' ? (
              <Button asChild variant="outline">
                <Link href="/listings">Browse listings</Link>
              </Button>
            ) : null}
          </ContractActionCard>
        }
        conversation={
          <ContractConversationPanel
            conversationId={chat.conversationId}
            currentUserId={myUserId}
            counterpartyName={them.name}
            title="Chat"
            failed={chat.failed}
            onRetry={chat.retry}
          />
        }
        progress={<ContractProgressRail steps={steps} />}
      >
        <ContractDetailList>
        <ContractDetailRow
          id={CASH_SALE_SECTIONS.exchange}
          label="Item"
          summary={`${sale.item_title} · ${formatAud(itemTotal)}`}
        >
          <ContractExchangePanel
            sides={[
              {
                heading: iAmBuyer ? 'You receive' : 'You send',
                partyName: seller.name,
                items: [
                  {
                    id: sale.item_id,
                    title: sale.item_title,
                    subtitle: sale.item_condition,
                    valueCents: itemTotal,
                    images: itemImages,
                  },
                ],
                note: sale.item_description,
                isMine: iAmSeller,
              },
            ]}
            footnote={
              <>
                Photos and description as they were when this contract opened.{' '}
                <Link
                  href={`/listings/${sale.item_id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  View the listing
                </Link>
              </>
            }
          />
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.parties}
          label="Parties"
          summary={`Identity and trading history · ${them.name}`}
        >
          <ContractPartyDetails
            me={toContractParty(me, sellerBondCents)}
            them={toContractParty(them, sellerBondCents)}
          />
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.terms}
          label="Terms"
          summary={termsSummary}
        >
          {!termsSet ? (
            editable ? (
              <div className="mx-auto w-full max-w-xl rounded-xl border bg-background p-5 text-center sm:p-6">
                <h3 className="text-lg font-semibold tracking-tight">
                  Propose handover terms
                </h3>
                <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-muted-foreground">
                  Choose how the item will change hands. You&apos;ll add the address or
                  meeting details next.
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  {(
                    [
                      { value: 'DELIVERY', label: 'Ship the item', icon: Truck },
                      { value: 'IN_PERSON', label: 'Meet face to face', icon: Handshake },
                    ] as const
                  ).map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={isPending}
                        onClick={() => chooseMethod(option.value)}
                        className={cn(
                          'flex size-24 shrink-0 touch-manipulation flex-col items-center justify-center gap-2 rounded-lg border border-input bg-card p-2 text-center text-xs font-semibold transition-colors sm:size-28',
                          'hover:border-gold/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          'disabled:pointer-events-none disabled:opacity-45',
                        )}
                      >
                        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-20 leading-tight">{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="mx-auto mt-4 max-w-md text-xs leading-4 text-muted-foreground">
                  Either party can propose terms. Both parties must accept the saved
                  proposal before payment begins.
                </p>
              </div>
            ) : (
              <p className="mx-auto max-w-lg text-center text-muted-foreground">
                This contract was opened before handover terms existed, so there is no
                proposal to review.
              </p>
            )
          ) : (
            <div className="w-full space-y-3">
              <ContractMoneyTable
                ariaLabel="Proposed handover terms"
                rows={
                  isDelivery
                    ? [
                        {
                          label: 'Delivery address',
                          hint: sale.delivery_address,
                          value: formatAud(sale.shipping_cost_cents),
                        },
                        ...(sale.shipping_notes
                          ? [{ label: 'Notes', hint: sale.shipping_notes, value: '' }]
                          : []),
                      ]
                    : [
                        { label: 'Meeting point', hint: sale.meeting_location, value: '' },
                        {
                          label: 'When',
                          value:
                            formatContractDateTime(sale.meeting_at) ?? 'Not scheduled',
                          muted: !sale.meeting_at,
                        },
                      ]
                }
              />
              {editable ? (
                <p className="text-xs text-muted-foreground">
                  Both parties must accept version {sale.terms_version} before payment.
                </p>
              ) : null}
            </div>
          )}
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.payment}
          label="Money"
          summary={`${formatAud(sale.amount_cents)} · buyer pays`}
        >
          <>
            <ContractMoneyTable
              ariaLabel="Payment breakdown"
              rows={[
                { label: 'Agreed item price', value: formatAud(itemTotal) },
                {
                  label: isDelivery ? 'Shipping' : 'Shipping (not applicable)',
                  value: formatAud(sale.shipping_cost_cents),
                },
                {
                  label: `Platform fee (${PLATFORM_FEE_BPS / 100}%)`,
                  value: formatAud(sale.platform_fee_cents),
                },
                {
                  label: 'Buyer pays',
                  value: formatAud(sale.amount_cents),
                  total: true,
                },
              ]}
            />
            {editable ? (
              <div className="mt-3 flex justify-end">
                <CashSalePriceDialog
                  cashSaleId={sale.id}
                  termsVersion={sale.terms_version}
                  agreedPriceCents={sale.agreed_price_cents}
                />
              </div>
            ) : null}
          </>
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.collateral}
          label="Collateral"
          summary={
            sellerBondCents === 0
              ? 'None required'
              : `Seller posts ${formatAud(sellerBondCents)}`
          }
          contentClassName="gap-3"
        >
          {sellerBondCents === 0 ? (
            <p className="w-full rounded-lg border bg-background p-4 text-muted-foreground">
              The seller is identity verified, and the buyer pays before anything ships,
              so neither side posts a bond.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                The seller is not identity verified, so they post a bond. The buyer posts
                none — their payment is collected up front. Released when the contract
                completes.
              </p>
              <ContractMoneyTable
                ariaLabel="Collateral"
                rows={[
                  {
                    label: iAmBuyer ? `${seller.name}'s bond` : 'Your bond',
                    value: formatAud(sellerBondCents),
                  },
                  {
                    label: iAmBuyer ? 'Your bond' : `${buyer.name}'s bond`,
                    value: 'Not required',
                    muted: true,
                  },
                ]}
              />
            </>
          )}
        </ContractDetailRow>

        {events.length > 0 ? (
          <ContractDetailRow
            id={CASH_SALE_SECTIONS.history}
            label="History"
            summary={
              latestEvent
                ? `${events.length} events · ${latestEvent.event
                    .toLowerCase()
                    .replace(/_/g, ' ')}`
                : undefined
            }
          >
            <ContractTimeline
              events={events}
              myUserId={myUserId}
              ariaLabel="Contract history"
            />
          </ContractDetailRow>
        ) : null}
      </ContractDetailList>
      </ContractLiveRow>

      {/* Fulfillment details prompt, opened by the method selector. */}
      <CashSaleTermsDialog
        sale={sale}
        hideTrigger
        open={detailsFor !== null}
        onOpenChange={(next) => setDetailsFor(next ? detailsFor : null)}
        initialMethod={detailsFor ?? undefined}
      />

      {/* Confirmation steps for the two irreversible actions in this room. */}
      <ConfirmDialog
        open={confirming === 'cancel'}
        onOpenChange={(next) => setConfirming(next ? 'cancel' : null)}
        title="Cancel this contract?"
        description={`The agreement with ${them.name} ends and "${sale.item_title}" returns to the catalog. This cannot be undone.`}
        confirmLabel="Cancel contract"
        confirmVariant="destructive"
        pending={busy('cancel')}
        onConfirm={() => {
          setConfirming(null);
          run(
            'cancel',
            () => cancelCashSaleAgreement(sale.id),
            'Contract cancelled. The item is available again.',
          );
        }}
      />
      <ConfirmDialog
        open={confirming === 'dispute'}
        onOpenChange={(next) => setConfirming(next ? 'dispute' : null)}
        title="Raise a dispute?"
        description="Funds stay locked in escrow while the case is reviewed, and the seller is notified immediately. You cannot undo this."
        confirmLabel="Raise dispute"
        confirmVariant="destructive"
        pending={busy('dispute')}
        onConfirm={() => {
          setConfirming(null);
          run('dispute', () => disputeCashSale(sale.id, disputeReason), 'Dispute raised.');
        }}
      />
    </div>
  );
}
