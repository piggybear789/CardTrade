'use client';

// components/sales/CashSaleView.tsx
//
// The live cash-sale contract room (Req 4).
//
//   header        Charizard PSA 9 · $1,240 · You ⇄ Ada ✓ · Agreeing terms
//   ┌ your move ─────────────────────┬ chat ──────┐
//   └────────────────────────────────┴────────────┘
//   ●──●──○──○──○   Terms Accept Payment Ship Done
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

import { useEffect, useRef, useState, useTransition } from 'react';
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
  Pencil,
  Truck,
} from 'lucide-react';
import { PlaceMap } from '@/components/location';
import { ImageGallery } from '@/components/listings/ImageGallery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ContractActionCard,
  CashSaleProtectionExplainer,
  CollateralExplainerDialog,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
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
import { CounterpartyIdentity } from '@/components/identity/CounterpartyIdentity';
import {
  CASH_SALE_SECTIONS,
  currentStep,
  deriveCashSaleSteps,
} from '@/domain/contract';
import { CashSalePriceDialog } from './CashSalePriceDialog';
import { CashSaleTermsDialog } from './CashSaleTermsDialog';
import { EditContractItemsDialog } from './EditContractItemsDialog';
import { ContractLineItemsList, type ContractLine } from './ContractLineItems';
import { cashSaleErrorMessage } from './errorCopy';
import { CashSaleDemoControls } from './CashSaleDemoControls';
import { HandoverFailedDialog } from './HandoverFailedDialog';

import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { formatMoney, formatContractDateTime, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useCashSaleRealtime,
  type CashSaleEventRow,
} from '@/lib/realtime/useCashSaleRealtime';
import type { Tables } from '@/lib/supabase/database.types';
import { InspectionCountdown } from '@/components/fulfilment';
import type { CashSaleDeliveryAddress } from './types';
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
  };
}

