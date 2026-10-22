'use client';

// components/sales/CashSaleView.tsx
//
// The live cash-sale contract room (Req 4).
//
//   header        Charizard PSA 9 · $1,240 · You ⇄ Ada ✓ · Agreeing terms
//   ┌ your move ─────────────────────┬ chat ──────┐
//   └────────────────────────────────┴────────────┘
//   ●──●──○──○──○   Terms Payment Ship Done
//   Item · Terms · Money · Protection · History      (collapsed rows)
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
// Flow-specific knowledge that stays here: the Cash_Sale status vocabulary and versioned
// terms. A Cash_Sale carries NO collateral — the Buyer's payment is collected up front,
// so neither party has anything left to guarantee with a card hold.

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandshakeIcon, TriangleAlertIcon, TruckIcon } from '@hugeicons/core-free-icons';
import { DesktopOnly } from '@/components/layout/Breakpoint';
import { PendingLabel } from '@/components/ui/pending-label';
import { PlaceMap } from '@/components/location';
import { ImageGallery, PORTRAIT_STAGE_FRAME } from '@/components/listings/ImageGallery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FadeSwap } from '@/components/motion/FadeSwap';
import {
  ContractActionCard,
  CashSaleProtectionExplainer,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
  ContractFocusProvider,
  ContractHeader,
  ContractLiveRow,
  ContractMoneyTable,
  ContractPartyLine,
  ContractStatusPanel,
  ContractTimeline,
  DisputeEvidencePanel,
  useContractConversation,
  useContractFocus,
  type ContractActionTone,
  type ContractParty,
  type ContractPartyStat,
  ContractProgressStrip,
  FundsHeldMark,
} from '@/components/contract';
import { isCashSaleFundsHeld } from '@/lib/lifecycle';
import {
  CASH_SALE_SECTIONS,
  currentStep,
  deriveCashSaleSteps,
  type ContractStep,
} from '@/domain/contract';
import { canReportUnpostedSale } from '@/domain/contract/cashSaleStatus';
import { CashSaleStatusBadge } from './CashSaleStatusBadge';
import { CashSalePriceDialog } from './CashSalePriceDialog';
import { CashSaleTermsDialog } from './CashSaleTermsDialog';
import { EditContractItemsDialog } from './EditContractItemsDialog';
import { type ContractLine } from './ContractLineItems';
import { CashSaleDisputeResolution } from './CashSaleDisputeResolution';
import { CashSaleReturnPanel } from './CashSaleReturnPanel';
import type { DisputeEvidenceEntry } from '@/lib/actions/disputeEvidence';
import { cashSaleErrorMessage } from './errorCopy';
import { HandoverFailedDialog } from './HandoverFailedDialog';
import { PayCardSection, usePayCard, VerifiedSellerConfirmation } from './PayStepDetails';
import { PayMethodOptions } from './PayMethodOptions';
import { BankPaymentDialog, type BankPaymentSession } from './BankPaymentDialog';
import {
  cardMethodFor,
  isBankMethod,
  paymentMethodDefinition,
  paymentMethodsFor,
  serviceFeeForMethod,
  storedPaymentMethod,
  totalForMethod,
  type MethodPricingFacts,
  type PaymentMethodKind,
} from '@/domain/payments/paymentMethods';
import { AcceptWithPhotoDialog } from '@/components/contract/AcceptWithPhotoDialog';
import { OffPlatformWarning } from '@/components/deals/DealVerificationNotice';
import { ReportDialog } from '@/components/reports/ReportDialog';
import type { SellerPayReadiness } from '@/lib/sellerIdentity';

import {
  PROCESSING_FEE_HINT,
  PROCESSING_FEE_NAME,
  cardTierClause,
  otherCardRatesNote,
  paymentMethodProtectionNote,
  processingFeeRateLabel,
} from '@/lib/fees/feeLabels';
import { CurrencyNotice, fxFeeRateLabel } from '@/components/payments/CurrencyNotice';
import { formatMoney, formatContractDateTime, formatShortDate, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useCashSaleRealtime,
  type CashSaleEventRow,
} from '@/lib/realtime/useCashSaleRealtime';
import type { Tables } from '@/lib/supabase/database.types';
import {
  InspectionCountdown,
  RecordShipmentDialog,
  ShipmentSummary,
} from '@/components/fulfilment';
import { asFulfilmentTrackingState } from '@/domain/fulfilment';
import type { CashSaleDeliveryAddress } from './types';
import { completePaymentChallenge } from './paymentChallenge';
import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  confirmCashSalePayment,
  getCashSalePaymentAction,
  updateCashSaleTerms,
  cancelCashSaleAgreement,
  confirmCashSaleHandover,
  disputeCashSale,
  ensureCashSaleConversation,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  type CashSaleActionResult,
} from '@/lib/actions/cashSale';

type CashSaleRow = Tables<'cash_sales'>;

export interface SaleParty {
  id: string;
  name: string;
  /** Avatar object path, or null. A PATH, not a URL. */
  avatarPath?: string | null;
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
  /** Optional social media handles keyed by platform slug (0085). */
  socialLinks?: Record<string, string> | null;
}

function messageFor(result: Extract<CashSaleActionResult, { ok: false }>): string {
  return cashSaleErrorMessage(result);
}

/** Statuses where a sale is over. Mirrors `CLOSED` in `domain/contract/cashSaleSteps`. */
const TERMINAL_STATUSES = new Set<CashSaleRow['status']>([
  'CANCELLED',
  'FAILED',
  'REFUNDED',
]);

/** Delivery statuses in which the Seller is authorised to receive the address. */
const FUNDED_DELIVERY_STATUSES = new Set<CashSaleRow['status']>([
  'ESCROW_HELD',
  'IN_TRANSIT',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
  'REFUNDED',
]);

/** A map is only trustworthy when it came from a resolved place selection. */
function hasResolvedMeetingMap(sale: CashSaleRow): boolean {
  return Boolean(
    sale.meeting_place_id &&
    !sale.meeting_place_id.startsWith('text:') &&
    typeof sale.meeting_lat === 'number' &&
    typeof sale.meeting_lng === 'number' &&
    Number.isFinite(sale.meeting_lat) &&
    Number.isFinite(sale.meeting_lng),
  );
}

/**
 * Where a closed sale stopped: the `from_status` of the event that moved it into its
 * terminal status.
 *
 * Read from the audit trail rather than guessed, so the progress rail marks the real
 * step it died at. The events are already loaded for the History row, so this costs
 * nothing extra. Returns null for a live sale, or when the trail does not contain the
 * transition — the derivation then falls back to a conservative inference.
 */
function haltedAtFrom(
  events: CashSaleEventRow[],
  status: CashSaleRow['status'],
): CashSaleRow['status'] | null {
  if (!TERMINAL_STATUSES.has(status)) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.to_status === status && event.from_status) {
      return event.from_status as CashSaleRow['status'];
    }
  }
  return null;
}

/** How loudly the action card should read for each status. */
const STATUS_TONE: Partial<Record<CashSaleRow['status'], ContractActionTone>> = {
  COMPLETED: 'success',
  PAYMENT_PENDING: 'warning',
  REFUNDED: 'warning',
  CANCELLED: 'warning',
  FAILED: 'danger',
  DISPUTED: 'danger',
};

/**
 * Statuses whose own tone outranks whose-move-it-is.
 *
 * A finished, cancelled, failed or disputed contract is reporting an OUTCOME, and the
 * outcome is the loudest thing on it whatever the plan says. Everything else is a
 * contract in flight, where the useful signal is not the status — it is whether the
 * reader is the one holding it up.
 */
const OUTCOME_STATUSES = new Set<CashSaleRow['status']>([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
  'DISPUTED',
]);

/**
 * The dock's tone: `default` (the iris "your move" wash) when the live step belongs to
 * the reader, the status tone otherwise.
 *
 * WHY THIS IS NOT JUST `STATUS_TONE`. Tone tracked status alone, and `ESCROW_HELD` maps
 * to `success` — true, the funds are confirmed — so the seller who has to post the item
 * and the buyer who has nothing to do but wait were handed an identical, calm green
 * band. The one thing a contract room has to answer is "is this mine?", and the surface
 * that answers it had no way to say so.
 *
 * `step.owner` is already the answer (`domain/contract/steps.ts`); it was simply not
 * being read here.
 */
function actionTone(
  status: CashSaleRow['status'],
  step: ContractStep | null,
): ContractActionTone | undefined {
  if (!OUTCOME_STATUSES.has(status) && step?.owner === 'you') return 'default';
  return STATUS_TONE[status];
}

/**
 * Map a sale party into the shared contract party shape. A Cash_Sale is asymmetric —
 * only the seller carries a legal identity snapshot and only an unverified seller posts
 * a bond — so the extra rows differ per side.
 */
function toContractParty(party: SaleParty): ContractParty {
  const stats: ContractPartyStat[] = [
    { label: 'Sales completed', value: party.completedSales },
    { label: 'Purchases completed', value: party.completedPurchases },
  ];
  return {
    name: party.name,
    avatarPath: party.avatarPath ?? null,
    roleLabel: party.role,
    verified: party.verified,
    rating: party.rating,
    ratingCount: party.ratingCount,
    stats,
    legalEntityName: party.legalEntityName,
    registrationNumber: party.registrationNumber,
    socialLinks: party.socialLinks,
  };
}

