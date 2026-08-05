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
//
// COLLATERAL_LOCKED now offers a DIFFERENT control per fulfilment method. Before
// 0057 it always offered "Record shipment", so two people meeting in a car park were
// asked to record a shipment each — the visible half of a trade room that had a
// delivery method it never acted on.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HandoverFailedDialog,
  RecordShipmentDialog,
  type ShipmentInput,
} from '@/components/fulfilment';
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

/** A minimal shape common to every trade action result. */
type ActionResult = { ok: boolean; error?: string; detail?: string };

/** Static descriptor for how each action renders and behaves. */
interface ActionConfig {
  label: string;
  /** Toast shown on success. */
  successMessage: string;
  variant: NonNullable<ButtonProps['variant']>;
  /** Irreversible actions require an explicit confirmation dialog. */
  confirm?: { title: string; description: string; confirmLabel: string };
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
    },
  },
  RECORD_RECEIPT: {
    label: 'Record receipt',
    successMessage: 'Receipt recorded.',
    variant: 'default',
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
  RAISE_DISPUTE: {
    label: 'Raise dispute',
    successMessage: 'Dispute raised. A CardTrade operator will review it.',
    variant: 'outline',
    confirm: {
      title: 'Raise a condition dispute?',
      description:
        'Use this when the item is not in the condition described. Both deposits stay frozen while a CardTrade operator reviews it. If the dispute is upheld, $20.00 goes from the other trader towards return postage.',
      confirmLabel: 'Raise dispute',
    },
  },
  REPORT_FRAUD: {
    label: 'Report fraud',
    successMessage: 'Fraud reported. A CardTrade operator will review it.',
    variant: 'destructive',
    confirm: {
      title: 'Report fraud?',
      description:
        'Use this for an empty box or a fake item. This freezes both deposits and sends the trade to a CardTrade operator, who decides the outcome. Reporting it does not by itself move any money, and the other trader will see what you have alleged.',
      confirmLabel: 'Report fraud',
    },
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
    case 'RAISE_DISPUTE':
      return raiseDispute(tradeId);
    case 'REPORT_FRAUD':
      return reportFraud(tradeId);
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

  function invoke(action: BarAction, shipment?: ShipmentInput) {
    const config = ACTION_CONFIG[action];
    startTransition(async () => {
      const result = await runAction(action, tradeId, shipment);
      if (result.ok) {
        toast.success(config.successMessage);
        setShipOpen(false);
      } else {
        toast.error(errorMessage(result));
      }
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
      <div className="flex flex-wrap gap-3" role="group" aria-label="Trade actions">
        {actions.map((action) => {
          const config = ACTION_CONFIG[action];
          return (
            <Button
              key={action}
              variant={config.variant}
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
                ? 'Use this if the other trader did not show up, refused to hand over, or the exchange went wrong. The trade freezes for review and NOTHING is charged to either of you — a CardTrade operator decides what happens next.'
                : 'Use this if the parcel has not arrived or arrived empty. The trade freezes for review and NOTHING is charged to either of you — a lost parcel is nobody’s fault, so no deposit is taken while an operator looks at it.'
            }
            successMessage="Reported. The trade is frozen and an operator will review it."
            reasonPlaceholder={
              handoverMethod === 'IN_PERSON'
                ? 'e.g. they did not turn up at the agreed time and have not replied…'
                : 'e.g. tracking says delivered but nothing arrived; the box was empty…'
            }
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

      <Dialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <DialogContent>
          {confirmConfig?.confirm ? (
            <>
              <DialogHeader>
                <DialogTitle>{confirmConfig.confirm.title}</DialogTitle>
                <DialogDescription>
                  {confirmConfig.confirm.description}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setPendingConfirm(null)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant={confirmConfig.variant}
                  onClick={() => {
                    const action = pendingConfirm;
                    setPendingConfirm(null);
                    if (action) invoke(action);
                  }}
                  disabled={isPending}
                  aria-busy={isPending}
                >
                  {confirmConfig.confirm.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
