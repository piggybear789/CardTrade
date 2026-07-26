'use client';

// components/sales/CashSaleView.tsx
// Live bilateral contract room: participant cards flank chat, while versioned
// terms and fulfillment actions remain authoritative below (Req 4).

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CircleDot,
  Clock,
  ExternalLink,
  Handshake,
  Loader2,
  Lock,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Star,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ContractWorkspace } from '@/components/layout/ContractWorkspace';
import { CashSaleChat } from './CashSaleChat';
import { CashSaleItemPreview } from './CashSaleItemPreview';
import { CashSalePriceDialog } from './CashSalePriceDialog';
import { CashSaleTermsDialog } from './CashSaleTermsDialog';
import { CashSaleDemoControls } from './CashSaleDemoControls';
import { HandoverFailedDialog } from './HandoverFailedDialog';
import { requiredBondCents } from '@/domain/bond/bondPolicy';
import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { formatAud } from '@/lib/format';
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
type CashSaleStatus = CashSaleRow['status'];

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

const STATUS_LABEL: Record<CashSaleStatus, string> = {
  AGREEMENT: 'Agreeing terms',
  PAYMENT_PENDING: 'Payment pending',
  ESCROW_HELD: 'Funds confirmed',
  IN_TRANSIT: 'In transit',
  HANDOVER: 'Handover',
  INSPECTION: 'Inspection',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
};

const STATUS_TONE: Record<
  CashSaleStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  AGREEMENT: 'secondary',
  PAYMENT_PENDING: 'secondary',
  ESCROW_HELD: 'default',
  IN_TRANSIT: 'default',
  HANDOVER: 'default',
  INSPECTION: 'default',
  COMPLETED: 'default',
  DISPUTED: 'destructive',
  CANCELLED: 'outline',
  FAILED: 'destructive',
  REFUNDED: 'outline',
};