function CashSaleItemSnapshot({
  title,
  condition,
  agreedPriceCents,
  currency,
  description,
  images,
  lines = [],
}: {
  title: string;
  condition: string | null;
  agreedPriceCents: number;
  /** The contract's own currency (0068), so the headline price is never guessed. */
  currency: string;
  description: string | null;
  images: string[];
  /** Shopfront contracts: the agreed lines. Empty on a single-item sale. */
  lines?: readonly ContractLine[];
}) {
  const galleryImages = images.map((src, index) => ({
    src,
    alt: `${title} — image ${index + 1}`,
  }));
  const copy = description?.trim() ?? '';
  const lineCopy = lines.length === 1 ? lines[0].description.trim() : '';
  const descriptionBody = lineCopy || copy;
  const descriptions =
    lines.length > 1
      ? lines.map((line) => line.description.trim()).filter(Boolean)
      : descriptionBody
        ? [descriptionBody]
        : [];

  return (
    // No `min-h-0 flex-1`: this renders inside the detail panel's scroller, and
    // a zero-basis child that is free to shrink below its content is sized to
    // the visible height, leaving the description hanging past the bottom of its
    // own box. The gallery is sized by `frameClassName`, so nothing here needed
    // to stretch in the first place.
    <div className="flex flex-col items-stretch gap-6">
      <div className="min-w-0">
        {/* Card-shaped. `min-h-[18rem] max-h-[26rem]` at the panel's full width was a
            2:1 strip on a desktop split, so a portrait card painted at a third of it. */}
        <ImageGallery
          images={galleryImages}
          title={title}
          frameClassName={PORTRAIT_STAGE_FRAME}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <header>
          {/* `font-display` on both, matching the listing page this panel mirrors: its
              title is an h2 and takes the display cut from the base rule, so an h3
              here has to ask for it. */}
          <p className="font-display text-display font-semibold tabular-nums tracking-tight">
            {formatMoney(agreedPriceCents, currency)}
          </p>
          <h3 className="mt-snug break-words font-display text-head font-semibold tracking-tight">
            {title}
          </h3>
          {condition ? (
            <Badge variant="outline" className="mt-snug">
              {condition}
            </Badge>
          ) : null}
        </header>

        {descriptions.length > 0 ? (
          <section aria-label="Description" className="space-y-cozy">
            {descriptions.map((text, index) => (
              <p
                key={lines[index]?.id ?? index}
                className="whitespace-pre-line break-words text-body text-muted-foreground"
              >
                {text}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export interface CashSaleViewProps {
  /** Server snapshot; realtime replaces it once connected. */
  initialSale: CashSaleRow;
  myUserId: string;
  buyer: SaleParty;
  seller: SaleParty;
  conversationId: string | null;
  /** RLS-authorized address detail; null for an unfunded seller. */
  deliveryAddress?: CashSaleDeliveryAddress | null;
  /**
   * What this contract covers, line by line (0064).
   *
   * Populated only for a contract opened against a SHOPFRONT listing, where the
   * listing is a whole binder and these lines are the only statement of the
   * goods. Empty for a single-item sale, whose goods are the item snapshot.
   */
  lineItems?: ContractLine[];
  /**
   * Participant evidence on file, when this contract is DISPUTED (0082).
   *
   * Loaded by the page rather than fetched here: the panel is a tab in the details
   * inspector, and a client-side fetch would leave it empty on first paint of a
   * surface whose whole job is to be read.
   */
  disputeEvidence?: DisputeEvidenceEntry[];
  /**
   * The Seller's return address, when a return-conditional refund is running (0088).
   *
   * Loaded by the page for the same reason as the delivery address: it is RLS-gated
   * and lives in a sibling table, so the room cannot read it itself. Null until the
   * seller has given one, which is the state the buyer's post button waits on.
   */
  returnAddress?: { address_label: string | null } | null;
  /**
   * The review affordance for a finished sale — the "Leave a review" trigger, or
   * a marker saying one has already been left.
   *
   * A SLOT, because whether a review exists is a server read and this view is a
   * client component. It renders inside the action card rather than as a strip
   * under the room: on a completed sale "rate this" IS the next thing to do, so
   * it belongs in the one place that answers that question.
   */
  reviewAction?: ReactNode;
  /**
   * Whether the seller can be paid yet, on an unpaid sale that has no verified
   * identity frozen onto it — a private deal, which opens before the seller
   * verifies. Null for every other sale, whose seller was confirmed at Buy.
   *
   * Drives the Pay step: nobody can pay until the seller is `ready`, and the buyer
   * then confirms the verified name it carries.
   */
  sellerPayReadiness?: SellerPayReadiness | null;
  /**
   * The buyer's trading region (0158), which is where their bank account is. Decides
   * which bank rails the Pay step offers beside card. Null offers card only.
   */
  buyerRegion?: string | null;
}

/**
 * Where the seller's money is up to, shown inside the Stripe row.
 *
 * Deliberately narrow: it states the release state and points at the Payouts
 * dashboard for the full picture. It shows no provider transfer reference, no
 * stored provider error and no retry count — the dashboard owns the member-safe
 * explanation, and duplicating it here would be two places to keep honest.
 */
function SellerReleaseStatus({ sale }: { sale: CashSaleRow }) {
  const status = sale.seller_payout_status ?? 'NOT_DUE';
  if (sale.status !== 'COMPLETED' && status === 'NOT_DUE') return null;

  const COPY: Record<string, string> = {
    NOT_DUE:
      'Released to you once the buyer completes the purchase, or the inspection window closes.',
    PENDING: 'Queued for release to your payout account.',
    SETTLED:
      'Sent to your payout account. It can take up to four business days to appear.',
    FAILED: 'Not sent yet. See Payouts for what is holding it up.',
  };

  return (
    <p className="mt-cozy text-body text-muted-foreground">
      {COPY[status] ?? COPY.NOT_DUE}{' '}
      <Link
        href="/profile?tab=payouts"
        className="font-medium underline underline-offset-2 hover:text-foreground"
      >
        View payouts
      </Link>
    </p>
  );
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
  deliveryAddress = null,
  lineItems = [],
  disputeEvidence = [],
  returnAddress = null,
  reviewAction,
  sellerPayReadiness = null,
  buyerRegion = null,
}: CashSaleViewProps) {
  const router = useRouter();
  const { focusSection } = useContractFocus();
  const {
    sale: liveSale,
    events,
    connectionStatus,
  } = useCashSaleRealtime(initialSale.id);
  const sale = liveSale ?? initialSale;

  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);
  // The record-shipment dialog, shared with the trade room. Opened from the dock and
  // from the Status panel; it owns its own carrier and tracking fields.
  const [shipOpen, setShipOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  // Which irreversible action (if any) is awaiting explicit confirmation.
  const [confirming, setConfirming] = useState<
    'cancel' | 'dispute' | 'pay' | 'receive' | 'handover' | null
  >(null);
  // ESC-31: the terms version and total the Pay dialog showed when it opened. A
  // Realtime change underneath it closes the dialog rather than charging a figure the
  // buyer never saw; the server refuses a mismatch too.
  const paySnapshot = useRef<{ termsVersion: number; amountCents: number } | null>(null);
  useEffect(() => {
    const shown = paySnapshot.current;
    if (confirming !== 'pay' || !shown) return;
    if (shown.termsVersion !== sale.terms_version || shown.amountCents !== sale.amount_cents) {
      paySnapshot.current = null;
      setConfirming(null);
      toast.error('The seller changed the terms. Review them before paying.');
    }
  }, [confirming, sale.terms_version, sale.amount_cents]);
  // Which method the selector picked while its required details are still missing.
  const [detailsFor, setDetailsFor] = useState<'DELIVERY' | 'IN_PERSON' | null>(
    null,
  );
  // The Pay step's two inputs besides the charge: the buyer's card, read when the
  // step opens, and their confirmation of a private-deal seller's verified name.
  const payCard = usePayCard(confirming === 'pay');
  const [confirmedSeller, setConfirmedSeller] = useState(false);

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
  // Opened against a binder or bulk lot rather than one listed object (0064).
  // Contents are negotiable until the buyer pays — payment freezes the contract.
  const fromShopfront = sale.from_shopfront === true;

  const termsSet = sale.fulfillment_method !== null;
  const editable = sale.status === 'AGREEMENT';

  // A PRIVATE DEAL CANNOT BE PAID UNTIL ITS SELLER CAN BE. The room opened before
  // they verified; the terms can be agreed meanwhile, but Pay waits for Stripe
  // Identity and payout setup. Once they are ready, the buyer confirms the verified
  // name on the Pay step. Null for a sale whose seller was confirmed at Buy.
  const payReadiness = editable ? sellerPayReadiness : null;
  const payBlocked = payReadiness != null && payReadiness.state !== 'ready';
  const pendingSellerIdentity = payReadiness?.state === 'ready' ? payReadiness.identity : null;
  const payoutSetupOnly = payReadiness?.state === 'payout-setup-needed';
  const verificationNote = !payBlocked
    ? undefined
    : iAmBuyer
      ? payoutSetupOnly
        ? `${seller.name} hasn't finished payout setup yet.`
        : `${seller.name} hasn't verified with Stripe Identity yet.`
      : payoutSetupOnly
        ? `Finish payout setup so ${buyer.name} can pay.`
        : `Verify with Stripe Identity and finish payout setup so ${buyer.name} can pay.`;
  const isDelivery = sale.fulfillment_method === 'DELIVERY';
  const deliveryReady = !isDelivery || sale.delivery_address_configured;
  const sellerCanReceiveDeliveryAddress =
    iAmSeller && isDelivery && FUNDED_DELIVERY_STATUSES.has(sale.status);
  const wasSellerAddressEligible = useRef(false);
  const sellerAddressRefreshAttempted = useRef(false);

  // Address details are deliberately not Realtime-published. When a webhook funds
  // a delivery while the Seller is viewing this room, refresh once so their new
  // server-authorized address snapshot arrives without subscribing to private data.
  useEffect(() => {
    const justBecameEligible =
      sellerCanReceiveDeliveryAddress && !wasSellerAddressEligible.current;
    wasSellerAddressEligible.current = sellerCanReceiveDeliveryAddress;

    if (
      justBecameEligible &&
      !deliveryAddress &&
      !sellerAddressRefreshAttempted.current
    ) {
      sellerAddressRefreshAttempted.current = true;
      router.refresh();
    }
  }, [deliveryAddress, router, sellerCanReceiveDeliveryAddress]);

  const showMeetingMap = !isDelivery && hasResolvedMeetingMap(sale);

  // NO SUCCESS MESSAGE PARAMETER. Every caller used to pass one — "Shipment
  // recorded.", "Dispute raised." — and the room re-renders into the new state
  // anyway, so the toast said what the screen had already changed to. Failure is
  // the case that still needs words, because nothing visible changes.
  function run(
    key: string,
    operation: () => Promise<CashSaleActionResult>,
    onSuccess?: () => void,
  ) {
    setAction(key);
    startTransition(async () => {
      const result = await operation();
      setAction(null);
      if (result.ok) {
        onSuccess?.();
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
        ? sale.delivery_address_configured
        : Boolean(sale.meeting_location?.trim());
    if (!haveDetails) {
      setDetailsFor(method);
      return;
    }
    run('method', () =>
      updateCashSaleTerms(sale.id, sale.terms_version, {
        fulfillmentMethod: method,
        shippingCostCents: sale.shipping_cost_cents,
        shippingNotes: sale.shipping_notes,
        meetingLocation: sale.meeting_location,
        meetingLat: sale.meeting_lat,
        meetingLng: sale.meeting_lng,
        meetingPlaceId: sale.meeting_place_id,
        meetingAt: sale.meeting_at,
      }),
    );
  }

  const itemTotal = sale.agreed_price_cents;

  // Every amount in this room is formatted in the CONTRACT's own currency (0068), not
  // the viewer's region and not a global default. The contract froze its currency at
  // creation, so this stays correct even if either party's profile region is later
  // corrected — and a GBP contract rendered with a dollar sign would be a wrong
  // number rather than a missing one, which is the worse failure in a room whose whole
  // job is to state agreed terms precisely.
  const money = (cents: number) => formatMoney(cents, sale.currency);

  // What the seller actually receives: everything except the Platform_Fee.
  // Shipping is a pass-through to the carrier and belongs to the seller, and the
  // fee is already computed on the item price alone.
  const sellerNetCents = Math.max(sale.amount_cents - sale.platform_fee_cents, 0);

  // The Currency_Conversion fee and what the buyer's card is actually charged (0136).
  // A sale paid now pays none: it is charged on behalf of the seller and settles in its
  // own currency (`domain/payments/onBehalfOf.ts`). A sale collected before that shows
  // the fee RECORDED at Pay, so the room never rewrites what the buyer was charged.
  const fxFeeCents = sale.status === 'AGREEMENT' ? 0 : (sale.fx_fee_cents ?? 0);

  // HOW THE BUYER PAYS (0158). Each rail carries its own service fee, priced by the
  // same function the server charges with, so every figure below is what that rail
  // charges. Before payment the room quotes card (the default rail); once paid it shows
  // what was stored for the rail actually used.
  const pricing: MethodPricingFacts = {
    agreedPriceCents: sale.agreed_price_cents,
    shippingCostCents: sale.shipping_cost_cents,
    platformFeeCents: sale.platform_fee_cents,
    amountCents: sale.amount_cents,
    currency: sale.currency,
    paymentMethod: storedPaymentMethod(sale.payment_method_kind),
  };
  const paidWith = storedPaymentMethod(sale.payment_method_kind);
  // Before payment the Payment section quotes a domestic card and names the dearer card
  // rates beside it; the Pay dialog prices the buyer's own card.
  const shownFeeCents = editable ? serviceFeeForMethod(pricing, 'CARD') : sale.platform_fee_cents;
  const buyerChargeCents = (editable ? totalForMethod(pricing, 'CARD') : sale.amount_cents) + fxFeeCents;
  const otherCards = otherCardRatesNote(sale.currency);
  const offeredMethods: PaymentMethodKind[] =
    iAmBuyer && editable ? paymentMethodsFor({ currency: sale.currency, buyerRegion }) : ['CARD'];
  const payMethods = offeredMethods.filter((method) => {
    const limit = paymentMethodDefinition(method).maxAmountMinor;
    return limit === undefined || totalForMethod(pricing, method) <= limit;
  });
  const [payMethod, setPayMethod] = useState<PaymentMethodKind>('CARD');
  const chosenMethod: PaymentMethodKind = payMethods.includes(payMethod) ? payMethod : 'CARD';
  // THE BUYER'S OWN CARD PRICES CARD (0159). Stripe charges more for a card issued
  // outside the seller's card zone, so the saved card's issuing country picks the card
  // tier, by the same function the server re-reads the card with before charging. Until
  // the card is read (or with none saved) card quotes the domestic rate, and Pay stays
  // disabled, so no total is ever paid on a guess.
  const cardMethod: PaymentMethodKind = cardMethodFor(
    sale.currency,
    payCard.card.state === 'saved' ? payCard.card.country : null,
  );
  const priceAs = (method: PaymentMethodKind): PaymentMethodKind => (method === 'CARD' ? cardMethod : method);
  const chosenFeeCents = serviceFeeForMethod(pricing, priceAs(chosenMethod));
  const chosenChargeCents = totalForMethod(pricing, priceAs(chosenMethod)) + fxFeeCents;
  const chosenRail = paymentMethodDefinition(chosenMethod);
  const chosenTierClause = cardTierClause(sale.currency, priceAs(chosenMethod));
  // The second Pay step for a bank rail: approving the amount in the buyer's bank.
  const [bankSession, setBankSession] = useState<BankPaymentSession | null>(null);

  // BACK FROM THE BANK. A redirect rail returns here with `?payment=return`; read the
  // payment back once, then drop the marker so a reload does not repeat it. The server
  // read decides; the webhook settles it too if this tab never comes back.
  const returnHandled = useRef(false);
  useEffect(() => {
    if (returnHandled.current || !iAmBuyer || sale.status !== 'PAYMENT_PENDING') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'return') return;
    returnHandled.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    void confirmCashSalePayment(sale.id).then((result) => {
      if (!result.ok) toast.error(messageFor(result));
      else if (result.sale.status === 'PAYMENT_PENDING') {
        toast('Waiting for your bank to confirm. This page updates by itself.');
      }
      router.refresh();
    });
  }, [iAmBuyer, router, sale.id, sale.status]);

  /** After the bank step: say plainly where the payment is up to. */
  function finishBankPayment(result: CashSaleActionResult) {
    setBankSession(null);
    if (!result.ok) {
      toast.error(messageFor(result));
    } else if (result.sale.status === 'PAYMENT_PENDING') {
      toast('Waiting for your bank to confirm. This page updates by itself.');
    }
    router.refresh();
  }

  // The countdown to automatic completion now comes from the shared
  // `InspectionCountdown`, which both this room and the trade room render from the
  // stored deadline — so both parties see the same instant regardless of clock skew.

  // NO COLLATERAL ON A CASH SALE. The Buyer's whole payment is collected before the
  // Seller ships, so the Buyer is already committed and posts nothing — and the Seller
  // has nothing left to guarantee. The bond policy could only ever have produced a
  // Seller bond for an UNVERIFIED Seller, and publishing a listing requires the
  // Identity_Gate, so that figure was always zero and the UI it drove was unreachable.
  // Trade collateral is a separate mechanism; see `resolveTradeBonds`.

  const myHandoverConfirmed = Boolean(
    iAmBuyer ? sale.buyer_handover_confirmed_at : sale.seller_handover_confirmed_at,
  );
  const theirHandoverConfirmed = Boolean(
    iAmBuyer ? sale.seller_handover_confirmed_at : sale.buyer_handover_confirmed_at,
  );

  // 0132: the seller's ship-by date, on the posting step, for both sides. A lapsed date
  // says so rather than counting into the past; staff have been flagged by then.
  const shipByDate = formatShortDate(sale.ship_by_at);
  const shipByNote =
    sale.status === 'ESCROW_HELD' && isDelivery && shipByDate
      ? sale.ship_lapsed_at
        ? `Ship-by date passed (${shipByDate}) · our team is checking in`
        : iAmSeller
          ? `Post by ${shipByDate}`
          : `The seller posts by ${shipByDate}`
      : null;

  // 0132: a posted sale whose ship-by date lapsed with nothing shipped. The server has
  // always accepted a dispute from ESCROW_HELD; this is the one moment the room offers
  // it, to the buyer only, because a seller who never posts otherwise leaves the payment
  // held with nothing in the product able to move it on. The seller's remedy is to post.
  // The predicate is held to the staff queue's "Not shipped" rule, so the staff guidance
  // that says the buyer can report a problem stays true.
  const buyerMayReportUnposted = canReportUnpostedSale(
    {
      status: sale.status,
      fulfillmentMethod: sale.fulfillment_method,
      shipLapsedAt: sale.ship_lapsed_at,
    },
    iAmBuyer ? 'BUYER' : 'SELLER',
  );
  // Where the report controls appear: goods in hand at inspection, or goods that never
  // left. The phone Status panel keeps the inspection pair only; for an unposted sale its
  // step asks nothing of the buyer, and the dock menu stays on screen.
  const buyerMayReport = (sale.status === 'INSPECTION' && iAmBuyer) || buyerMayReportUnposted;
  // One dialog, two moments. A buyer with nothing to inspect is not asked what is wrong
  // with the item.
  const disputePrompt = buyerMayReportUnposted
    ? {
        label: 'What has happened with this purchase?',
        placeholder: 'e.g. The seller has not posted it or replied to my messages…',
        hint: 'You can add screenshots as evidence after opening the dispute.',
      }
    : {
        label: 'What is wrong with the item?',
        placeholder: 'e.g. The card arrived with a crease not shown in the photos…',
        hint: 'You can add photos as evidence after opening the dispute.',
      };

  const steps = deriveCashSaleSteps({
    status: sale.status,
    viewerRole: iAmBuyer ? 'BUYER' : 'SELLER',
    counterpartyName: them.name,
    termsSet,
    termsVersion: sale.terms_version,
    isDelivery,
    hasTracking: Boolean(sale.tracking_number),
    myHandoverConfirmed,
    theirHandoverConfirmed,
    disputeRaisedByMe: sale.disputed_by === myUserId,
    disputeRaisedAt: formatContractDateTime(sale.disputed_at),
    haltedAt: haltedAtFrom(events, sale.status),
  });
  const step = currentStep(steps);

  const itemImages = (sale.item_image_paths ?? [])
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src));

  const termsSummary = !termsSet
    ? 'Not proposed yet'
    : isDelivery
      ? `Delivery ${sale.delivery_address_configured ? 'address confirmed' : 'address needed'} · ${money(
          sale.shipping_cost_cents,
        )}`
      : `Meet at ${sale.meeting_location}`;

  const latestEvent = events.length > 0 ? events[events.length - 1] : null;

  /** A pre-redesign contract has no terms and can never reach fulfillment. */
  const isLegacy = !editable && !termsSet && sale.status !== 'CANCELLED';

  return (
    /* The room's height budget AND its own inset, declared once (F37). At `lg`
       the room is exactly the shell's content box, so the header, action card and
       the details/chat row divide THAT rather than each claiming a viewport
       height. The panes below scroll internally and the page itself never
       scrolls.

       5rem = 4rem header + the 1rem the shell keeps on a FLUSH route. A contract
       room is always mounted flush (see the trade and sale pages), and flush is
       `pt-0 pb-group` — not the 4.25rem this used to subtract, which was the
       NON-flush `md:py-7`/`pb-10` pair. That stale figure left a 52px dead band
       under both panes at every desktop width. Recompute from the flush branch
       of MarketplaceShell, not from the non-flush class list, if it changes.

       The inset is painted here, not by the shell, because `flush` means two
       different things to its two consumers: the message thread wants a
       genuinely edge-to-edge log, while a contract room is bordered cards that
       need a gutter or they collide with the rail and both viewport edges. So
       the shell stays at `px-0 pt-0` and each room frames itself. `md:` only —
       below it the room is a full-bleed thread and the cards drop their borders.
       16px on all four sides: `md:pt-group` here, `pb-group` from the shell, and the
       same `gap-group` that separates the panes.

       The cap has to be stated explicitly: body is `min-h-dvh`, a floor rather
       than a cap, so a `flex-1` chain with no definite ancestor height just grows
       the page instead of being clipped. `lg:flex-none` retires the `flex-1` that
       carries the stacked layout below `lg`, where the page scrolls normally. */
    <div className="flex min-h-0 flex-1 flex-col gap-group md:px-group md:pt-group lg:h-[calc(100dvh-5rem-1px-env(safe-area-inset-top))] lg:flex-none">
      {/* Desktop only. Below `md` the room is a thread, and the chat bar
          already carries this exact title, price and counterparty — a second
          copy of them was the first 76px of every phone contract. */}
      <DesktopOnly>
        <ContractHeader
          title={sale.item_title}
          money={`${money(sale.amount_cents)} total`}
          parties={
            <ContractPartyLine
              me={toContractParty(me)}
              them={toContractParty(them)}
              showDetails={false}
            />
          }
          // THE STATUS BADGE, WHICH THIS ROOM WAS THE ONLY ONE MISSING.
          //
          // `ContractHeader` has always taken a `status` slot and `TradeContract` has
          // always filled it with a `StateBadge`; this call omitted it, so a cash
          // contract's own state — the thing thirteen statuses exist to express — was
          // absent from the strip that exists to say what the contract is. A reader had
          // to infer it from whichever tab or action card happened to be on screen.
          //
          // Same map as the Sales list and the inbox: `CASH_SALE_STATUS_MAP` through
          // `CashSaleStatusBadge`, so a sale cannot read one way in the room and
          // another in the list that links to it.
          status={<CashSaleStatusBadge status={sale.status} />}
          assurance={isCashSaleFundsHeld(sale.status) ? <FundsHeldMark kind="payment" /> : null}
          progress={<ContractProgressStrip steps={steps} />}
          connectionStatus={connectionStatus}
        />
      </DesktopOnly>

      {/* THE INSPECTION CLOCK, AT THE TOP OF THE ROOM RATHER THAN INSIDE A TAB.
          
          This is the same component with the same strings — it moved, it was not
          rewritten. It used to render inside the Protection tab, which is the fourth
          tab of the inspector, and below `lg` that whole inspector sits behind a
          docked sheet. So the one deadline on a Cash_Sale that resolves ITSELF —
          completing the sale and paying the Seller with no further action from anyone
          — was two taps from being seen, and a Buyer who never opened the tab had no
          warning it was running.
          
          Deliberately OUTSIDE `DesktopOnly`: the phone is the case this exists for.
          
          The trade room has always rendered it here (`TradeContract`), so this also
          removes a divergence rather than adding one — two rooms were using one
          component in two places, and only one of them was visible. */}
      {payBlocked ? (
        <OffPlatformWarning>
          {iAmBuyer
            ? 'Anyone asking you to pay by PayID or bank transfer is running a scam.'
            : 'A payment outside NoDitto has no protection for either of you.'}
        </OffPlatformWarning>
      ) : null}

      {sale.status === 'INSPECTION' ? (
        <InspectionCountdown
          deadlineAt={sale.inspection_deadline_at}
          viewerMustAct={iAmBuyer && !sale.inspection_accepted_at}
          expiryConsequence={
            iAmBuyer
              ? 'If you do nothing, the sale completes on its own and the seller is paid.'
              : 'If the buyer does nothing, the sale completes on its own and you are paid.'
          }
        />
      ) : null}

      <ContractLiveRow
        detailsTitle={sale.item_title}
        detailsMeta={
          <>
            <CashSaleStatusBadge status={sale.status} />
            {/* The FIGURE wears `display-value`; the word does not. Bold tabular
                digits are for money, and a label set the same way read as part of
                the number. "total" inherits the header's muted body text. */}
            <span>
              <span className="display-value text-foreground">{money(sale.amount_cents)}</span>{' '}
              total
            </span>
          </>
        }
        conversation={
          <ContractConversationPanel
            conversationId={chat.conversationId}
            currentUserId={myUserId}
            counterpartyName={them.name}
            counterpartyAvatarPath={them.avatarPath}
            backHref={iAmBuyer ? '/purchases' : '/sales'}
            status={<CashSaleStatusBadge status={sale.status} />}
            assurance={
              isCashSaleFundsHeld(sale.status) ? <FundsHeldMark kind="payment" compact /> : null
            }
            progress={<ContractProgressStrip steps={steps} />}
            saleContext={{
              id: sale.id,
              allowUnscopedLegacy: false,
              fromShopfront: sale.from_shopfront,
              fulfillmentMethod: sale.fulfillment_method,
            }}
            shipment={
              sale.tracking_number
                ? {
                    carrier: sale.tracking_carrier,
                    trackingNumber: sale.tracking_number,
                    trackingUrl: sale.tracking_url,
                  }
                : null
            }
            subject={{
              title: sale.item_title,
              thumb: itemImages[0] ?? null,
              // THE AGREED PRICE, not `amount_cents`. `amount_cents` is the buyer's
              // total — item + platform fee + shipping (0008) — so this strip read
              // $1.05 while the inbox thread's header for the SAME contract read
              // $1.00 (`ChatThread` uses `agreedPriceCents`). The strip is the
              // item line: what the two parties agreed. The fee and shipping are
              // itemised in the line-items block below, where the total belongs.
              price: money(sale.agreed_price_cents),
            }}
            failed={chat.failed}
            onRetry={chat.retry}
            actions={
              <FadeSwap id={`${sale.status}:${step?.id ?? 'complete'}`}>
                <ContractActionCard
                  appearance="dock"
                  step={step}
                  tone={isLegacy ? 'warning' : actionTone(sale.status, step)}
                  title={isLegacy ? 'This contract cannot be continued' : undefined}
                  detail={
                    isLegacy
                      ? 'It was created by the earlier pay-immediately flow, so it has no agreed terms. Start a new purchase from the listing.'
                      : undefined
                  }
                  // Read, not clicked — so it is a note beside the title rather than a
                  // child in the button column.
                  note={
                    verificationNote ??
                    shipByNote ??
                    // ESC-02: tracking that cannot be this sale's parcel as recorded.
                    // No inspection clock runs until support confirms it.
                    (sale.status === 'IN_TRANSIT' && sale.tracking_flagged_at && !sale.tracking_flag_resolved_at ? (
                      iAmBuyer ? (
                        <>The seller&apos;s tracking shows delivered. Support is checking it, and you can report a problem from here.</>
                      ) : (
                        <>Your tracking shows this parcel was already delivered, so support will confirm the delivery before the buyer&apos;s inspection starts.</>
                      )
                    ) : undefined) ??
                    (sale.tracking_number && sale.status === 'IN_TRANSIT' ? (
                      <>
                        {sale.tracking_carrier} · {sale.tracking_number}
                        {sale.tracking_url ? (
                          <>
                            {' · '}
                            <a
                              href={sale.tracking_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                            >
                              Track
                            </a>
                          </>
                        ) : null}
                      </>
                    ) : undefined)
                  }
                  more={
                    <>
                      {editable && !isLegacy ? (
                        <Button
                          type="button"
                          variant="destructive-quiet"
                          size="sm"
                          aria-haspopup="dialog"
                          disabled={isPending}
                          onClick={() => setConfirming('cancel')}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      {isLegacy ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/listings/${sale.item_id}`}>
                            Go to the listing
                          </Link>
                        </Button>
                      ) : null}
                      {sale.status === 'IN_TRANSIT' && iAmBuyer ? (
                        <HandoverFailedDialog
                          cashSaleId={sale.id}
                          triggerLabel="Not received"
                        />
                      ) : null}
                      {sale.status === 'HANDOVER' ? (
                        <HandoverFailedDialog
                          cashSaleId={sale.id}
                          triggerLabel="Handover failed"
                        />
                      ) : null}
                      {/* Opens the dialog rather than scrolling to the Protection tab.
                    It used to hand the reader off to a tab and leave them to find
                    the form at the bottom of it; the menu item and the tab button
                    are the same action, so they now do the same thing. A posted
                    sale whose ship-by date lapsed offers it too (0132). */}
                      {buyerMayReport ? (
                        <Button
                          type="button"
                          variant="destructive-quiet"
                          size="sm"
                          onClick={() => setConfirming('dispute')}
                        >
                          <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
                          Report a problem
                        </Button>
                      ) : null}
                      {/* NO "REFRESH TRACKING" HERE ANY MORE. Opening this room asks the
                          carrier by itself (`scheduleCashSaleTrackingCheck`, wired in the
                          route), and the answer arrives over Realtime — so a button was
                          asking the member to do the system's job, and on the evidence it
                          was the ONLY thing that had ever applied a delivery. */}
                      {sale.status === 'CANCELLED' || sale.status === 'FAILED' ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href="/">Browse listings</Link>
                        </Button>
                      ) : null}
                      <ReportDialog
                        targetType="user"
                        targetId={iAmBuyer ? sale.seller_id : sale.buyer_id}
                        triggerLabel={`Report ${them.name}`}
                      />
                    </>
                  }
                >
                  {editable && !isLegacy ? (
                    <>
                      {!termsSet ? (
                        <Button
                          type="button"
                          variant="action"
                          size="sm"
                          onClick={() => focusSection(CASH_SALE_SECTIONS.terms)}
                        >
                          Set delivery details
                        </Button>
                      ) : iAmBuyer ? (
                        <Button
                          type="button"
                          variant="action"
                          size="sm"
                          disabled={isPending || !deliveryReady || payBlocked}
                          aria-busy={busy('accept')}
                          onClick={() => {
                            // ESC-31: freeze what the buyer is shown.
                            paySnapshot.current = {
                              termsVersion: sale.terms_version,
                              amountCents: sale.amount_cents,
                            };
                            setConfirming('pay');
                          }}
                        >
                          <PendingLabel pending={busy('accept')}>
                            Accept terms and pay
                          </PendingLabel>
                        </Button>
                      ) : null}
                      {/* The seller's half of a blocked Pay step: the one thing that
                          unblocks it, beside whatever the terms still need. */}
                      {payBlocked && iAmSeller ? (
                        <Button asChild variant={termsSet ? 'action' : 'outline'} size="sm">
                          <Link href="/profile?tab=verification">
                            {payoutSetupOnly ? 'Finish payout setup' : 'Verify with Stripe'}
                          </Link>
                        </Button>
                      ) : null}
                    </>
                  ) : null}

                  {/* A BUTTON, NOT THE FORM. The dock is a strip pinned over the
                      conversation; fields squeezed into it clipped and read as a form
                      fragment. It opens the record-shipment dialog — the same one the
                      trade room uses — so recording a parcel is one control and one
                      form in both rooms. */}
                  {sale.status === 'ESCROW_HELD' && isDelivery && iAmSeller ? (
                    <Button
                      type="button"
                      variant="action"
                      size="sm"
                      onClick={() => setShipOpen(true)}
                    >
                      Add tracking
                    </Button>
                  ) : null}

                  {/* ESC-03: a bank check is outstanding. The secret is read back from
                      the provider each time, so this works after a reload or on
                      another device, and does nothing once the check is finished. */}
                  {sale.status === 'PAYMENT_PENDING' && iAmBuyer && sale.transfer_id ? (
                    <Button
                      type="button"
                      variant="action"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        run('complete-payment', async () => {
                          const action = await getCashSalePaymentAction(sale.id);
                          // A bank approval still outstanding reopens the bank step,
                          // on this device or another one.
                          if (action.ok && action.clientSecret && isBankMethod(action.paymentMethod)) {
                            setBankSession({
                              clientSecret: action.clientSecret,
                              method: action.paymentMethod,
                              ...(action.publishableKey ? { publishableKey: action.publishableKey } : {}),
                            });
                            return confirmCashSalePayment(sale.id);
                          }
                          if (action.ok && action.clientSecret) {
                            return completePaymentChallenge(sale.id, {
                              clientSecret: action.clientSecret,
                              ...(action.publishableKey ? { publishableKey: action.publishableKey } : {}),
                            });
                          }
                          return confirmCashSalePayment(sale.id);
                        })
                      }
                    >
                      {busy('complete-payment') ? 'Checking…' : 'Complete payment'}
                    </Button>
                  ) : null}

                  {sale.status === 'IN_TRANSIT' && iAmBuyer ? (
                    <Button
                      type="button"
                      variant="action"
                      size="sm"
                      disabled={isPending}
                      aria-busy={busy('receive')}
                      onClick={() => setConfirming('receive')}
                    >
                      <PendingLabel pending={busy('receive')}>Confirm delivery</PendingLabel>
                    </Button>
                  ) : null}

                  {!isDelivery &&
                  (sale.status === 'HANDOVER' ||
                    (sale.status === 'COMPLETED' && myHandoverConfirmed)) ? (
                    <Button
                      type="button"
                      variant={myHandoverConfirmed ? 'success' : 'action'}
                      size="sm"
                      disabled={isPending || myHandoverConfirmed}
                      aria-busy={busy('handover')}
                      onClick={() => {
                        if (myHandoverConfirmed) return;
                        setConfirming('handover');
                      }}
                    >
                      <PendingLabel pending={busy('handover')} pendingLabel="Confirming…">
                        {myHandoverConfirmed ? 'Handover confirmed' : 'Confirm handover'}
                      </PendingLabel>
                    </Button>
                  ) : null}

                  {sale.status === 'INSPECTION' && iAmBuyer ? (
                    <AcceptWithPhotoDialog
                      onAccept={async () => {
                        const result = await acceptCashSaleInspection(sale.id);
                        return { ok: result.ok };
                      }}
                      evidenceContext={{
                        caseKind: 'CASH_SALE',
                        caseRef: sale.id,
                      }}
                      triggerLabel="Complete purchase"
                      title="Complete purchase"
                      description="We recommend photographing or filming what you received. This becomes your baseline evidence if a dispute arises later."
                      confirmWithPhotoLabel="Complete with evidence"
                      confirmWithoutPhotoLabel="Complete without evidence"
                    />
                  ) : null}

                  {sale.status === 'DISPUTED' ? (
                    <Button
                      type="button"
                      variant="action"
                      size="sm"
                      onClick={() => focusSection(CASH_SALE_SECTIONS.dispute)}
                    >
                      {sale.disputed_by === myUserId
                        ? 'Review dispute'
                        : 'Respond to dispute'}
                    </Button>
                  ) : null}

                  {sale.status === 'RETURN_PENDING' ||
                  sale.status === 'RETURN_IN_TRANSIT' ? (
                    <Button
                      type="button"
                      variant="action"
                      size="sm"
                      onClick={() => focusSection(CASH_SALE_SECTIONS.actions)}
                    >
                      View return
                    </Button>
                  ) : null}
                  {sale.status === 'COMPLETED' ? reviewAction : null}
                </ContractActionCard>
              </FadeSwap>
            }
          />
        }
      >
        <ContractDetailList>
          {/* STATUS LEADS THE STRIP, AND IT IS THE ROOM'S ANSWER TO "WHERE IS THIS".
              
              `CASH_SALE_SECTIONS.actions` has always been documented as "the live
              controls: ship, confirm receipt, confirm handover, accept, dispute" and the
              plan's `focus` actions point at it — but nothing rendered it outside the
              return flow, so the controls lived in the dock and the one that needs two
              text fields did not fit there.
              
              ALWAYS PRESENT, not only when there is typing to do. It carries the progress
              rail, which this room has never drawn (see the note in `ContractStatusPanel`
              and the one in tests/e2e/specs/cash-sale.spec.ts) — so even with no control
              in it, the tab answers how far along the sale is and who is holding it up,
              which the other five tabs do not.
              
              `defaultOpen` ONLY WHEN THE MOVE IS THE READER'S. Opening every visit on
              Status would take Item away from a buyer who came to look at what they
              bought; opening on it when you are the one holding the contract up is the
              whole point of the tab.
              
              The RETURN row below reuses this id and cannot collide: it renders only on
              RETURN_PENDING / RETURN_IN_TRANSIT, where this row is not the live step. */}
          <ContractDetailRow
            id={CASH_SALE_SECTIONS.actions}
            label="Status"
            defaultOpen={step?.owner === 'you'}
            summary={step?.label ?? 'This contract is finished'}
          >
            <ContractStatusPanel
              steps={steps}
              step={step}
              fact={
                sale.tracking_number ? (
                  // THE PARCEL, NOT A STRING. This was `carrier · number` as plain
                  // text, which is the one presentation of a tracking number that
                  // cannot be used: both parties were copying it into a search engine
                  // to reach a page the contract already stores the URL for.
                  //
                  // The refresh control is only handed over when the configured
                  // provider can actually poll — the manual binding cannot, by design,
                  // and a button that never changes anything is worse than none.
                  <ShipmentSummary
                    shipment={{
                      carrier: sale.tracking_carrier,
                      trackingNumber: sale.tracking_number,
                      trackingUrl: sale.tracking_url,
                      // `tracking_status` is a TEXT column, so it is narrowed rather
                      // than cast — an unrecognised value reads as "no update yet"
                      // instead of putting a raw database string in front of a member.
                      status: asFulfilmentTrackingState(sale.tracking_status),
                      carrierDeliveredAt: sale.carrier_delivered_at,
                    }}
                    shippedAt={sale.shipped_at}
                  />
                ) : undefined
              }
              footnote={
                sale.status === 'ESCROW_HELD' && isDelivery && iAmSeller
                  ? 'Recording this moves the sale to In transit. The inspection clock starts when the carrier confirms delivery, not when you save the number.'
                  : undefined
              }
              // The same two controls the chat dock renders for this step. Only the
              // panel decides when to show them (phones, where the sheet covers the
              // dock) — see the prop's note.
              dockActions={
                sale.status === 'INSPECTION' && iAmBuyer ? (
                  <>
                    <AcceptWithPhotoDialog
                      onAccept={async () => {
                        const result = await acceptCashSaleInspection(sale.id);
                        return { ok: result.ok };
                      }}
                      evidenceContext={{ caseKind: 'CASH_SALE', caseRef: sale.id }}
                      triggerLabel="Complete purchase"
                      title="Complete purchase"
                      description="We recommend photographing or filming what you received. This becomes your baseline evidence if a dispute arises later."
                      confirmWithPhotoLabel="Complete with evidence"
                      confirmWithoutPhotoLabel="Complete without evidence"
                    />
                    <Button
                      type="button"
                      variant="destructive-quiet"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setConfirming('dispute')}
                    >
                      <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
                      Report a problem
                    </Button>
                  </>
                ) : undefined
              }
            >
              {/* The step's control on phones, where the sheet covers the dock. It opens
                  the same dialog as the dock's "Add tracking". */}
              {sale.status === 'ESCROW_HELD' && isDelivery && iAmSeller ? (
                <Button
                  type="button"
                  variant="action"
                  className="w-full sm:w-auto sm:self-start"
                  onClick={() => setShipOpen(true)}
                >
                  Add tracking
                </Button>
              ) : null}
              <RecordShipmentDialog
                open={shipOpen}
                onOpenChange={setShipOpen}
                pending={busy('ship')}
                recipientName={them.name}
                onSubmit={({ carrier, trackingNumber }) =>
                  run(
                    'ship',
                    () => recordCashSaleShipment(sale.id, carrier, trackingNumber),
                    () => setShipOpen(false),
                  )
                }
              />
            </ContractStatusPanel>
          </ContractDetailRow>

          <ContractDetailRow
            id={CASH_SALE_SECTIONS.exchange}
            label={fromShopfront ? 'Items' : 'Item'}
            summary={
              fromShopfront
                ? `${lineItems.length} ${lineItems.length === 1 ? 'item' : 'items'} from ${sale.item_title} · ${money(itemTotal)}`
                : `${sale.item_title} · ${money(itemTotal)}`
            }
            action={
              editable && fromShopfront ? (
                <EditContractItemsDialog
                  cashSaleId={sale.id}
                  termsVersion={sale.terms_version}
                  lines={lineItems}
                  currency={sale.currency}
                />
              ) : null
            }
          >
            {/* Same split as /listings/[id]: photos stay, price / seller /
              what's-included scroll beside them. A shopfront still leads with
              the agreed lines, not the live binder — those lines are the
              contract and freeze once payment starts (0064). */}
            <CashSaleItemSnapshot
              title={sale.item_title}
              condition={sale.item_condition}
              agreedPriceCents={itemTotal}
              currency={sale.currency}
              description={sale.item_description}
              images={itemImages}
              lines={fromShopfront ? lineItems : []}
            />
          </ContractDetailRow>

          <ContractDetailRow
            id={CASH_SALE_SECTIONS.terms}
            label="Terms"
            summary={termsSummary}
            action={
              editable && sale.fulfillment_method ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-tight px-cozy text-meta font-medium [&_svg]:size-3"
                  onClick={() => setDetailsFor(sale.fulfillment_method!)}
                >
                  Edit terms
                </Button>
              ) : null
            }
          >
            {!termsSet ? (
              editable ? (
                <div className="flex min-h-0 flex-1 items-center justify-center py-6 sm:py-section">
                  <div className="w-full max-w-xl rounded-xl border bg-background p-5 text-center sm:p-6">
                    <h3 className="text-subhead font-semibold tracking-tight">
                      Propose handover terms
                    </h3>
                    <p className="mx-auto mt-tight max-w-md text-body text-muted-foreground">
                      Choose how the item will change hands. You&apos;ll add the
                      address or meeting details next.
                    </p>

                    <div className="mt-5 flex flex-wrap items-center justify-center gap-cozy">
                      {(
                        [
                          {
                            value: 'DELIVERY',
                            label: 'Ship the item',
                            icon: TruckIcon,
                          },
                          {
                            value: 'IN_PERSON',
                            label: 'Meet face to face',
                            icon: HandshakeIcon,
                          },
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
                              'flex size-24 shrink-0 touch-manipulation flex-col items-center justify-center gap-snug rounded-lg border border-input bg-card p-snug text-center text-meta font-semibold transition-colors sm:size-28',
                              'hover:border-foreground/60 hover:bg-accent focus-visible:border-ring focus-visible:outline-none',
                              'disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground',
                            )}
                          >
                            <HugeiconsIcon icon={Icon}
                              className="size-5 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="max-w-20 leading-tight">
                              {option.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="mx-auto mt-group max-w-md text-meta text-muted-foreground">
                      Either party can propose terms. Both parties must accept the
                      saved proposal before Stripe begins collection.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mx-auto max-w-lg text-center text-muted-foreground">
                  This contract was opened before handover terms existed, so there
                  is no proposal to review.
                </p>
              )
            ) : (
              <div className="flex w-full min-h-0 flex-1 flex-col gap-cozy">
                <ContractMoneyTable
                  ariaLabel="Proposed handover terms"
                  rows={
                    isDelivery
                      ? [
                          {
                            label: 'Delivery address',
                            hint:
                              deliveryAddress?.label ??
                              (sale.delivery_address_configured
                                ? 'Confirmed. Shared with the seller once payment is collected.'
                                : 'Buyer must select an address before paying.'),
                            value: money(sale.shipping_cost_cents),
                          },
                          ...(sale.shipping_notes
                            ? [
                                {
                                  label: 'Notes',
                                  hint: sale.shipping_notes,
                                  value: '',
                                },
                              ]
                            : []),
                        ]
                      : [
                          {
                            label: 'Meeting point',
                            hint: sale.meeting_location,
                            value: '',
                          },
                          {
                            label: 'When',
                            value:
                              formatContractDateTime(sale.meeting_at) ??
                              'Not scheduled',
                            muted: !sale.meeting_at,
                          },
                        ]
                  }
                />
                {!isDelivery ? (
                  showMeetingMap ? (
                    <PlaceMap
                      lat={sale.meeting_lat}
                      lng={sale.meeting_lng}
                      label={sale.meeting_location}
                      precision="exact"
                      heightClassName="h-56 sm:h-64"
                    />
                  ) : (
                    <p className="text-body text-muted-foreground">
                      This meeting location needs a confirmed map pin. Edit terms to
                      select the agreed place from the suggestions.
                    </p>
                  )
                ) : null}
              </div>
            )}
          </ContractDetailRow>

          <ContractDetailRow
            id={CASH_SALE_SECTIONS.payment}
            label="Payment"
            summary={`${money(buyerChargeCents)} · ${editable ? 'buyer pays via Stripe' : `paid by ${paymentMethodDefinition(paidWith).label}`}`}
            action={
              editable && !fromShopfront && !iAmBuyer ? (
                <CashSalePriceDialog
                  cashSaleId={sale.id}
                  termsVersion={sale.terms_version}
                  agreedPriceCents={sale.agreed_price_cents}
                  currency={sale.currency}
                />
              ) : null
            }
          >
            <>
              <ContractMoneyTable
                ariaLabel="Payment breakdown"
                rows={[
                  { label: 'Price', value: money(itemTotal) },
                  {
                    label: isDelivery ? 'Shipping' : 'Shipping (not applicable)',
                    value: money(sale.shipping_cost_cents),
                  },
                  {
                    label: editable ? `${PROCESSING_FEE_NAME} (by card)` : PROCESSING_FEE_NAME,
                    value: money(shownFeeCents),
                    // 0159: the figure is a domestic card's; a card from abroad costs
                    // more, and the Pay step prices the buyer's own card.
                    ...(editable && (otherCards || payMethods.length > 1)
                      ? {
                          hint: [
                            otherCards,
                            payMethods.length > 1 ? 'Paying from your bank can cost less.' : '',
                            iAmBuyer ? 'Every option is priced for you before you pay.' : '',
                          ]
                            .filter(Boolean)
                            .join(' '),
                        }
                      : {}),
                  },
                  // The buyer's cost of converting into the platform's settlement
                  // currency. Paid by the buyer so the seller's figure below is exact.
                  ...(fxFeeCents > 0
                    ? [
                        {
                          label: `Currency conversion (${fxFeeRateLabel()}, buyer pays)`,
                          value: money(fxFeeCents),
                        },
                      ]
                    : []),
                  {
                    label: editable
                      ? `Buyer pays via Stripe, in ${sale.currency.toUpperCase()}`
                      : `Buyer paid by ${paymentMethodDefinition(paidWith).label}, in ${sale.currency.toUpperCase()}`,
                    value: money(buyerChargeCents),
                    total: true,
                  },
                  // The seller's own number. The rows above are all the BUYER's
                  // outgoing total, so before this the seller could see everything
                  // about the money except the part that reaches them.
                  ...(iAmSeller
                    ? [
                        {
                          label: 'You receive',
                          value: money(sellerNetCents),
                          total: true,
                        },
                      ]
                    : []),
                ]}
              />
              {iAmSeller ? <SellerReleaseStatus sale={sale} /> : null}
            </>
          </ContractDetailRow>

          <ContractDetailRow
            id={CASH_SALE_SECTIONS.collateral}
            label="Protection"
            summary="Payment held through inspection"
            contentClassName="gap-cozy"
          >
            {/* NO COLLATERAL ON A CASH SALE, so this tab does not mention any. The
              Buyer's money is collected up front, which leaves nothing for either
              party to guarantee with a card hold — and the only Seller bond the
              policy could ever produce required an UNVERIFIED Seller, which
              publishing a listing makes impossible. See
              `CashSaleProtectionExplainer`. */}
            {/* The countdown used to be the first thing in this tab. It is now a banner
                at the top of the room — see the note at its new call site. This tab
                keeps the explanation of HOW the money is protected, which is what a
                reader opens it for; the deadline is not something they should have had
                to come looking for. */}
            <div className="space-y-cozy">
              {/* A TRIGGER, NOT A FORM. This tab is where a buyer comes to read how
                their money is protected, and it ended with a permanently open
                dispute textarea — a contract going perfectly well still showed a
                box inviting you to describe what was wrong with it. The form now
                lives in the dialog, behind a question.

                INSIDE THE EXPLAINER, not stranded under it. As a block of its own
                at the foot of the tab it was a red button floating below three
                paragraphs, and the outcome row that explains what a dispute does
                to the payment sat above it describing the same action in the
                abstract. The button now sits in that row, under the sentence that
                sets the expectation. */}
              <CashSaleProtectionExplainer
                viewerIsBuyer={iAmBuyer}
                inPerson={!isDelivery}
                reportAction={
                  buyerMayReport ? (
                    // The deadline sits BESIDE the button, not under it. Stacked,
                    // the control was sandwiched between the outcome's own
                    // description above and a second muted line below, and owned
                    // by neither.
                    <div className="flex flex-wrap items-center gap-x-cozy gap-y-snug">
                      <Button
                        type="button"
                        variant="destructive-quiet"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setConfirming('dispute')}
                      >
                        <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
                        Report a problem
                      </Button>
                      <p className="text-meta text-muted-foreground">
                        {buyerMayReportUnposted
                          ? 'The ship-by date passed without tracking.'
                          : 'Raise it before the payment is released.'}
                      </p>
                    </div>
                  ) : null
                }
              />
            </div>
          </ContractDetailRow>

          {/* Dispute evidence (0082). Present ONLY while the contract is disputed or
            has been decided — a Dispute tab on a healthy contract would invite one.
            Placed before History because it is the live thing being worked on; the
            timeline is the record behind it. */}
          {sale.status === 'RETURN_PENDING' ||
          sale.status === 'RETURN_IN_TRANSIT' ? (
            <ContractDetailRow
              id={CASH_SALE_SECTIONS.actions}
              label="Return"
              summary="Return in progress"
            >
              <CashSaleReturnPanel
                cashSaleId={sale.id}
                status={sale.status}
                viewerIsBuyer={iAmBuyer}
                amountCents={sale.amount_cents}
                currency={sale.currency}
                returnAddressLabel={returnAddress?.address_label ?? null}
                returnDeadlineAt={sale.return_deadline_at}
                returnTrackingCarrier={sale.return_tracking_carrier}
                returnTrackingNumber={sale.return_tracking_number}
                returnDisputedAt={sale.return_disputed_at}
                returnDisputeReason={sale.return_dispute_reason}
                returnLapsedAt={sale.return_lapsed_at}
                returnCarrierDeliveredAt={sale.return_carrier_delivered_at}
                returnInspectionDeadlineAt={sale.return_inspection_deadline_at ?? null}
                counterpartyName={them.name}
              />
            </ContractDetailRow>
          ) : null}

          {sale.status === 'DISPUTED' || sale.dispute_resolution ? (
            <ContractDetailRow
              id={CASH_SALE_SECTIONS.dispute}
              label="Dispute"
              variant="destructive"
              summary={
                disputeEvidence.length > 0
                  ? `${disputeEvidence.length} submission${disputeEvidence.length === 1 ? '' : 's'}`
                  : 'Nothing submitted yet'
              }
            >
              <DisputeEvidencePanel
                caseKind="CASH_SALE"
                caseRef={sale.id}
                entries={disputeEvidence}
                disputeReason={sale.dispute_reason}
                disputedAt={sale.disputed_at}
                raisedByName={
                  sale.disputed_by
                    ? sale.disputed_by === myUserId
                      ? 'you'
                      : them.name
                    : null
                }
                // The record stays readable after a decision; the form does not.
                canSubmit={sale.status === 'DISPUTED'}
                // Withdraw / concede (0084). Only while the case is genuinely open —
                // once `dispute_resolution` is set the outcome stands, and the failed
                // refund path in 0045 is the only thing that reopens one.
                resolution={
                  sale.status === 'DISPUTED' && !sale.dispute_resolution ? (
                    <CashSaleDisputeResolution
                      currency={sale.currency}
                      cashSaleId={sale.id}
                      iAmBuyer={iAmBuyer}
                      iRaisedIt={sale.disputed_by === myUserId}
                      amountCents={sale.amount_cents}
                      counterpartyName={them.name}
                    />
                  ) : null
                }
              />
            </ContractDetailRow>
          ) : null}

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
        deliveryAddress={deliveryAddress}
        canEditDeliveryAddress={iAmBuyer}
        canEditShippingCost={!iAmBuyer}
        hideTrigger
        open={detailsFor !== null}
        onOpenChange={(next) => setDetailsFor(next ? detailsFor : null)}
        initialMethod={detailsFor ?? undefined}
      />

      {/* Confirmation steps for irreversible actions in this room. */}
      <ConfirmDialog
        open={confirming === 'pay'}
        onOpenChange={(next) => {
          setConfirming(next ? 'pay' : null);
          if (!next) setConfirmedSeller(false);
        }}
        title="Accept these terms and pay?"
        description={
          chosenMethod === 'CARD'
            ? `This charges ${money(chosenChargeCents)} to your card through Stripe and holds it until the item is handed over. You can still raise a dispute if something goes wrong.`
            : `Next you approve ${money(chosenChargeCents)} with ${chosenRail.label}. Nothing is taken until you approve it in your bank, and NoDitto holds it until the item is handed over. You can still raise a dispute if something goes wrong.`
        }
        confirmLabel={
          chosenMethod === 'CARD'
            ? `Accept terms and pay ${money(chosenChargeCents)}`
            : `Accept terms, continue to ${chosenRail.label}`
        }
        confirmDisabled={
          (chosenMethod === 'CARD' && payCard.card.state !== 'saved') ||
          (pendingSellerIdentity != null && !confirmedSeller)
        }
        pending={busy('accept')}
        helpHref="/help#holds"
        onConfirm={() => {
          setConfirming(null);
          setConfirmedSeller(false);
          const method = chosenMethod;
          run('accept', async () => {
            // ESC-31: pay exactly what the dialog showed, on the version it showed.
            // The total is the chosen rail's, the figure printed beside it (0158).
            const shown = paySnapshot.current ?? {
              termsVersion: sale.terms_version,
              amountCents: sale.amount_cents,
            };
            const paid = await acceptCashSaleTerms(
              sale.id,
              shown.termsVersion,
              pendingSellerIdentity?.version,
              // The total for the buyer's own card tier (0159), the figure shown.
              totalForMethod(pricing, priceAs(method)),
              method,
            );
            // A bank rail: the buyer approves the amount in their bank next.
            if (paid.ok && paid.nextAction && paid.nextAction.paymentMethod && isBankMethod(paid.nextAction.paymentMethod)) {
              setBankSession({
                clientSecret: paid.nextAction.clientSecret,
                method: paid.nextAction.paymentMethod,
                ...(paid.nextAction.publishableKey ? { publishableKey: paid.nextAction.publishableKey } : {}),
                // The claimed sale is priced for this rail; quote it, not the row
                // this tab last rendered.
                totalMinor: paid.sale.amountCents + fxFeeCents,
                feeMinor: paid.sale.platformFeeCents,
              });
              return paid;
            }
            // ESC-03: the bank asked to check the card payment. Run it in place, then
            // read the payment back; the server read decides the outcome.
            return paid.ok && paid.nextAction
              ? completePaymentChallenge(sale.id, paid.nextAction)
              : paid;
          });
        }}
      >
        {pendingSellerIdentity ? (
          <VerifiedSellerConfirmation
            identity={pendingSellerIdentity}
            confirmed={confirmedSeller}
            onConfirmedChange={setConfirmedSeller}
          />
        ) : null}
        {/* The same breakdown as the Payment section, repeated here on purpose. That
            section is the third row of the inspector and on a phone the whole
            inspector sits behind a sheet, so a Buyer can reach this button having
            only ever seen the item price — which is 5% below what they are about to
            be charged. The fee has to be named on the path to the charge, not
            somewhere the charge can be reached without visiting. */}
        {/* THE CHOICE OF RAIL, each priced in full (0158). Only rendered when the buyer
            has more than card, so a card-only buyer sees the dialog as before. */}
        <PayMethodOptions
          methods={payMethods}
          selected={chosenMethod}
          onSelect={setPayMethod}
          pricing={pricing}
          cardMethod={cardMethod}
          disabled={busy('accept')}
        />
        <ContractMoneyTable
          ariaLabel="What you are about to be charged"
          rows={[
            { label: 'Price', value: money(itemTotal) },
            ...(isDelivery
              ? [{ label: 'Shipping', value: money(sale.shipping_cost_cents) }]
              : []),
            {
              label: payMethods.length > 1 ? `${PROCESSING_FEE_NAME} (${chosenRail.label})` : PROCESSING_FEE_NAME,
              value: money(chosenFeeCents),
              // The rate this rail (or this card's tier) is priced at, so the figure can
              // be checked rather than taken on trust. Exact: the fee is this rate of
              // price and postage.
              hint: `${processingFeeRateLabel(sale.currency, priceAs(chosenMethod))} of the price${isDelivery ? ' and postage' : ''}${chosenTierClause ? `, ${chosenTierClause}` : ''}. ${PROCESSING_FEE_HINT}`,
            },
            ...(fxFeeCents > 0
              ? [
                  {
                    label: `Currency conversion (${fxFeeRateLabel()})`,
                    value: money(fxFeeCents),
                    hint: 'So the seller receives exactly the agreed price. Not refunded.',
                  },
                ]
              : []),
            {
              label:
                chosenMethod === 'CARD'
                  ? `Charged now, in ${sale.currency.toUpperCase()}`
                  : `You approve in your bank, in ${sale.currency.toUpperCase()}`,
              value: money(chosenChargeCents),
              total: true,
            },
          ]}
        />
        <CurrencyNotice currency={sale.currency} fxFeeMinor={fxFeeCents} />
        {payMethods.length > 1 ? (
          <p className="text-body text-muted-foreground">{paymentMethodProtectionNote(chosenMethod)}</p>
        ) : null}
        {chosenMethod === 'CARD' ? (
          <PayCardSection
            card={payCard.card}
            onAttached={payCard.refresh}
            onReplace={payCard.replace}
          />
        ) : null}
      </ConfirmDialog>
      <BankPaymentDialog
        cashSaleId={sale.id}
        session={bankSession}
        totalLabel={money(bankSession?.totalMinor ?? sale.amount_cents + fxFeeCents)}
        feeLabel={money(bankSession?.feeMinor ?? sale.platform_fee_cents)}
        onOpenChange={(open) => {
          // Closing leaves the sale PAYMENT_PENDING and resumable with "Complete
          // payment" until the abandoned-payment sweep returns it to AGREEMENT.
          if (!open) setBankSession(null);
        }}
        onFinished={finishBankPayment}
      />
      <ConfirmDialog
        open={confirming === 'receive'}
        onOpenChange={(next) => setConfirming(next ? 'receive' : null)}
        title="Confirm you received the item?"
        description="This records that the package arrived and starts your inspection window."
        confirmLabel="Confirm delivery"
        pending={busy('receive')}
        helpHref="/help#holds"
        onConfirm={() => {
          setConfirming(null);
          run('receive', () => recordCashSaleReceipt(sale.id));
        }}
      />
      <ConfirmDialog
        open={confirming === 'handover'}
        onOpenChange={(next) => setConfirming(next ? 'handover' : null)}
        title="Confirm the handover happened?"
        description={
          theirHandoverConfirmed
            ? `${them.name} has already confirmed. Your confirmation starts a 24-hour window for the buyer to raise a problem, after which the seller is paid. Only confirm if you met and the item actually changed hands.`
            : 'Only confirm if you met and the item actually changed hands. When you both confirm, the buyer has 24 hours to raise a problem before the seller is paid — one confirmation is not enough.'
        }
        confirmLabel={
          iAmBuyer ? 'We met and I have the item' : 'We met and I handed it over'
        }
        pending={busy('handover')}
        helpHref="/help#holds"
        onConfirm={() => {
          setConfirming(null);
          run('handover', () => confirmCashSaleHandover(sale.id));
        }}
      />
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
          run('cancel', () => cancelCashSaleAgreement(sale.id));
        }}
      />
      <ConfirmDialog
        open={confirming === 'dispute'}
        onOpenChange={(next) => setConfirming(next ? 'dispute' : null)}
        title="Report a problem"
        // The platform holds funds until resolution — never say "escrow" because it
        // implies a segregated custodial arrangement that does not exist.
        description="NoDitto keeps holding your payment while the case is reviewed, and the seller is notified immediately. You cannot undo this."
        confirmLabel="Raise dispute"
        confirmVariant="destructive"
        confirmDisabled={!disputeReason.trim()}
        pending={busy('dispute')}
        onConfirm={() => {
          setConfirming(null);
          run('dispute', () => disputeCashSale(sale.id, disputeReason));
        }}
      >
        <div className="space-y-snug">
          <Label htmlFor="cash-sale-dispute-reason">
            {disputePrompt.label}
          </Label>
          <Textarea
            id="cash-sale-dispute-reason"
            value={disputeReason}
            onChange={(event) => setDisputeReason(event.target.value)}
            placeholder={disputePrompt.placeholder}
            rows={3}
          />
          <p className="text-body text-muted-foreground">
            {disputePrompt.hint}
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
