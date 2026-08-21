'use client';

// components/trade/ActionBar.tsx
//
// Renders exactly the controls the state machine permits for the current
// Trade_State + viewer, and NONE when no action is allowed (Req 11.3, 11.4).
// The set of controls is derived solely from `availableActions(state, viewer)`
// so transition/permission rules are never hard-coded here.
//
// Each control is wired to its corresponding trade server action:
//   RECORD_SHIPMENT         -> recordShipment (carrier + tracking, posted trades)
//   CONFIRM_HANDOVER        -> confirmTradeHandover (face-to-face trades)
//   REPORT_HANDOVER_FAILED  -> reportTradeHandoverFailed (freezes, captures nothing)
//   RECORD_RECEIPT          -> recordReceipt
//   RECORD_ACCEPTANCE       -> recordAcceptance
//   RAISE_DISPUTE           -> raiseDispute
//   REPORT_FRAUD            -> reportFraud
//   RETRY_COLLATERAL        -> retryTradeCollateral (declined card, replace then retry)
//
// COLLATERAL_LOCKED now offers a DIFFERENT control per fulfilment method. Before
// 0057 it always offered "Record shipment", so two people meeting in a car park were
// asked to record a shipment each — the visible half of a trade room that had a
// delivery method it never acted on.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  HandoverFailedDialog,
  RecordShipmentDialog,
  type ShipmentInput,
} from '@/components/fulfilment';
import { AcceptWithPhotoDialog } from '@/components/contract/AcceptWithPhotoDialog';
import { availableActions } from '@/domain/state-machine/actions';
import type {
  TradeAction,
  TradeState,
  TradeViewerContext,
} from '@/domain/state-machine/types';
import type { FulfilmentMethod } from '@/domain/fulfilment';
import {
  confirmTradeHandover,
  raiseDispute,
  recordAcceptance,
  recordReceipt,
  recordShipment,
  reportFraud,
  reportTradeHandoverFailed,
} from '@/lib/actions/trades';
import { retryTradeCollateral } from '@/lib/actions/tradeNegotiation';
import { SavedCardRow } from '@/components/payments/SavedCardRow';

/** A minimal shape common to every trade action result. */
type ActionResult = { ok: boolean; error?: string; detail?: string };

/** Static descriptor for how each action renders and behaves. */
interface ActionConfig {
  label: string;
  /** Toast shown on success. */
  successMessage: string;
  variant: NonNullable<ButtonProps['variant']>;
  /** Irreversible actions require an explicit confirmation dialog. */
  confirm?: {
    title: string;
    description: string;
    confirmLabel: string;
    helpHref?: string;
  };
}

/**
 * The actions this bar owns as plain buttons.
 *
 * `availableActions` also returns the negotiation controls (PROPOSE_TERMS /
 * ACCEPT_TERMS / DECLINE_OFFER) while a Trade is NEGOTIATING. They are rendered
 * by the room's terms panel instead, because proposing terms needs a form — cash
 * amount, direction, handover, meeting place — not a single button. Filtering
 * here rather than narrowing the domain keeps `availableActions` the one honest
 * answer to "what may this viewer do now".
 *
 * REPORT_HANDOVER_FAILED is also permitted by the domain but is not in this list: it
 * needs a reason and evidence, so it renders as its own dialog below.
 */
const BAR_ACTIONS = [
  'RECORD_SHIPMENT',
  'CONFIRM_HANDOVER',
  'RECORD_RECEIPT',
  'RECORD_ACCEPTANCE',
  'RAISE_DISPUTE',
  'REPORT_FRAUD',
  'RETRY_COLLATERAL',
] as const satisfies readonly TradeAction[];

type BarAction = (typeof BAR_ACTIONS)[number];

function isBarAction(action: TradeAction): action is BarAction {
  return (BAR_ACTIONS as readonly TradeAction[]).includes(action);
}

