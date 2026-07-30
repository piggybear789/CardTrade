'use client';

// components/trade/ActionBar.tsx
//
// Renders exactly the controls the state machine permits for the current
// Trade_State + viewer, and NONE when no action is allowed (Req 11.3, 11.4).
// The set of controls is derived solely from `availableActions(state, viewer)`
// so transition/permission rules are never hard-coded here.
//
// Each control is wired to its corresponding trade server action (Req 6.1/6.3/
// 6.5, 7.1, 8.1):
//   RECORD_SHIPMENT   -> recordShipment (carrier + tracking when Delivery)
//   RECORD_RECEIPT    -> recordReceipt
//   RECORD_ACCEPTANCE -> recordAcceptance
//   RAISE_DISPUTE     -> raiseDispute
//   REPORT_FRAUD      -> reportFraud

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { availableActions } from '@/domain/state-machine/actions';
import type {
  TradeAction,
  TradeState,
  TradeViewerContext,
} from '@/domain/state-machine/types';
import type { HandoverMethod } from '@/lib/handover/terms';
import {
  raiseDispute,
  recordAcceptance,
  recordReceipt,
  recordShipment,
  reportFraud,
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

const ACTION_CONFIG: Record<TradeAction, ActionConfig> = {
  RECORD_SHIPMENT: {
    label: 'Record shipment',
    successMessage: 'Shipment recorded.',
    variant: 'default',
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
  RAISE_DISPUTE: {
    label: 'Raise dispute',
    successMessage: 'Condition dispute raised.',
    variant: 'outline',
    confirm: {
      title: 'Raise a condition dispute?',
      description:
        'Use this when the item is not in the condition described. We take $20.00 from the other trader towards return postage. You cannot undo this.',
      confirmLabel: 'Raise dispute',
    },
  },
  REPORT_FRAUD: {
    label: 'Report fraud',
    successMessage: 'Fraud reported.',
    variant: 'destructive',
    confirm: {
      title: 'Report fraud?',
      description:
        'Use this for an empty box or a fake item. We take the other trader\u2019s full deposit and pay it to you. You cannot undo this.',
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
  action: TradeAction,
  tradeId: string,
  shipment?: { carrier: string; trackingNumber: string },
): Promise<ActionResult> {
  switch (action) {
    case 'RECORD_SHIPMENT':
      return recordShipment(tradeId, shipment);
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
  /** When Delivery, recording shipment requires carrier + tracking. */
  handoverMethod?: HandoverMethod | null;
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
}: ActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingConfirm, setPendingConfirm] = useState<TradeAction | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const actions = availableActions(state, viewer);
  const deliveryShip = handoverMethod === 'DELIVERY';

  if (actions.length === 0) {
    return null;
  }

  function invoke(
    action: TradeAction,
    shipment?: { carrier: string; trackingNumber: string },
  ) {
    const config = ACTION_CONFIG[action];
    startTransition(async () => {
      const result = await runAction(action, tradeId, shipment);
      if (result.ok) {
        toast.success(config.successMessage);
        setShipOpen(false);
        setCarrier('');
        setTrackingNumber('');
      } else {
        toast.error(errorMessage(result));
      }
    });
  }

  function handleClick(action: TradeAction) {
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
  const canSubmitShip =
    !deliveryShip ||
    (carrier.trim() !== '' && trackingNumber.trim().length >= 2);

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
      </div>

      <Dialog
        open={shipOpen}
        onOpenChange={(open) => {
          if (!open) setShipOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record shipment</DialogTitle>
            <DialogDescription>
              {deliveryShip
                ? 'Add the carrier and tracking number for what you are sending.'
                : 'Confirm you have handed over your goods. Tracking is optional for face-to-face swaps.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="trade-ship-carrier">
                Carrier
                {deliveryShip ? (
                  <span className="text-destructive" aria-hidden>
                    {' '}
                    *
                  </span>
                ) : null}
              </Label>
              <Input
                id="trade-ship-carrier"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="e.g. Australia Post"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trade-ship-tracking">
                Tracking number
                {deliveryShip ? (
                  <span className="text-destructive" aria-hidden>
                    {' '}
                    *
                  </span>
                ) : null}
              </Label>
              <Input
                id="trade-ship-tracking"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Tracking number"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShipOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={isPending || !canSubmitShip}
              aria-busy={isPending}
              onClick={() =>
                invoke('RECORD_SHIPMENT', {
                  carrier: carrier.trim(),
                  trackingNumber: trackingNumber.trim(),
                })
              }
            >
              {isPending ? 'Saving…' : 'Record shipment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
