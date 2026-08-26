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

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Check,
  Handshake,
  Loader2,
  PackageCheck,
  Pencil,
  ShieldAlert,
  Truck,
} from 'lucide-react';
import { DesktopOnly } from '@/components/layout/Breakpoint';
import { PlaceMap } from '@/components/location';
import { ImageGallery } from '@/components/listings/ImageGallery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
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
} from '@/components/contract';
import {
  CASH_SALE_SECTIONS,
  currentStep,
  deriveCashSaleSteps,
} from '@/domain/contract';
import { CASH_SALE_STATUS_MAP, CashSaleStatusBadge } from './CashSaleStatusBadge';
import { CashSalePriceDialog } from './CashSalePriceDialog';
import { CashSaleTermsDialog } from './CashSaleTermsDialog';
import { EditContractItemsDialog } from './EditContractItemsDialog';
import { type ContractLine } from './ContractLineItems';
import { CashSaleDisputeResolution } from './CashSaleDisputeResolution';
import { CashSaleReturnPanel } from './CashSaleReturnPanel';
import type { DisputeEvidenceEntry } from '@/lib/actions/disputeEvidence';
import { cashSaleErrorMessage } from './errorCopy';
import { HandoverFailedDialog } from './HandoverFailedDialog';
import { AcceptWithPhotoDialog } from '@/components/contract/AcceptWithPhotoDialog';
import { ReportDialog } from '@/components/reports/ReportDialog';

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
  const lineCopy =
    lines.length === 1
      ? lines[0].description.trim()
      : '';
  const descriptionBody = lineCopy || copy;
  const descriptions =
    lines.length > 1
      ? lines.map((line) => line.description.trim()).filter(Boolean)
      : descriptionBody
        ? [descriptionBody]
        : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col items-stretch gap-6">
      <div className="min-w-0">
        <ImageGallery
          images={galleryImages}
          title={title}
          frameClassName="min-h-[18rem] max-h-[26rem]"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <header>
          <p className="text-display font-semibold tabular-nums tracking-[-0.03em]">
            {formatMoney(agreedPriceCents, currency)}
          </p>
          <h3 className="mt-snug break-words text-head font-semibold tracking-tight">
            {title}
          </h3>
          {condition ? (
            <Badge variant="outline" className="mt-snug">
              {condition}
            </Badge>
          ) : null}
        </header>

        {descriptions.length > 0 ? (
          <section aria-label="Description" className="space-y-3">
            {descriptions.map((text, index) => (
              <p
                key={lines[index]?.id ?? index}
                className="whitespace-pre-line break-words text-body leading-relaxed text-muted-foreground"
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
  /** A real carrier provider is configured to poll status. */
  trackingRefreshAvailable?: boolean;
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
    NOT_DUE: 'Released to you once the buyer completes the purchase, or the inspection window closes.',
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
  trackingRefreshAvailable = false,
  lineItems = [],
  disputeEvidence = [],
  returnAddress = null,
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
  const [confirming, setConfirming] = useState<
    'cancel' | 'dispute' | 'pay' | 'receive' | 'handover' | null
  >(null);
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
  // Contents are negotiable until the buyer pays — payment freezes the contract.
  const fromShopfront = sale.from_shopfront === true;

  const termsSet = sale.fulfillment_method !== null;
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

  const myHandoverConfirmed = Boolean(
    iAmBuyer ? sale.buyer_handover_confirmed_at : sale.seller_handover_confirmed_at,
  );
  const theirHandoverConfirmed = Boolean(
    iAmBuyer ? sale.seller_handover_confirmed_at : sale.buyer_handover_confirmed_at,
  );

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
    <div className="flex min-h-0 flex-1 flex-col gap-group lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
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
          connectionStatus={connectionStatus}
        />
      </DesktopOnly>

      <ContractLiveRow
        detailsTitle={sale.item_title}
        detailsMeta={
          <>
            <CashSaleStatusBadge status={sale.status} />
            <span className="display-value text-foreground">
              {money(sale.amount_cents)} total
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
            statusLabel={CASH_SALE_STATUS_MAP[sale.status]?.label ?? null}
            subject={{
              title: sale.item_title,
              thumb: itemImages[0] ?? null,
              price: money(sale.amount_cents),
            }}
            failed={chat.failed}
            onRetry={chat.retry}
            actions={
          <FadeSwap id={`${sale.status}:${step?.id ?? 'complete'}`}>
          <ContractActionCard
            appearance="header"
            step={step}
            tone={isLegacy ? 'warning' : STATUS_TONE[sale.status]}
            title={isLegacy ? 'This contract cannot be continued' : undefined}
            detail={
              isLegacy
                ? 'It was created by the earlier pay-immediately flow, so it has no agreed terms. Start a new purchase from the listing.'
                : undefined
            }
            more={
              <>
                {editable && !isLegacy ? (
                  <Button
                    type="button"
                    variant="destructive"
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
                    <Link href={`/listings/${sale.item_id}`}>Go to the listing</Link>
                  </Button>
                ) : null}
                {sale.status === 'IN_TRANSIT' && iAmBuyer ? (
                  <HandoverFailedDialog
                    cashSaleId={sale.id}
                    triggerLabel="Not received"
                    triggerVariant="destructive"
                  />
                ) : null}
                {sale.status === 'HANDOVER' ? (
                  <HandoverFailedDialog
                    cashSaleId={sale.id}
                    triggerLabel="Handover failed"
                    triggerVariant="destructive"
                  />
                ) : null}
                {sale.status === 'INSPECTION' && iAmBuyer ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => focusSection(CASH_SALE_SECTIONS.collateral)}
                  >
                    Something wrong?
                  </Button>
                ) : null}
                {sale.tracking_number &&
                sale.status === 'IN_TRANSIT' &&
                trackingRefreshAvailable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    aria-busy={busy('track')}
                    onClick={() =>
                      run('track', () => syncCashSaleTracking(sale.id), 'Tracking refreshed.')
                    }
                  >
                    Refresh tracking
                  </Button>
                ) : null}
                {sale.status === 'CANCELLED' || sale.status === 'FAILED' ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/listings">Browse listings</Link>
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
                    disabled={isPending || !deliveryReady}
                    aria-busy={busy('accept')}
                    onClick={() => setConfirming('pay')}
                  >
                    {busy('accept') ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : null}
                    Accept terms and pay
                  </Button>
                ) : null}
              </>
            ) : null}

            {sale.status === 'ESCROW_HELD' && isDelivery && iAmSeller ? (
              <div className="flex w-full flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <Input
                  value={carrier}
                  onChange={(event) => setCarrier(event.target.value)}
                  placeholder="Carrier"
                  aria-label="Carrier"
                  className="w-full sm:w-36"
                />
                <Input
                  value={trackingNumber}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                  placeholder="Tracking"
                  aria-label="Tracking number"
                  className="w-full sm:w-36"
                />
                <Button
                  type="button"
                  variant="action"
                  size="sm"
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

            {sale.tracking_number && sale.status === 'IN_TRANSIT' ? (
              <span className="text-body text-muted-foreground">
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
              </span>
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
                {busy('receive') ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <PackageCheck aria-hidden />
                )}
                Confirm delivery
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
                {busy('handover') ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : myHandoverConfirmed ? (
                  <Check aria-hidden />
                ) : (
                  <Handshake aria-hidden />
                )}
                {busy('handover')
                  ? 'Confirming…'
                  : myHandoverConfirmed
                    ? 'Handover confirmed'
                    : 'Confirm handover'}
              </Button>
            ) : null}

            {sale.status === 'INSPECTION' && iAmBuyer ? (
              <AcceptWithPhotoDialog
                onAccept={async () => {
                  const result = await acceptCashSaleInspection(sale.id);
                  return { ok: result.ok };
                }}
                evidenceContext={{ caseKind: 'CASH_SALE', caseRef: sale.id }}
                triggerLabel="Complete purchase"
                title="Complete purchase"
                description="Optionally photograph what you received. This becomes your baseline evidence if a dispute arises later."
                successMessage="Purchase completed."
                confirmWithPhotoLabel="Complete with photo"
                confirmWithoutPhotoLabel="Complete without photo"
              />
            ) : null}

            {sale.status === 'DISPUTED' ? (
              <Button
                type="button"
                variant="action"
                size="sm"
                onClick={() => focusSection(CASH_SALE_SECTIONS.dispute)}
              >
                <ShieldAlert aria-hidden />
                {sale.disputed_by === myUserId
                  ? 'Review dispute'
                  : 'Respond to dispute'}
              </Button>
            ) : null}

            {sale.status === 'RETURN_PENDING' || sale.status === 'RETURN_IN_TRANSIT' ? (
              <Button
                type="button"
                variant="action"
                size="sm"
                onClick={() => focusSection(CASH_SALE_SECTIONS.actions)}
              >
                View return
              </Button>
            ) : null}
          </ContractActionCard>
          </FadeSwap>
            }
          />
        }
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
                className="gap-tight px-3 text-meta font-medium [&_svg]:size-3"
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
                  <h3 className="text-subhead font-semibold tracking-tight">
                    Propose handover terms
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-body text-muted-foreground">
                    Choose how the item will change hands. You&apos;ll add the address or
                    meeting details next.
                  </p>

                  <div className="mt-5 flex flex-wrap items-center justify-center gap-cozy">
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
                            'flex size-24 shrink-0 touch-manipulation flex-col items-center justify-center gap-snug rounded-lg border border-input bg-card p-snug text-center text-meta font-semibold transition-colors sm:size-28',
                            'hover:border-gold/40 hover:bg-accent focus-visible:border-gold/40 focus-visible:outline-none',
                            'disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground',
                          )}
                        >
                          <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="max-w-20 leading-tight">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="mx-auto mt-group max-w-md text-meta text-muted-foreground">
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
            <div className="flex w-full min-h-0 flex-1 flex-col gap-cozy">
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
                              : 'Buyer must select an address before paying.'
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
          summary={`${money(sale.amount_cents)} · buyer pays via Stripe`}
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
          </>
        </ContractDetailRow>

        <ContractDetailRow
          id={CASH_SALE_SECTIONS.collateral}
          label="Protection"
          summary="Payment held through inspection"
          contentClassName="gap-3"
        >
          {/* NO COLLATERAL ON A CASH SALE, so this tab does not mention any. The
              Buyer's money is collected up front, which leaves nothing for either
              party to guarantee with a card hold — and the only Seller bond the
              policy could ever produce required an UNVERIFIED Seller, which
              publishing a listing makes impossible. See
              `CashSaleProtectionExplainer`. */}
          <div className="space-y-cozy">
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
            <CashSaleProtectionExplainer
              viewerIsBuyer={iAmBuyer}
              inPerson={!isDelivery}
            />
            {sale.status === 'INSPECTION' && iAmBuyer ? (
              <div className="space-y-snug border-t pt-group">
                <div>
                  <Label htmlFor="cash-sale-dispute-reason">
                    Report a problem before payment is released
                  </Label>
                  <p className="mt-1 text-body text-muted-foreground">
                    Describe how the item differs from the agreement. You can add
                    evidence after opening the dispute.
                  </p>
                </div>
                <Textarea
                  id="cash-sale-dispute-reason"
                  value={disputeReason}
                  onChange={(event) => setDisputeReason(event.target.value)}
                  placeholder="e.g. The card arrived with a crease not shown in the photos…"
                  rows={3}
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
            ) : null}
          </div>
        </ContractDetailRow>

        {/* Dispute evidence (0082). Present ONLY while the contract is disputed or
            has been decided — a Dispute tab on a healthy contract would invite one.
            Placed before History because it is the live thing being worked on; the
            timeline is the record behind it. */}
        {sale.status === 'RETURN_PENDING' || sale.status === 'RETURN_IN_TRANSIT' ? (
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
              counterpartyName={them.name}
            />
          </ContractDetailRow>
        ) : null}

        {sale.status === 'DISPUTED' || sale.dispute_resolution ? (
          <ContractDetailRow
            id={CASH_SALE_SECTIONS.dispute}
            label="Dispute"
            variant="destructive"
            explainer="Your account of what happened, with photos or video. Both of you can see everything here, and so can the staff member deciding it."
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
        onOpenChange={(next) => setConfirming(next ? 'pay' : null)}
        title="Accept these terms and pay?"
        description="This charges your card through Stripe and holds the payment until the item is handed over. You can still raise a dispute if something goes wrong."
        confirmLabel="Accept terms and pay"
        pending={busy('accept')}
        helpHref="/help#holds"
        onConfirm={() => {
          setConfirming(null);
          run(
            'accept',
            () => acceptCashSaleTerms(sale.id, sale.terms_version),
            'Payment started.',
          );
        }}
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
          run('receive', () => recordCashSaleReceipt(sale.id), 'Receipt recorded.');
        }}
      />
      <ConfirmDialog
        open={confirming === 'handover'}
        onOpenChange={(next) => setConfirming(next ? 'handover' : null)}
        title="Confirm the handover happened?"
        description={
          theirHandoverConfirmed
            ? `${them.name} has already confirmed. Your confirmation completes the sale and pays the seller. Only confirm if you met and the item actually changed hands.`
            : 'Only confirm if you met and the item actually changed hands. The sale completes and the seller is paid when you both confirm — one confirmation is not enough.'
        }
        confirmLabel={iAmBuyer ? 'We met and I have the item' : 'We met and I handed it over'}
        pending={busy('handover')}
        helpHref="/help#holds"
        onConfirm={() => {
          setConfirming(null);
          run(
            'handover',
            () => confirmCashSaleHandover(sale.id),
            'Handover confirmed.',
          );
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
        // The platform holds funds until resolution — never say "escrow" because it
        // implies a segregated custodial arrangement that does not exist.
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