const ACTION_CONFIG: Record<BarAction, ActionConfig> = {
  RECORD_SHIPMENT: {
    label: 'Record shipment',
    successMessage: 'Shipment recorded.',
    variant: 'default',
  },
  CONFIRM_HANDOVER: {
    label: 'Confirm handover',
    successMessage: 'Handover confirmed.',
    variant: 'default',
    // Worth a confirmation step, but note what it does and does not say. Confirming
    // means "we met and swapped", and the trade moves to INSPECTION — it does NOT
    // release the collateral, which is what accepting the item does afterwards.
    // A trader who has just been robbed or handed a fake must not sign the trade off
    // at the meeting point, which is why this does not complete the trade.
    confirm: {
      title: 'Confirm the handover happened?',
      description:
        'Only confirm if you met and the goods actually changed hands. This does not release either deposit — you still get 72 hours from the meeting time to check what you received and accept it or raise a dispute.',
      confirmLabel: 'We met and swapped',
      helpHref: '/help#holds',
    },
  },
  RECORD_RECEIPT: {
    label: 'Record receipt',
    successMessage: 'Receipt recorded.',
    variant: 'default',
    confirm: {
      title: 'Confirm you received the item?',
      description: 'This starts your inspection window.',
      confirmLabel: 'Record receipt',
      helpHref: '/help#holds',
    },
  },
  RECORD_ACCEPTANCE: {
    label: 'Accept item',
    successMessage: 'Acceptance recorded.',
    variant: 'default',
  },
  // Both of these describe what RAISING does, not what resolving does. Neither
  // moves money any more: a participant freezes the trade and states their case, and
  // a CardTrade operator decides the outcome. The previous copy promised the caller
  // the other trader's deposit, which was both a promise the caller could not be
  // entitled to make and an accurate description of a hole that has since been shut.
  //
  // NEITHER USES A BARE CONFIRM ANY MORE (0083). Both now collect the claimant's own
  // account through `HandoverFailedDialog`, the same surface the never-arrived report
  // uses, because a dispute that captures $20 from the other trader — and a fraud claim
  // that can capture their whole collateral — must say what it is about. The Cash_Sale
  // room has demanded a reason since 0044; these did not, and an arbitrator opening a
  // trade case got three ids and a timestamp.
  RAISE_DISPUTE: {
    label: 'Raise dispute',
    successMessage: 'Dispute raised. NoDitto support will review it.',
    variant: 'destructive',
  },
  REPORT_FRAUD: {
    label: 'Report fraud',
    successMessage: 'Fraud reported. NoDitto support will review it.',
    variant: 'destructive',
  },
  RETRY_COLLATERAL: {
    label: 'Retry hold',
    successMessage: 'Retrying the card hold.',
    variant: 'default',
  },
};

/** Friendly messages for the typed error codes the actions can return. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to continue.',
  'not-participant': 'You are not a participant in this trade.',
  'not-permitted': 'That action is not permitted in the current state.',
  'already-recorded': 'You have already recorded that action.',
  'invalid-reason': 'Describe what happened in at least a sentence.',
  INVALID_TRANSITION: 'That action is no longer valid for this trade.',
  CONCURRENT_MODIFICATION:
    'The trade was just updated by someone else. Please try again.',
  TRADE_NOT_FOUND: 'This trade could not be found.',
  HOLD_NOT_FOUND: 'A collateral hold for this trade could not be found.',
  'bond-failed': 'The card hold could not be placed.',
};

/** Resolve a user-facing message for a typed action failure. */
function errorMessage(result: ActionResult): string {
  const code = result.error ?? '';
  return (
    ERROR_MESSAGES[code] ??
    result.detail ??
    'Something went wrong. Please try again.'
  );
}

async function runAction(
  action: BarAction,
  tradeId: string,
  shipment?: ShipmentInput,
): Promise<ActionResult> {
  switch (action) {
    case 'RECORD_SHIPMENT':
      return recordShipment(tradeId, shipment);
    case 'CONFIRM_HANDOVER':
      return confirmTradeHandover(tradeId);
    case 'RECORD_RECEIPT':
      return recordReceipt(tradeId);
    case 'RECORD_ACCEPTANCE':
      return recordAcceptance(tradeId);
    // RAISE_DISPUTE and REPORT_FRAUD are NOT routed here (0083). Both need the
    // claimant's own account, so both render their own dialog and call the action
    // with the reason directly. Reaching this branch would mean a button bypassed
    // that dialog, which must fail loudly rather than filing a claim with no words.
    case 'RAISE_DISPUTE':
    case 'REPORT_FRAUD':
      throw new Error(
        `${action} must be raised through its dialog so a reason is captured.`,
      );
    case 'RETRY_COLLATERAL': {
      const result = await retryTradeCollateral(tradeId);
      return result.ok
        ? { ok: true }
        : { ok: false, error: result.error, detail: result.message };
    }
  }
}

