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
import { Icon } from '@/components/ui/icon';
import { HandshakeIcon, TruckIcon, WarningIcon } from '@/components/ui/icons';
import { DesktopOnly } from '@/components/layout/Breakpoint';
import { PendingLabel } from '@/components/ui/pending-label';
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
  isPushMethod,
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
import { allowSellerNameDisclosure } from '@/lib/actions/identity';
import {
  IdentityGatePrompt,
  identityGateDescription,
} from '@/components/identity/IdentityGatePrompt';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  priceNeedsVerifiedBuyer,
  unverifiedBuyerPriceLimitMinor,
} from '@/domain/identity/buyerIdentityLimit';
import type { VerificationState } from '@/domain/identity/identityGate';

import {
  PROCESSING_FEE_NAME,
  processingFeeRateLabel,
} from '@/lib/fees/feeLabels';
import { CurrencyNotice, fxFeeRateLabel } from '@/components/payments/CurrencyNotice';
import { platformForCurrency, regionCurrency } from '@/domain/region';
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
import {
  CASH_SALE_INSPECTION_DAYS,
  IN_PERSON_INSPECTION_HOURS,
} from '@/domain/fulfilment/inspection';
import { ContractStepCard } from '@/components/contract/ContractStepCard';
import {
  DirectionsLink,
  MapThumb,
  SummaryFigures,
  SummaryItem,
  SummaryList,
  SummaryRow,
} from '@/components/contract/ContractSummary';
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
  /**
   * Where the VIEWER is in identity verification, when they are the buyer of an unpaid
   * sale and have not passed the Identity_Gate. Null otherwise, including for a
   * verified buyer. A sale priced over the unverified-buyer limit
   * (`domain/identity/buyerIdentityLimit.ts`) then asks them to verify before Pay; the
   * server refuses the payment regardless.
   */
  buyerVerification?: VerificationState | null;
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
  buyerVerification = null,
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
    'cancel' | 'dispute' | 'pay' | 'receive' | 'handover' | 'handover-failed' | null
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
  // On the SALE's platform (0179): a buyer paying a seller on another platform pays
  // with the card they saved there.
  const salePlatform = platformForCurrency(sale.currency);
  const payCard = usePayCard(confirming === 'pay', salePlatform);
  const [confirmedSeller, setConfirmedSeller] = useState(false);
  // The identity prompt a large purchase opens in place of Pay, and whether this tab
  // has seen the buyer verify (the server prop only updates on the next render).
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [buyerJustVerified, setBuyerJustVerified] = useState(false);

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

  // A PRIVATE DEAL CANNOT BE PAID UNTIL ITS SELLER IS VERIFIED. The room opened
  // before they verified; the terms can be agreed meanwhile, but Pay waits for Stripe
  // Identity and the seller agreeing to their verified name being shown. PAYOUT SETUP
  // IS NOT PART OF IT: the buyer's money waits in the platform balance until the
  // seller sets payouts up, except for a cross-border sale, which Stripe charges on
  // behalf of the seller's own account (`readSellerPayReadiness`). Once ready, the
  // buyer confirms the verified name on the Pay step. Null for a sale whose seller
  // was confirmed at Buy.
  const payReadiness = editable ? sellerPayReadiness : null;
  const payBlocked = payReadiness != null && payReadiness.state !== 'ready';
  const pendingSellerIdentity = payReadiness?.state === 'ready' ? payReadiness.identity : null;
  const payoutSetupOnly = payReadiness?.state === 'payout-setup-needed';
  const disclosureOnly = payReadiness?.state === 'disclosure-needed';
  const [allowingName, startAllowName] = useTransition();
  const verificationNote = !payBlocked
    ? undefined
    : iAmBuyer
      ? payoutSetupOnly
        ? `${seller.name} hasn't finished payout setup yet.`
        : disclosureOnly
          ? `${seller.name} is verified, and still has to confirm their name for you.`
          : `${seller.name} hasn't verified with Stripe Identity yet.`
      : payoutSetupOnly
        ? `Finish payout setup so ${buyer.name} can pay. Stripe needs it for this currency.`
        : disclosureOnly
          ? `Before ${buyer.name} pays, they see the name on your ID. Show it so they can pay.`
          : `Verify with Stripe Identity so ${buyer.name} can pay. Payouts can be set up later.`;
  // A LARGE PURCHASE NEEDS A VERIFIED BUYER (`domain/identity/buyerIdentityLimit.ts`).
  // Read from the live price, so a price the seller raises over the limit asks for ID
  // here too. The server applies the same rule at Pay whatever this says.
  const buyerIdLimitMinor = unverifiedBuyerPriceLimitMinor(sale.currency);
  const buyerNeedsId =
    editable &&
    iAmBuyer &&
    buyerVerification != null &&
    !buyerJustVerified &&
    priceNeedsVerifiedBuyer(sale.agreed_price_cents, sale.currency);
  // A refusal from the server opens the same prompt; with no state read for this
  // viewer it starts from the beginning.
  const buyerPromptState: VerificationState = buyerVerification ?? 'NOT_STARTED';
  const buyerIdRule =
    buyerIdLimitMinor === null
      ? 'This purchase needs a verified ID.'
      : `Purchases over ${formatMoney(buyerIdLimitMinor, sale.currency)} need a verified ID.`;
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
      } else if (result.error === 'buyer-identity-required') {
        // The one refusal with a step to take here: answer it with that step rather
        // than a toast naming it.
        setVerifyOpen(true);
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

  // HOW THE BUYER PAYS (0158). Each rail carries its own buyer protection fee, priced by the
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
  const offeredMethods: PaymentMethodKind[] =
    iAmBuyer && editable ? paymentMethodsFor({ currency: sale.currency, buyerRegion }) : ['CARD'];
  const payMethods = offeredMethods.filter((method) => {
    const limit = paymentMethodDefinition(method).maxAmountMinor;
    return limit === undefined || totalForMethod(pricing, method) <= limit;
  });
  // Before payment, quote the cheapest way this buyer can pay; the Pay dialog prices
  // every option exactly.
  const cheapestMethod: PaymentMethodKind = payMethods.reduce<PaymentMethodKind>(
    (best, method) => (serviceFeeForMethod(pricing, method) < serviceFeeForMethod(pricing, best) ? method : best),
    'CARD',
  );
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
  // BEFORE PAYMENT THE ROOM QUOTES THE BUYER'S CARD (2026-11-28), the figure Buy now
  // reserved at. It quoted the cheapest rail (PayTo, 3%) unnamed, so a buyer who
  // reserved at A$260.00 by card read "Total, with postage and fees A$257.50" a moment
  // later. A cheaper rail is named beside it instead (`cheaperRail`).
  const shownFeeCents = editable ? serviceFeeForMethod(pricing, cardMethod) : sale.platform_fee_cents;
  const buyerChargeCents = (editable ? totalForMethod(pricing, cardMethod) : sale.amount_cents) + fxFeeCents;
  const cheaperRail =
    editable && iAmBuyer && cheapestMethod !== 'CARD' && serviceFeeForMethod(pricing, cheapestMethod) < shownFeeCents
      ? {
          label: paymentMethodDefinition(cheapestMethod).label,
          totalCents: totalForMethod(pricing, cheapestMethod) + fxFeeCents,
        }
      : null;
  const chosenFeeCents = serviceFeeForMethod(pricing, priceAs(chosenMethod));
  const chosenChargeCents = totalForMethod(pricing, priceAs(chosenMethod)) + fxFeeCents;
  const chosenRail = paymentMethodDefinition(chosenMethod);
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
        placeholder: 'e.g. Not posted, no reply',
        hint: 'You can add screenshots as evidence after opening the dispute.',
      }
    : {
        label: 'What is wrong with the item?',
        placeholder: 'e.g. Crease not in the photos',
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
  // A closed sale has no live step, so the action card would read "This contract is
  // finished" with nothing under it. The halted step says where and why it stopped
  // (the declined payment, the cancellation), so the card shows that instead.
  const haltedStep = steps.find((candidate) => candidate.status === 'halted');

  // The inspection window, for the progress bar in the header and the phone's step
  // card. Null on every other step, which then fills by steps instead.
  const stepClock =
    sale.status === 'INSPECTION' && sale.inspection_deadline_at
      ? {
          deadlineAt: sale.inspection_deadline_at,
          windowHours: isDelivery ? CASH_SALE_INSPECTION_DAYS * 24 : IN_PERSON_INSPECTION_HOURS,
          viewerMustAct: iAmBuyer && !sale.inspection_accepted_at,
        }
      : null;

  const itemImages = (sale.item_image_paths ?? [])
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src));

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
          progress={<ContractProgressStrip steps={steps} clock={stepClock} />}
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
          hideOnPhone
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
            counterparty={{ verified: them.verified, rating: them.rating, ratingCount: them.ratingCount }}
            backHref={iAmBuyer ? '/purchases' : '/sales'}
            status={<CashSaleStatusBadge status={sale.status} />}
            // No "Payment held" mark in the phone bar (UX review 2026-11-27); see
            // the same note in TradeContract.
            progress={
              <ContractStepCard
                steps={steps}
                thumb={itemImages[0] ?? null}
                waitingFor={them.name}
                clock={stepClock}
              />
            }
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
                  waitingFor={them.name}
                  tone={isLegacy ? 'warning' : actionTone(sale.status, step)}
                  title={isLegacy ? 'This contract cannot be continued' : haltedStep?.label}
                  detail={
                    isLegacy
                      ? 'It was created by the earlier pay-immediately flow, so it has no agreed terms. Start a new purchase from the listing.'
                      : haltedStep?.detail
                  }
                  // Read, not clicked — so it is a note beside the title rather than a
                  // child in the button column.
                  note={
                    verificationNote ??
                    (buyerNeedsId ? buyerIdRule : undefined) ??
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
                        <Button
                          type="button"
                          variant="destructive-quiet"
                          size="sm"
                          aria-haspopup="dialog"
                          onClick={() => setConfirming('handover-failed')}
                          disabled={isPending}
                        >
                          <Icon icon={WarningIcon} className="size-3.5" aria-hidden />
                          Not received
                        </Button>
                      ) : null}
                      {sale.status === 'HANDOVER' ? (
                        <Button
                          type="button"
                          variant="destructive-quiet"
                          size="sm"
                          aria-haspopup="dialog"
                          onClick={() => setConfirming('handover-failed')}
                          disabled={isPending}
                        >
                          <Icon icon={WarningIcon} className="size-3.5" aria-hidden />
                          Handover failed
                        </Button>
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
                          <Icon icon={WarningIcon} aria-hidden />
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
                          aria-haspopup="dialog"
                          onClick={() => {
                            // Over the unverified-buyer limit: the ID check comes
                            // first, from here, instead of a Pay dialog that would
                            // only be refused.
                            if (buyerNeedsId) {
                              setVerifyOpen(true);
                              return;
                            }
                            // ESC-31: freeze what the buyer is shown.
                            paySnapshot.current = {
                              termsVersion: sale.terms_version,
                              amountCents: sale.amount_cents,
                            };
                            setConfirming('pay');
                          }}
                        >
                          <PendingLabel pending={busy('accept')}>
                            {buyerNeedsId ? 'Verify ID to pay' : 'Accept terms and pay'}
                          </PendingLabel>
                        </Button>
                      ) : null}
                      {/* The seller's half of a blocked Pay step: the one thing that
                          unblocks it, beside whatever the terms still need. */}
                      {payBlocked && iAmSeller ? (
                        disclosureOnly ? (
                          // Pressing this IS the disclosure consent (Req 4.8-4.12),
                          // stated in the note beside it.
                          <Button
                            type="button"
                            variant={termsSet ? 'action' : 'secondary'}
                            size="sm"
                            disabled={allowingName}
                            onClick={() =>
                              startAllowName(async () => {
                                const result = await allowSellerNameDisclosure();
                                if (!result.ok) toast.error(result.message);
                                else router.refresh();
                              })
                            }
                          >
                            <PendingLabel pending={allowingName}>Show my verified name</PendingLabel>
                          </Button>
                        ) : (
                          <Button asChild variant={termsSet ? 'action' : 'secondary'} size="sm">
                            <Link href="/profile?tab=verification">
                              {payoutSetupOnly ? 'Finish payout setup' : 'Verify with Stripe'}
                            </Link>
                          </Button>
                        )
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
                              ...(action.bankTransfer ? { bankTransfer: action.bankTransfer } : {}),
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
                      {busy('complete-payment')
                        ? 'Checking…'
                        : isPushMethod(paidWith)
                          ? 'View transfer details'
                          : 'Complete payment'}
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
                      disabled={(isPending && action !== null) || myHandoverConfirmed}
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
                      onClick={() => focusSection(CASH_SALE_SECTIONS.return)}
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
          {/* SUMMARY (UX review 2026-11-27): the item, how it changes hands, what is
              paid and what protects it, as one fact sheet. Was Status, Item and
              Delivery; the step rail they repeated is the header's progress bar. */}
          <ContractDetailRow
            id={CASH_SALE_SECTIONS.actions}
            aliases={[CASH_SALE_SECTIONS.exchange, CASH_SALE_SECTIONS.terms]}
            label="Summary"
            summary={step?.label ?? 'This contract is finished'}
          >
            {/* The step's controls on phones, where the sheet covers the chat dock. */}
            {sale.status === 'INSPECTION' && iAmBuyer ? (
              <div className="mb-cozy flex flex-wrap gap-snug md:hidden">
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
                  variant="destructive-soft"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setConfirming('dispute')}
                >
                  <Icon icon={WarningIcon} aria-hidden />
                  Report a problem
                </Button>
              </div>
            ) : null}

            <SummaryList>
              <SummaryRow label={fromShopfront ? 'Items' : 'Item'}>
                {fromShopfront ? (
                  <div className="space-y-snug">
                    {lineItems.map((line, index) => (
                      <SummaryItem
                        key={line.id ?? index}
                        title={line.quantity > 1 ? `${line.quantity} × ${line.description}` : line.description}
                        subtitle={line.condition}
                        valueCents={line.unitPriceCents * line.quantity}
                        currency={sale.currency}
                      />
                    ))}
                    {/* The price IS the sum of the lines (0064), so say it. */}
                    <SummaryFigures rows={[{ label: 'Total', value: money(itemTotal), total: true }]} />
                    <p className="text-meta text-muted-foreground">
                      From {sale.item_title}. A listing with multiple items, so nothing in it is held.
                    </p>
                    {editable ? (
                      <EditContractItemsDialog
                        cashSaleId={sale.id}
                        termsVersion={sale.terms_version}
                        lines={lineItems}
                        currency={sale.currency}
                      />
                    ) : null}
                  </div>
                ) : (
                  <>
                    <SummaryItem
                      title={sale.item_title}
                      subtitle={[sale.item_condition, iAmBuyer ? `Sold by ${them.name}` : `Bought by ${them.name}`]
                        .filter(Boolean)
                        .join(' · ')}
                      images={itemImages}
                      valueCents={itemTotal}
                      currency={sale.currency}
                    />
                    {sale.item_description?.trim() ? (
                      <p className="mt-snug line-clamp-3 whitespace-pre-line text-meta text-muted-foreground">
                        {sale.item_description}
                      </p>
                    ) : null}
                  </>
                )}
              </SummaryRow>

              <SummaryRow label="Delivery">
                {!termsSet ? (
              editable ? (
                <div>
                  <div className="w-full rounded-xl bg-muted/60 p-cozy text-center">
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
                        const Glyph = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            disabled={isPending}
                            onClick={() => chooseMethod(option.value)}
                            className={cn(
                              'flex size-24 shrink-0 touch-manipulation flex-col items-center justify-center gap-snug rounded-lg border border-input bg-card p-snug text-center text-meta font-semibold transition-colors sm:size-28',
                              'hover:border-input-hover hover:bg-accent focus-visible:border-ring focus-visible:outline-none',
                              'disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground',
                            )}
                          >
                            <Icon icon={Glyph}
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
                ) : isDelivery ? (
                  <div className="space-y-snug">
                    <div className="flex items-baseline justify-between gap-cozy">
                      <p className="font-semibold">Posted with tracking</p>
                      <span className="shrink-0 tabular-nums">{money(sale.shipping_cost_cents)} postage</span>
                    </div>
                    <p className="text-meta text-muted-foreground">
                      {deliveryAddress?.label ??
                        (sale.delivery_address_configured
                          ? 'Address confirmed. Shared with the seller once payment is collected.'
                          : 'Buyer must select an address before paying.')}
                    </p>
                    {sale.shipping_notes ? (
                      <p className="text-meta text-muted-foreground">{sale.shipping_notes}</p>
                    ) : null}
                    {sale.tracking_number ? (
                      <ShipmentSummary
                        shipment={{
                          carrier: sale.tracking_carrier,
                          trackingNumber: sale.tracking_number,
                          trackingUrl: sale.tracking_url,
                          // A TEXT column, narrowed rather than cast.
                          status: asFulfilmentTrackingState(sale.tracking_status),
                          carrierDeliveredAt: sale.carrier_delivered_at,
                        }}
                        shippedAt={sale.shipped_at}
                      />
                    ) : null}
                    {sale.status === 'ESCROW_HELD' && iAmSeller ? (
                      <div className="flex flex-wrap items-center gap-cozy">
                        <Button type="button" size="sm" variant="action" onClick={() => setShipOpen(true)}>
                          Add tracking
                        </Button>
                        <p className="text-meta text-muted-foreground">
                          The inspection clock starts when the carrier confirms delivery.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-start gap-cozy">
                    <MapThumb lat={sale.meeting_lat} lng={sale.meeting_lng} label={sale.meeting_location} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Meet in person</p>
                      <p className="text-meta text-muted-foreground">{sale.meeting_location ?? 'No meeting place yet'}</p>
                      <p className="text-meta text-muted-foreground" suppressHydrationWarning>
                        {formatContractDateTime(sale.meeting_at) ?? 'Not scheduled'}
                      </p>
                      {showMeetingMap ? (
                        <DirectionsLink lat={sale.meeting_lat} lng={sale.meeting_lng} label={sale.meeting_location} />
                      ) : (
                        <p className="text-meta text-muted-foreground">
                          Needs a confirmed map pin. Edit terms to pick the place from the suggestions.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {editable && sale.fulfillment_method ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-snug"
                    onClick={() => setDetailsFor(sale.fulfillment_method!)}
                  >
                    Edit terms
                  </Button>
                ) : null}
              </SummaryRow>

              <SummaryRow label={iAmBuyer ? (editable ? 'You pay' : 'You paid') : 'Payment'}>
                <SummaryFigures
                  rows={[
                    {
                      label: iAmBuyer ? 'Total, with postage and fees' : 'Buyer pays',
                      value: money(buyerChargeCents),
                    },
                    ...(iAmSeller ? [{ label: 'You receive', value: money(sellerNetCents), total: true }] : []),
                  ]}
                />
                {cheaperRail ? (
                  <p className="mt-tight text-meta text-muted-foreground">
                    {`${money(cheaperRail.totalCents)} if you pay from your bank with ${cheaperRail.label}.`}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => focusSection(CASH_SALE_SECTIONS.payment)}
                  className="mt-tight text-meta font-semibold text-iris-ink underline-offset-4 hover:underline"
                >
                  See the breakdown
                </button>
              </SummaryRow>

              <SummaryRow label="Protection">
                <p className="font-semibold">
                  {sale.status === 'COMPLETED'
                    ? 'Released to the seller'
                    : iAmBuyer
                      ? 'Held by NoDitto until you accept'
                      : 'Held by NoDitto until the buyer accepts'}
                </p>
                {sale.status === 'INSPECTION' && sale.inspection_deadline_at ? (
                  <p className="text-meta text-muted-foreground" suppressHydrationWarning>
                    Completes on its own {formatContractDateTime(sale.inspection_deadline_at)} if nobody acts
                  </p>
                ) : (
                  <p className="text-meta text-muted-foreground">
                    The seller is paid only after the buyer accepts, or the inspection window closes.
                  </p>
                )}
              </SummaryRow>
            </SummaryList>
          </ContractDetailRow>

          <ContractDetailRow
            id={CASH_SALE_SECTIONS.payment}
            aliases={[CASH_SALE_SECTIONS.collateral]}
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
                    label: PROCESSING_FEE_NAME,
                    value: money(shownFeeCents),
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
              {/* Protection lives here now (2026-11-27): the receipt, then what
                  protects it. */}
              <div className="mt-group border-t pt-group">
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
                        <Icon icon={WarningIcon} aria-hidden />
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
              </div>
            </>
          </ContractDetailRow>


          {/* Dispute evidence (0082). Present ONLY while the contract is disputed or
            has been decided — a Dispute tab on a healthy contract would invite one.
            Placed before History because it is the live thing being worked on; the
            timeline is the record behind it. */}
          {sale.status === 'RETURN_PENDING' ||
          sale.status === 'RETURN_IN_TRANSIT' ? (
            <ContractDetailRow
              id={CASH_SALE_SECTIONS.return}
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

      {/* Record shipment. Mounted at room level rather than inside the Status panel:
          on a phone the contract details sheet, which holds that panel, is unmounted
          until opened, and the action card's "Add tracking" must open this dialog
          without it. */}
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

      {/* THE ID CHECK A LARGE PURCHASE NEEDS, opened by Pay in its place. The hosted
          check returns the buyer to this room, where Pay then opens as usual. */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="min-w-0 md:max-w-lg">
          <DialogHeader className="gap-snug">
            <DialogTitle>Verify your ID to pay</DialogTitle>
            <DialogDescription className="text-pretty">
              {buyerPromptState === 'NOT_STARTED'
                ? `${buyerIdRule} It takes about a minute with a photo ID. Nothing has been charged.`
                : `${buyerIdRule} ${identityGateDescription(buyerPromptState, 'pay')}`}
            </DialogDescription>
          </DialogHeader>
          <IdentityGatePrompt
            state={buyerPromptState}
            returnPath={`/sales/${sale.id}`}
            onVerified={() => {
              setBuyerJustVerified(true);
              setVerifyOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Confirmation steps for irreversible actions in this room. */}
      <ConfirmDialog
        open={confirming === 'pay'}
        onOpenChange={(next) => {
          setConfirming(next ? 'pay' : null);
          if (!next) setConfirmedSeller(false);
        }}
        title="Accept these terms and pay?"
        // ONE SENTENCE, AND TRUE. "Until the item is handed over" was wrong: NoDitto
        // holds the payment until the buyer ACCEPTS the item (or the inspection
        // window closes), which is the buyer's protection. The amount is in the
        // breakdown and on the button, so it is not repeated here (UX review
        // 2026-11-26).
        description="NoDitto holds your payment until you accept the item. If something's wrong, you can raise a problem first."
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
                ...(paid.nextAction.bankTransfer ? { bankTransfer: paid.nextAction.bankTransfer } : {}),
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
              hint: processingFeeRateLabel(sale.currency, priceAs(chosenMethod)),
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
                  : isPushMethod(chosenMethod)
                    ? `You send from your bank, in ${sale.currency.toUpperCase()}`
                    : `You approve in your bank, in ${sale.currency.toUpperCase()}`,
              value: money(chosenChargeCents),
              total: true,
            },
          ]}
        />
        {/* With the buyer's own currency, so a buyer paying a seller overseas is told
            the charge is in the seller's currency and their bank converts it. */}
        <CurrencyNotice
          currency={sale.currency}
          fxFeeMinor={fxFeeCents}
          buyerCurrency={regionCurrency(buyerRegion)}
        />
        {chosenMethod === 'CARD' ? (
          <PayCardSection
            platform={salePlatform}
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
            ? `${them.name} has confirmed. Once you confirm, the buyer has 24 hours to raise a problem, then the seller is paid. Only confirm once you have met and swapped.`
            : 'Only confirm once you have met and swapped. After you both confirm, the buyer has 24 hours to raise a problem before the seller is paid.'
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
          <p className="text-meta text-muted-foreground">
            {disputePrompt.hint}
          </p>
        </div>
      </ConfirmDialog>

      <HandoverFailedDialog
        cashSaleId={sale.id}
        open={confirming === 'handover-failed'}
        onOpenChange={(next) => setConfirming(next ? 'handover-failed' : null)}
        hideTrigger
      />
    </div>
  );
}