function CashSaleItemSnapshot({
  title,
  condition,
  agreedPriceCents,
  currency,
  description,
  images,
  listingId,
}: {
  title: string;
  condition: string | null;
  agreedPriceCents: number;
  /** The contract's own currency (0068), so the headline price is never guessed. */
  currency: string;
  description: string | null;
  images: string[];
  listingId: string;
}) {
  const galleryImages = images.map((src, index) => ({
    src,
    alt: `${title} — image ${index + 1}`,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col items-stretch gap-6 md:flex-row">
        <div className="min-w-0 md:flex md:flex-1 md:flex-col md:justify-center">
          <ImageGallery
            images={galleryImages}
            title={title}
            /* `min-h` carries the height only while the columns are stacked and
               there is no definite parent height to fill. From `md` the pane IS
               bounded, so the floor is dropped: CSS resolves `min-height` in
               preference to `max-height`, so keeping it would let a portrait
               card outgrow the pane and push the room taller than the viewport. */
            frameClassName="h-full min-h-[18rem] max-h-[26rem] md:min-h-0 md:max-h-[calc(100%-1rem)]"
          />
        </div>

        {/* `overscroll-contain` is scoped to the same breakpoint as the overflow
            it governs. Unscoped it read as though it applied while stacked, where
            there is no overflow for it to contain and the property is inert. */}
        <div className="flex min-w-0 flex-col md:flex-1 md:overflow-y-auto md:overscroll-contain md:pr-1">
          <div className="space-y-5">
            <div className="space-y-3">
              <h3 className="break-words text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                {title}
              </h3>
              <div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">
                  {formatMoney(agreedPriceCents, currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Agreed item price</p>
              </div>
              {condition ? <Badge variant="outline">{condition}</Badge> : null}
            </div>

            <div className="border-t border-border/70 pt-4">
              <h4 className="text-sm font-semibold">Description</h4>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {description?.trim() || 'No description was saved with this item.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="shrink-0 border-t pt-3 text-xs text-muted-foreground">
        Photos and description are the snapshot saved when this contract opened.{' '}
        <Link
          href={`/listings/${listingId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          View the listing
        </Link>
      </p>
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
  /** A real carrier provider is configured to poll status. */
  trackingRefreshAvailable?: boolean;
  /** When false, hide mock settle/fail webhook buttons (Stripe is live). */
  paymentDemoEnabled?: boolean;
  /**
   * What this contract covers, line by line (0064).
   *
   * Populated only for a contract opened against a SHOPFRONT listing, where the
   * listing is a whole binder and these lines are the only statement of the
   * goods. Empty for a single-item sale, whose goods are the item snapshot.
   */
  lineItems?: ContractLine[];
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
    NOT_DUE: 'Released to you once the buyer accepts the item, or the inspection window closes.',
    PENDING: 'Queued for release to your payout account.',
    SETTLED:
      'Sent to your payout account. It can take up to four business days to appear.',
    FAILED: 'Not sent yet. See Payouts for what is holding it up.',
  };

  return (
    <p className="mt-3 text-xs text-muted-foreground">
      {COPY[status] ?? COPY.NOT_DUE}{' '}
      <Link
        href="/profile/payouts"
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
  trackingRefreshAvailable = false,
  paymentDemoEnabled = false,
  lineItems = [],
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
  // Opened against a binder or bulk lot rather than one listed object (0064).
  // Contents are negotiable on exactly the same window as price and terms — see
  // `editable` below — because the second acceptance collects the money and
  // freezes the whole contract at once.
  const fromShopfront = sale.from_shopfront === true;
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
        ? sale.delivery_address_configured
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
          meetingLocation: sale.meeting_location,
          meetingLat: sale.meeting_lat,
          meetingLng: sale.meeting_lng,
          meetingPlaceId: sale.meeting_place_id,
          meetingAt: sale.meeting_at,
        }),
      method === 'DELIVERY' ? 'Shipping selected.' : 'Face-to-face selected.',
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

  // The countdown to automatic completion now comes from the shared
  // `InspectionCountdown`, which both this room and the trade room render from the
  // stored deadline — so both parties see the same instant regardless of clock skew.

  // NO COLLATERAL ON A CASH SALE. The Buyer's whole payment is collected before the
  // Seller ships, so the Buyer is already committed and posts nothing — and the Seller
  // has nothing left to guarantee. The bond policy could only ever have produced a
  // Seller bond for an UNVERIFIED Seller, and publishing a listing requires the
  // Identity_Gate, so that figure was always zero and the UI it drove was unreachable.
  // Trade collateral is a separate mechanism; see `resolveTradeBonds`.

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
    /* The room's height budget, declared once (F37). At `lg` the room is exactly
       the shell's content box, so the header, action card and the details/chat
       row divide THAT rather than each claiming a viewport height. The panes
       below scroll internally and the page itself never scrolls.

       8.25rem = 4rem header + 4.25rem of section padding. The padding is NOT
       `lg:py-7`'s 3.5rem: the shell also sets `lg:pb-10` on a signed-in page, and
       Tailwind emits `pb` after `py`, so the bottom is 2.5rem and the total is
       1.75 + 2.5. Verified against the compiled stylesheet — recompute it there,
       not from the class list, if the shell's padding ever changes.

       The cap has to be stated explicitly: body is `min-h-dvh`, a floor rather
       than a cap, so a `flex-1` chain with no definite ancestor height just grows
       the page instead of being clipped. `lg:flex-none` retires the `flex-1` that
       carries the stacked layout below `lg`, where the page scrolls normally. */
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
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
        connectionStatus={connectionStatus}
      />

      <ContractLiveRow
        action={
          <ContractActionCard
            step={step}
            tone={isLegacy ? 'warning' : STATUS_TONE[sale.status]}
            title={isLegacy ? 'This contract cannot be continued' : undefined}
            detail={
              isLegacy
                ? 'It was created by the earlier pay-immediately flow, so it has no agreed terms. Start a new purchase from the listing.'
                : undefined
            }
          >
            {/* Identity is reference information, not the next action. The screenshot
                showed it filling the top of the action card before the Item / Parties
                / Terms inspector; that forces every state to lead with a static fact
                and buries the thing the user can do now. It now lives in Parties,
                alongside the rest of the counterparty context. */}

            {isLegacy ? (
              <Button asChild variant="outline">
                <Link href={`/listings/${sale.item_id}`}>Go to the listing</Link>
              </Button>
            ) : null}

            {/* Agree the terms, then accept them. Cancel is the fire exit, not
                a peer of the primary action: it sits below as a quiet link so
                a thumb aiming for the CTA cannot land on it, and turns
                destructive only on hover/press. The confirm dialog remains the
                real guard. */}
            {editable && !isLegacy ? (
              <>
                {!termsSet ? (
                  <Button
                    type="button"
                    onClick={() => focusSection(CASH_SALE_SECTIONS.terms)}
                  >
                    Choose a method
                  </Button>
                ) : !iAccepted ? (
                  <Button
                    type="button"
                    disabled={isPending || !deliveryReady}
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
                      ? `Accept & pay ${money(sale.amount_cents)} with Stripe`
                      : 'Accept terms'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:self-end"
                  aria-haspopup="dialog"
                  disabled={isPending}
                  onClick={() => setConfirming('cancel')}
                >
                  Cancel this contract
                </Button>
              </>
            ) : null}

            {/* Mock-only: fire transfer.settled by hand. Hidden when Stripe is live. */}
            {paymentDemoEnabled && sale.status === 'PAYMENT_PENDING' ? (
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
                {trackingRefreshAvailable ? (
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
                ) : null}
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
                {/* The same inspection banner the trade room shows. It replaced a
                    single muted line of text that was easy to miss on a contract
                    about to settle itself. */}
                <InspectionCountdown
                  deadlineAt={sale.inspection_deadline_at}
                  viewerMustAct={iAmBuyer && !sale.inspection_accepted_at}
                  expiryConsequence={
                    iAmBuyer
                      ? 'If you do nothing, the sale completes on its own and the seller is paid.'
                      : 'If the buyer does nothing, the sale completes on its own and you are paid.'
                  }
                />
                {formatContractDateTime(sale.carrier_delivered_at) ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    Carrier confirmed delivery{' '}
                    {formatContractDateTime(sale.carrier_delivered_at)}
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
          label={fromShopfront ? 'Items' : 'Item'}
          summary={
            fromShopfront
              ? `${lineItems.length} ${lineItems.length === 1 ? 'item' : 'items'} from ${sale.item_title} · ${money(itemTotal)}`
              : `${sale.item_title} · ${money(itemTotal)}`
          }
        >
          {/* A shopfront contract leads with WHAT WAS AGREED, not the listing.
              The listing is a binder that stays on sale and that the seller can
              still edit; these lines are the contract, and they are frozen once
              payment starts (0064). */}
          {fromShopfront ? (
            <div className="space-y-3">
              <ContractLineItemsList lines={lineItems} currency={sale.currency} />
              {editable ? (
                <>
                  <EditContractItemsDialog
                    cashSaleId={sale.id}
                    termsVersion={sale.terms_version}
                    lines={lineItems}
                  />
                  <p className="text-xs text-muted-foreground">
                    Changing this list re-prices the contract and clears both
                    acceptances, so you will each need to accept again.
                  </p>
                </>
              ) : null}
              <p className="text-xs text-muted-foreground">
                From{' '}
                <Link
                  href={`/listings/${sale.item_id}`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {sale.item_title}
                </Link>
                . Nothing on that listing is held for you — this contract is what
                you both agreed to.
              </p>
            </div>
          ) : (
            <CashSaleItemSnapshot
              title={sale.item_title}
              condition={sale.item_condition}
              agreedPriceCents={itemTotal}
              currency={sale.currency}
              description={sale.item_description}
              images={itemImages}
              listingId={sale.item_id}
            />
          )}
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.parties}
          label="Parties"
          summary={`Identity and trading history · ${them.name}`}
          contentClassName="space-y-3"
        >
          {/* The commitment-point disclosure belongs with the people involved, not
              the action card. It is fetched by the component, which re-checks that
              the viewer is a party before releasing the legal name. */}
          <CounterpartyIdentity
            counterpartyId={iAmBuyer ? sale.seller_id : sale.buyer_id}
            displayName={them.name}
          />
          <ContractPartyDetails
            me={toContractParty(me)}
            them={toContractParty(them)}
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
                className="h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5"
                onClick={() => setDetailsFor(sale.fulfillment_method!)}
              >
                <Pencil aria-hidden />
                Edit terms
              </Button>
            ) : null
          }
        >
          {!termsSet ? (
            editable ? (
              <div className="flex min-h-0 flex-1 items-center justify-center py-6 sm:py-8">
                <div className="w-full max-w-xl rounded-xl border bg-background p-5 text-center sm:p-6">
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
                  proposal before Stripe begins collection.
                </p>
                </div>
              </div>
            ) : (
              <p className="mx-auto max-w-lg text-center text-muted-foreground">
                This contract was opened before handover terms existed, so there is no
                proposal to review.
              </p>
            )
          ) : (
            <div className="flex w-full min-h-0 flex-1 flex-col gap-3">
              <div
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
                aria-label={`Terms version ${sale.terms_version} acceptance status`}
              >
                <span className="font-semibold text-foreground">
                  Version {sale.terms_version}
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span>
                    You: <span className="font-medium text-foreground">{iAccepted ? 'accepted' : 'needs acceptance'}</span>
                  </span>
                  <span>
                    {them.name}: <span className="font-medium text-foreground">{theyAccepted ? 'accepted' : 'waiting'}</span>
                  </span>
                </div>
              </div>
              <ContractMoneyTable
                ariaLabel="Proposed handover terms"
                rows={
                  isDelivery
                    ? [
                        {
                          label: 'Delivery address',
                          hint: deliveryAddress?.label ?? (
                            sale.delivery_address_configured
                              ? 'Confirmed. Shared with the seller once payment is collected.'
                              : 'Buyer must select an address before either party can accept.'
                          ),
                          value: money(sale.shipping_cost_cents),
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
                  <div className="flex min-h-32 items-center rounded-md border border-dashed bg-muted/30 px-4 text-sm text-muted-foreground">
                    This meeting location needs a confirmed map pin. Edit terms to
                    select the agreed place from the suggestions.
                  </div>
                )
              ) : null}
              {editable ? (
                <p className="text-xs text-muted-foreground">
                  Editing creates a new version and clears both acceptances. Stripe
                  begins collection only after you both accept the current version.
                </p>
              ) : null}
            </div>
          )}
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.payment}
          label="Stripe"
          summary={`${money(sale.amount_cents)} · buyer pays via Stripe`}
        >
          <>
            <ContractMoneyTable
              ariaLabel="Stripe breakdown"
              rows={[
                { label: 'Agreed item price', value: money(itemTotal) },
                {
                  label: isDelivery ? 'Shipping' : 'Shipping (not applicable)',
                  value: money(sale.shipping_cost_cents),
                },
                {
                  label: `Platform fee (${PLATFORM_FEE_BPS / 100}%)`,
                  value: money(sale.platform_fee_cents),
                },
                {
                  label: 'Buyer pays via Stripe',
                  value: money(sale.amount_cents),
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
            {/* A shopfront contract has no standalone price to propose: its total
                is the sum of its line items, so "Change items" in the Items row
                is the only way it moves (0064). Offering both would be two
                sources of truth for the number being charged. */}
            {editable && !fromShopfront ? (
              <div className="mt-3 flex justify-end">
                <CashSalePriceDialog
                  cashSaleId={sale.id}
                  termsVersion={sale.terms_version}
                  agreedPriceCents={sale.agreed_price_cents}
                  currency={sale.currency}
                />
              </div>
            ) : null}
          </>
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.collateral}
          label="Protection"
          explainer="You're protected by NoDitto until you have the item and are happy with it. Open the full explanation to see how buyer protection works at each stage."
          summary="Buyer protection active"
          contentClassName="gap-3"
        >
          {/* NO COLLATERAL ON A CASH SALE, so this tab does not mention any. The
              Buyer's money is collected up front, which leaves nothing for either
              party to guarantee with a card hold — and the only Seller bond the
              policy could ever produce required an UNVERIFIED Seller, which
              publishing a listing makes impossible. See
              `CashSaleProtectionExplainer`. */}
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">Your payment is the protection here</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {seller.name} is paid only once the sale resolves — not when the
                item is sent.
              </p>
            </div>
            <CollateralExplainerDialog
              title="Where your money sits"
              description="Payment is collected up front and held by NoDitto until the sale resolves."
              triggerLabel="How protection works"
            >
              <CashSaleProtectionExplainer />
            </CollateralExplainerDialog>
          </div>
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
        deliveryAddress={deliveryAddress}
        canEditDeliveryAddress={iAmBuyer}
        canEditShippingCost={!iAmBuyer}
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
        // "locked in escrow" replaced with what actually happens: NoDitto is holding
        // the funds and stops releasing them. Escrow has a specific legal meaning that
        // implies a segregated arrangement, and these funds sit in the platform's own
        // balance — so the plainer description is both accurate and less of a claim.
        description="NoDitto keeps holding your payment while the case is reviewed, and the seller is notified immediately. You cannot undo this."
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