/** Statuses where the contract is closed and no action remains. */
const TERMINAL_STATUSES = new Set<CashSaleStatus>([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
]);

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

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** One participant column: who they are and what they have agreed to. */
function PartyColumn({
  party,
  isMe,
  acceptedVersion,
  termsVersion,
  children,
}: {
  party: SaleParty;
  isMe: boolean;
  acceptedVersion: number | null;
  termsVersion: number;
  children?: ReactNode;
}) {
  const accepted = acceptedVersion === termsVersion;
  return (
    <Card className={isMe ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{isMe ? 'You' : party.name}</span>
          </CardTitle>
          <Badge variant="outline" className="shrink-0 text-xs">
            {party.role}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isMe ? (
          <p className="truncate text-xs text-muted-foreground">{party.name}</p>
        ) : null}

        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            // Teal (trust) is the reserved token for verified identity/provenance;
            // an unverified party is a caution, not an error, so amber.
            party.verified
              ? 'text-trust'
              : 'text-amber-700 dark:text-amber-400',
          )}
        >
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {party.verified ? 'Identity verified (KYC)' : 'Identity not verified'}
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
                  {party.rating.toFixed(1)}
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
          {party.legalEntityName ? (
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">Legal seller</dt>
              <dd className="min-w-0 text-right font-medium">
                <span className="block truncate">{party.legalEntityName}</span>
                {party.registrationNumber ? (
                  <span className="block font-normal text-muted-foreground">
                    {party.registrationNumber}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="flex items-center gap-2 border-t pt-3 text-xs" aria-live="polite">
          {accepted ? (
            <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <CircleDot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {accepted
            ? `Accepted terms v${termsVersion}`
            : 'Has not accepted the current terms'}
        </p>
        {children}
      </CardContent>
    </Card>
  );
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
export function CashSaleView({
  initialSale,
  myUserId,
  buyer,
  seller,
  conversationId,
}: CashSaleViewProps) {
  const router = useRouter();
  const { sale: liveSale, events, connectionStatus } = useCashSaleRealtime(
    initialSale.id,
  );
  const sale = liveSale ?? initialSale;

  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [chatId, setChatId] = useState<string | null>(conversationId);
  const [chatError, setChatError] = useState(false);
  // Which method the selector picked while its required details are still missing.
  const [detailsFor, setDetailsFor] = useState<'DELIVERY' | 'IN_PERSON' | null>(null);

  // Contracts opened before chat was linked (or an interrupted create) heal on
  // first view: the server resolves or creates the participant thread.
  useEffect(() => {
    const linked = sale.conversation_id ?? conversationId;
    if (linked) {
      setChatId(linked);
      return;
    }
    let cancelled = false;
    void ensureCashSaleConversation(sale.id).then((result) => {
      if (cancelled) return;
      if (result.ok && result.sale.conversationId) {
        setChatId(result.sale.conversationId);
      } else {
        setChatError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sale.id, sale.conversation_id, conversationId]);

  const iAmBuyer = sale.buyer_id === myUserId;
  const me = iAmBuyer ? buyer : seller;
  const them = iAmBuyer ? seller : buyer;
  const myAcceptedVersion = iAmBuyer
    ? sale.buyer_terms_accepted_version
    : sale.seller_terms_accepted_version;
  const theirAcceptedVersion = iAmBuyer
    ? sale.seller_terms_accepted_version
    : sale.buyer_terms_accepted_version;

  const termsSet = sale.fulfillment_method !== null;
  const iAccepted = myAcceptedVersion === sale.terms_version;
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
   * Pick a fulfillment method from the selector. When the method's mandatory
   * details already exist we save straight away; otherwise the details dialog
   * opens pre-set to that method so the terms are never saved half-specified.
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
  const statusLabel = STATUS_LABEL[sale.status];

  // Countdown to automatic completion. Rendered from the stored deadline so both
  // parties see the same instant regardless of clock skew.
  const autoCompleteLabel = (() => {
    if (!sale.inspection_deadline_at) return null;
    const msLeft = new Date(sale.inspection_deadline_at).getTime() - Date.now();
    if (Number.isNaN(msLeft)) return null;
    if (msLeft <= 0) return 'Completing automatically now';
    const days = Math.floor(msLeft / 86_400_000);
    const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);
    const remaining =
      days > 0 ? `${days} day${days === 1 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'}`;
    return `Completes automatically in ${remaining}`;
  })();

  // Collateral on a Cash_Sale is ASYMMETRIC, unlike a 2-way trade. The buyer's
  // whole payment is collected before the seller ships, so the buyer is already
  // committed and posts nothing. The only unsecured risk is an unverified seller
  // taking the money and not delivering, so the bond falls on them alone.
  const sellerUnverified = !seller.verified;
  const sellerBondCents = requiredBondCents({
    verified: !sellerUnverified,
    fmvCents: sale.agreed_price_cents,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Purchase contract
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {sale.item_title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatAud(sale.amount_cents)} total · {formatAud(itemTotal)} item
            {sale.shipping_cost_cents > 0
              ? ` · ${formatAud(sale.shipping_cost_cents)} shipping`
              : ''}
            {` · ${formatAud(sale.platform_fee_cents)} platform fee`}
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <Badge variant={STATUS_TONE[sale.status]}>{statusLabel}</Badge>
        </div>
      </header>

      {/* Both parties must accept the SAME terms version before any money moves.
          Pinned at the top so it's impossible to miss. */}
      {editable ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Handshake className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="text-sm font-semibold">Agree and pay</span>
          </div>

          {!termsSet ? (
            <p className="text-sm text-muted-foreground">
              Choose a fulfillment method below, then you can both accept.
            </p>
          ) : (
            <>
              <ul className="flex items-center gap-2 text-sm" aria-live="polite">
                {(
                  [
                    { label: 'You', accepted: iAccepted },
                    {
                      label: them.name,
                      accepted: theirAcceptedVersion === sale.terms_version,
                    },
                  ] as const
                ).map((entry) => (
                  <li
                    key={entry.label}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1',
                      entry.accepted
                        ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700'
                        : 'border-border bg-muted/50 text-muted-foreground',
                    )}
                  >
                    {entry.accepted ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <CircleDot className="size-3.5" aria-hidden />
                    )}
                    <span className="text-xs font-medium">
                      {entry.label} {entry.accepted ? '✓' : '- pending'}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!termsSet || iAccepted || isPending}
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
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-3.5" aria-hidden />
                  )}
                  {iAccepted
                    ? `Waiting on ${them.name}`
                    : `Accept v${sale.terms_version}`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  aria-busy={busy('cancel')}
                  onClick={() =>
                    run(
                      'cancel',
                      () => cancelCashSaleAgreement(sale.id),
                      'Contract cancelled. The item is available again.',
                    )
                  }
                >
                  <X className="size-3.5" aria-hidden />
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Payment + fulfillment - pinned at top (right below the accept bar) so
          the payment status is impossible to miss after mutual acceptance. */}
      {sale.status !== 'AGREEMENT' && sale.status !== 'CANCELLED' ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-primary" aria-hidden />
              Payment and fulfillment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {sale.status === 'PAYMENT_PENDING' ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
                role="status"
                aria-live="polite"
              >
                <Wallet className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {iAmBuyer
                      ? `Payment of ${formatAud(sale.amount_cents)} requested from your card`
                      : `Payment of ${formatAud(sale.amount_cents)} requested from ${buyer.name}'s card`}
                  </p>
                  <p className="text-muted-foreground">
                    {iAmBuyer
                      ? 'Your payment method is being charged. You\u2019ll be notified once funds clear.'
                      : 'Do not ship or hand over the item until you see confirmation that funds have cleared.'}
                  </p>
                </div>
              </div>
            ) : sale.status === 'FAILED' ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
                role="alert"
              >
                <X className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">Payment failed</p>
                  <p className="text-muted-foreground">
                    The payment could not be collected. The item has been returned to the catalog.
                  </p>
                </div>
              </div>
            ) : sale.status === 'DISPUTED' ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">Dispute raised - contract under review</p>
                  <p className="text-muted-foreground">
                    {sale.disputed_by === myUserId
                      ? 'You raised a dispute. Funds remain in escrow while the case is reviewed. The other party has been notified.'
                      : `${them.name} raised a dispute. Funds remain in escrow while the case is reviewed.`}
                  </p>
                  {sale.dispute_reason ? (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      <p className="text-xs font-medium text-muted-foreground">Reason given:</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs">{sale.dispute_reason}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : sale.status === 'REFUNDED' ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
                aria-live="polite"
              >
                <Wallet className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">Payment refunded</p>
                  <p className="text-muted-foreground">
                    {iAmBuyer
                      ? `${formatAud(sale.amount_cents)} has been returned to your payment method.`
                      : `${formatAud(sale.amount_cents)} has been refunded to the buyer.`}
                  </p>
                </div>
              </div>
            ) : sale.status === 'COMPLETED' ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"
                aria-live="polite"
              >
                <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">Sale complete</p>
                  <p className="text-muted-foreground">
                    {iAmBuyer
                      ? `${formatAud(sale.amount_cents)} has been released to the seller.`
                      : `${formatAud(sale.amount_cents)} has been released to you.`}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"
                aria-live="polite"
              >
                <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {formatAud(sale.amount_cents)} collected and held in escrow
                  </p>
                  <p className="text-muted-foreground">
                    {iAmBuyer
                      ? 'Your payment is secured by Poke-xchange. Funds are released to the seller only after you confirm receipt.'
                      : "The buyer\u2019s payment is secured. Ship or hand over the item to proceed."}
                  </p>
                </div>
              </div>
            )}

            {sale.status === 'PAYMENT_PENDING' ? (
              <CashSaleDemoControls cashSaleId={sale.id} />
            ) : null}

            {/* Fulfillment actions inline within this same card. */}
            {sale.status === 'ESCROW_HELD' && isDelivery ? (
              sale.seller_id === myUserId ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="font-medium">Funds confirmed - ship the item</p>
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
                    disabled={!carrier.trim() || trackingNumber.trim().length < 2 || isPending}
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
              ) : (
                <p className="text-muted-foreground">
                  Waiting for {them.name} to ship and add tracking.
                </p>
              )
            ) : null}

            {sale.tracking_number ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <span>
                  {sale.tracking_carrier} · {sale.tracking_number}
                  {sale.tracking_status ? (
                    <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {sale.tracking_status.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  {sale.status === 'IN_TRANSIT' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={isPending}
                      aria-busy={busy('track')}
                      onClick={() =>
                        run(
                          'track',
                          () => syncCashSaleTracking(sale.id),
                          'Tracking refreshed.',
                        )
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
                      className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                    >
                      Track <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </span>
              </div>
            ) : null}

            {sale.status === 'IN_TRANSIT' && sale.buyer_id === myUserId ? (
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
                  triggerLabel="Item not received"
                />
              </div>
            ) : null}

            {sale.status === 'HANDOVER' ? (
              <div className="space-y-3 rounded-md border p-3">
                <p className="font-medium">Both parties confirm the handover</p>
                <p className="text-xs text-muted-foreground">
                  {sale.buyer_handover_confirmed_at ? 'Buyer confirmed. ' : 'Buyer pending. '}
                  {sale.seller_handover_confirmed_at ? 'Seller confirmed.' : 'Seller pending.'}
                </p>
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
              </div>
            ) : null}

            {sale.status === 'INSPECTION' && sale.inspection_deadline_at ? (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
                <p className="flex items-center gap-2 font-medium">
                  <Clock className="size-4 shrink-0 text-amber-600" aria-hidden />
                  {autoCompleteLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The carrier confirmed delivery
                  {formatDateTime(sale.carrier_delivered_at)
                    ? ` on ${formatDateTime(sale.carrier_delivered_at)}`
                    : ''}
                  . Accepting or disputing now stops the clock.
                </p>
              </div>
            ) : null}

            {sale.status === 'COMPLETED' && sale.auto_completed ? (
              <p className="text-muted-foreground">
                Completed automatically: the inspection window closed after
                carrier-confirmed delivery without the buyer raising an issue.
              </p>
            ) : null}

            {sale.status === 'INSPECTION' && sale.buyer_id === myUserId ? (
              <div className="space-y-3 rounded-md border p-3">
                <p className="font-medium">Inspect and finish</p>
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
                <div className="space-y-2">
                  <Textarea
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                    placeholder="Something wrong? Describe the issue to raise a dispute."
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!disputeReason.trim() || isPending}
                    aria-busy={busy('dispute')}
                    onClick={() =>
                      run(
                        'dispute',
                        () => disputeCashSale(sale.id, disputeReason),
                        'Dispute raised.',
                      )
                    }
                  >
                    Raise dispute
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* What is being bought, from the contract's own snapshot. */}
      <Card>
        <CardContent className="pt-6">
          <CashSaleItemPreview
            itemId={sale.item_id}
            title={sale.item_title}
            condition={sale.item_condition}
            description={sale.item_description}
            imagePaths={sale.item_image_paths}
          />
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
              acceptedVersion={myAcceptedVersion}
              termsVersion={sale.terms_version}
            />
            <PartyColumn
              party={them}
              isMe={false}
              acceptedVersion={theirAcceptedVersion}
              termsVersion={sale.terms_version}
            />
          </>
        }
        conversation={
          chatId ? (
            <CashSaleChat
              conversationId={chatId}
              currentUserId={myUserId}
              counterpartyName={them.name}
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
                        void ensureCashSaleConversation(sale.id).then((result) => {
                          if (result.ok && result.sale.conversationId) {
                            setChatId(result.sale.conversationId);
                          } else {
                            setChatError(true);
                          }
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

      {/* Fulfillment terms */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Fulfillment terms
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                version {sale.terms_version}
              </span>
            </CardTitle>
            {editable && termsSet ? <CashSaleTermsDialog sale={sale} /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {editable ? (
            <div
              role="radiogroup"
              aria-label="Fulfillment method"
              className="grid gap-2 sm:grid-cols-2"
            >
              {(
                [
                  { value: 'DELIVERY', label: 'Ship the item', icon: Truck },
                  { value: 'IN_PERSON', label: 'Meet face to face', icon: MapPin },
                ] as const
              ).map((option) => {
                const selected = sale.fulfillment_method === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={isPending}
                    onClick={() => chooseMethod(option.value)}
                    // Reads as a raised, pressable surface using the same
                    // vocabulary as the outline Button (card fill + shadow +
                    // gold hover border) so it is obviously interactive. Gold
                    // marks the chosen option, matching the brand accent used
                    // for primary affordances elsewhere.
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium',
                      'transition-[color,background-color,border-color,box-shadow,transform] duration-200',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'disabled:pointer-events-none disabled:opacity-45',
                      'motion-safe:hover:-translate-y-px motion-reduce:transform-none',
                      selected
                        ? 'border-gold/60 bg-gold/12 shadow-market hover:border-gold/70 hover:bg-gold/20'
                        : 'border-input bg-card/80 shadow-sm hover:border-gold/50 hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        selected ? 'text-gold' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    {option.label}
                    {selected ? (
                      <Check className="ml-auto size-4 text-gold" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {!termsSet ? (
            <p className="text-muted-foreground">
              {editable
                ? 'Choose how the item changes hands. Either party can propose the terms.'
                : 'This contract was opened before fulfillment terms existed, so there are none to show.'}
            </p>
          ) : isDelivery ? (
            <>
              <p className="flex items-start gap-2">
                <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Shipped to the buyer for {formatAud(sale.shipping_cost_cents)}
                </span>
              </p>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Delivery address (private)
                </p>
                <p className="mt-1 whitespace-pre-wrap">{sale.delivery_address}</p>
              </div>
              {sale.shipping_notes ? (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {sale.shipping_notes}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-primary" aria-hidden />
                Meet at {sale.meeting_location}
              </p>
              <p className="text-muted-foreground">
                {formatDateTime(sale.meeting_at) ?? 'No time agreed yet.'}
              </p>
            </>
          )}
          {editable && termsSet ? (
            <p className="text-xs text-muted-foreground">
              Editing terms clears both acceptances. Money moves only once you both
              accept the same version.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Fulfillment details prompt, opened by the selector when they are missing. */}
      <CashSaleTermsDialog
        sale={sale}
        hideTrigger
        open={detailsFor !== null}
        onOpenChange={(next) => setDetailsFor(next ? detailsFor : null)}
        initialMethod={detailsFor ?? undefined}
      />

      {/* Payment terms */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Payment terms</CardTitle>
            {editable ? (
              <CashSalePriceDialog
                cashSaleId={sale.id}
                termsVersion={sale.terms_version}
                agreedPriceCents={sale.agreed_price_cents}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="rounded-md border text-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted-foreground">Agreed item price</dt>
              <dd className="font-medium tabular-nums">{formatAud(itemTotal)}</dd>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <dt className="text-muted-foreground">
                {isDelivery ? 'Shipping' : 'Shipping (not applicable)'}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatAud(sale.shipping_cost_cents)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <dt className="text-muted-foreground">
                Platform fee ({PLATFORM_FEE_BPS / 100}%)
              </dt>
              <dd className="font-medium tabular-nums">
                {formatAud(sale.platform_fee_cents)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <dt className="font-semibold">Buyer pays</dt>
              <dd className="text-base font-semibold tabular-nums">
                {formatAud(sale.amount_cents)}
              </dd>
            </div>
          </dl>
          {editable ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Changing the price notifies the other party in chat and resets both
              acceptances.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Collateral */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-primary" aria-hidden />
            Collateral
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {sellerBondCents === 0 ? (
            <p className="text-muted-foreground">
              No collateral required. The seller is identity verified, and the buyer
              pays before anything ships, so neither side posts a bond.
            </p>
          ) : (
            <>
              <p>
                The seller is not identity verified, so they post a bond for this
                contract. The buyer posts none - their payment is collected up front.
              </p>
              <dl className="rounded-md border">
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-muted-foreground">
                    {iAmBuyer ? `${seller.name}'s bond` : 'Your bond'}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatAud(sellerBondCents)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <dt className="text-muted-foreground">
                    {iAmBuyer ? 'Your bond' : `${buyer.name}'s bond`}
                  </dt>
                  <dd className="text-muted-foreground">Not required</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Released when the contract completes. Two-way trades keep their own
                symmetric bond rules.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* A pre-redesign contract can never reach fulfillment: say so rather than
          leaving the room looking broken. */}
      {!editable && !termsSet && !TERMINAL_STATUSES.has(sale.status) ? (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium">This contract cannot be continued</p>
            <p className="mt-1 text-muted-foreground">
              It was created by the earlier pay-immediately flow, so it has no agreed
              terms and cannot progress to shipping or handover. Start a new purchase
              from the listing to use the contract flow.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Audit timeline */}
      {events.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contract history</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {event.event.toLowerCase().replace(/_/g, ' ')}
                    {event.detail ? (
                      <span className="text-muted-foreground"> - {event.detail}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(event.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