export interface ActionBarProps {
  tradeId: string;
  state: TradeState;
  viewer: TradeViewerContext;
  /** Decides whether the viewer records a shipment or confirms a handover. */
  handoverMethod?: FulfilmentMethod | null;
  /** The other trader's name, for shipment copy. */
  counterpartName?: string | null;
  /** Whether the sender has the recipient's postal address yet. */
  recipientAddressKnown?: boolean;
}

/**
 * State-dependent trade controls (Req 11.3, 11.4). Renders one button per
 * permitted action and nothing at all when `availableActions` is empty.
 */
export function ActionBar({
  tradeId,
  state,
  viewer,
  handoverMethod = null,
  counterpartName,
  recipientAddressKnown = true,
}: ActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingConfirm, setPendingConfirm] = useState<BarAction | null>(null);
  const [shipOpen, setShipOpen] = useState(false);

  const permitted = availableActions(state, viewer);
  const actions = permitted.filter(isBarAction);
  const canReportFailure = permitted.includes('REPORT_HANDOVER_FAILED');

  if (actions.length === 0 && !canReportFailure) {
    return null;
  }

  function invoke(action: BarAction, shipment?: ShipmentInput): Promise<boolean> {
    const config = ACTION_CONFIG[action];
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await runAction(action, tradeId, shipment);
        if (result.ok) {
          toast.success(config.successMessage);
          setShipOpen(false);
          resolve(true);
        } else {
          toast.error(errorMessage(result));
          resolve(false);
        }
      });
    });
  }

  function handleClick(action: BarAction) {
    const config = ACTION_CONFIG[action];
    if (action === 'RECORD_SHIPMENT') {
      setShipOpen(true);
      return;
    }
    if (config.confirm) {
      setPendingConfirm(action);
    } else {
      invoke(action);
    }
  }

  const confirmConfig = pendingConfirm ? ACTION_CONFIG[pendingConfirm] : null;

  return (
    <>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3" role="group" aria-label="Trade actions">
        {actions.map((action) => {
          const config = ACTION_CONFIG[action];

          if (action === 'RETRY_COLLATERAL') {
            return (
              <div key={action} className="flex w-full min-w-0 flex-col gap-2">
                <p className="text-body text-muted-foreground">
                  A card declined the hold, so the trade is paused. Nothing was
                  charged. Replace the card that failed, then retry.
                </p>
                <SavedCardRow className="w-full sm:max-w-sm" />
                <Button
                  variant="default"
                  className="w-full sm:w-auto"
                  onClick={() => invoke(action)}
                  disabled={isPending}
                  aria-busy={isPending}
                >
                  {isPending ? 'Retrying…' : 'Retry hold'}
                </Button>
              </div>
            );
          }

          // Dispute and fraud collect the claimant's account rather than a bare
          // confirm (0083) — see the note on ACTION_CONFIG.
          if (action === 'RAISE_DISPUTE') {
            return (
              <HandoverFailedDialog
                key={action}
                triggerLabel="Raise dispute"
                triggerVariant="outline"
                title="Raise a condition dispute"
                outcomeDescription="Use this when the item is not in the condition that was agreed. Both deposits stay frozen while NoDitto support reviews it, and $20.00 is taken from the other trader towards return postage. Describe what is wrong — support decides on what you write here."
                successMessage={config.successMessage}
                reasonPlaceholder="e.g. the card was described as Near Mint but has a crease down the front and whitening on all four corners…"
                evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
                onSubmit={async (reason) => {
                  const result = await raiseDispute(tradeId, reason);
                  return result.ok
                    ? { ok: true }
                    : { ok: false, message: errorMessage(result) };
                }}
              />
            );
          }

          if (action === 'REPORT_FRAUD') {
            return (
              <HandoverFailedDialog
                key={action}
                triggerLabel="Report fraud"
                triggerVariant="destructive"
                title="Report fraud"
                outcomeDescription="Use this for an empty box or a counterfeit item. This freezes both deposits and sends the trade to NoDitto support, who decides the outcome. Reporting it does not by itself move any money, and the other trader will see what you have alleged."
                successMessage={config.successMessage}
                reasonPlaceholder="e.g. the sleeve was sealed but empty; the card fails a light test and the print pattern is wrong…"
                evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
                onSubmit={async (reason) => {
                  const result = await reportFraud(tradeId, reason);
                  return result.ok
                    ? { ok: true }
                    : { ok: false, message: errorMessage(result) };
                }}
              />
            );
          }

          if (action === 'RECORD_ACCEPTANCE') {
            return (
              <AcceptWithPhotoDialog
                key={action}
                onAccept={async () => {
                  const result = await recordAcceptance(tradeId);
                  if (result.ok) toast.success(config.successMessage);
                  else toast.error(errorMessage(result));
                  return result;
                }}
                evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
                triggerLabel="Accept item"
                title="Accept what you received"
                description="Optionally photograph the item as you received it. This becomes your baseline evidence if a dispute arises later."
                successMessage={config.successMessage}
              />
            );
          }

          return (
            <Button
              key={action}
              variant={config.variant}
              className="w-full sm:w-auto"
              onClick={() => handleClick(action)}
              disabled={isPending}
              aria-busy={isPending}
            >
              {config.label}
            </Button>
          );
        })}

        {/* The exchange did not happen: a no-show, a refusal at the meeting point,
            an exchange under duress, or a parcel that never arrived. Freezes the
            trade for review and captures nothing — which is why it is separate from
            RAISE_DISPUTE, whose Friction_Tax would settle $20 against a trader who
            may have done nothing wrong. */}
        {canReportFailure ? (
          <HandoverFailedDialog
            triggerLabel={
              handoverMethod === 'IN_PERSON' ? 'Handover failed' : 'Item never arrived'
            }
            title={
              handoverMethod === 'IN_PERSON'
                ? 'Report a failed handover'
                : 'Report an item that never arrived'
            }
            outcomeDescription={
              handoverMethod === 'IN_PERSON'
                ? 'Use this if the other trader did not show up, refused to hand over, or the exchange went wrong. The trade freezes for review and NOTHING is charged to either of you — NoDitto support decides what happens next.'
                : 'Use this if the parcel has not arrived or arrived empty. The trade freezes for review and NOTHING is charged to either of you — a lost parcel is nobody’s fault, so no deposit is taken while an operator looks at it.'
            }
            successMessage="Reported. The trade is frozen and an operator will review it."
            reasonPlaceholder={
              handoverMethod === 'IN_PERSON'
                ? 'e.g. they did not turn up at the agreed time and have not replied…'
                : 'e.g. tracking says delivered but nothing arrived; the box was empty…'
            }
            evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
            onSubmit={async (reason) => {
              const result = await reportTradeHandoverFailed(tradeId, reason);
              return result.ok
                ? { ok: true }
                : { ok: false, message: errorMessage(result) };
            }}
          />
        ) : null}
      </div>

      <RecordShipmentDialog
        open={shipOpen}
        onOpenChange={setShipOpen}
        pending={isPending}
        recipientName={counterpartName}
        recipientAddressKnown={recipientAddressKnown}
        onSubmit={(shipment) => invoke('RECORD_SHIPMENT', shipment)}
      />

      <ConfirmDialog
        open={pendingConfirm !== null && Boolean(confirmConfig?.confirm)}
        onOpenChange={(open) => {
          if (isPending) return;
          if (!open) setPendingConfirm(null);
        }}
        title={confirmConfig?.confirm?.title ?? ''}
        description={confirmConfig?.confirm?.description ?? ''}
        confirmLabel={confirmConfig?.confirm?.confirmLabel ?? ''}
        confirmVariant={confirmConfig?.variant}
        pending={isPending}
        helpHref={confirmConfig?.confirm?.helpHref}
        onConfirm={async () => {
          const action = pendingConfirm;
          if (!action) return;
          const ok = await invoke(action);
          if (ok) setPendingConfirm(null);
        }}
      />
    </>
  );
}
