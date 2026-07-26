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
//   RECORD_SHIPMENT   -> recordShipment
//   RECORD_RECEIPT    -> recordReceipt
//   RECORD_ACCEPTANCE -> recordAcceptance
//   RAISE_DISPUTE     -> raiseDispute
//   REPORT_FRAUD      -> reportFraud
//
// The two irreversible escalations (dispute, fraud) require an explicit
// confirmation dialog. Typed action errors returned by the server actions are
// surfaced as toasts; on success the live realtime subscription updates the
// view, so no manual refetch is needed.

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
import { availableActions } from '@/domain/state-machine/actions';
import type {
  TradeAction,
  TradeState,
  TradeViewerContext,
} from '@/domain/state-machine/types';
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
  /** The server action invoked with the trade id. */
  run: (tradeId: string) => Promise<ActionResult>;
  /** Irreversible actions require an explicit confirmation dialog. */
  confirm?: { title: string; description: string; confirmLabel: string };
}

const ACTION_CONFIG: Record<TradeAction, ActionConfig> = {
  RECORD_SHIPMENT: {
    label: 'Record shipment',
    successMessage: 'Shipment recorded.',
    variant: 'default',
    run: recordShipment,
  },
  RECORD_RECEIPT: {
    label: 'Record receipt',
    successMessage: 'Receipt recorded.',
    variant: 'default',
    run: recordReceipt,
  },
  RECORD_ACCEPTANCE: {
    label: 'Accept item',
    successMessage: 'Acceptance recorded.',
    variant: 'default',
    run: recordAcceptance,
  },
  RAISE_DISPUTE: {
    label: 'Raise dispute',
    successMessage: 'Condition dispute raised.',
    variant: 'outline',
    run: raiseDispute,
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
    run: reportFraud,
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

export interface ActionBarProps {
  tradeId: string;
  state: TradeState;
  viewer: TradeViewerContext;
}

/**
 * State-dependent trade controls (Req 11.3, 11.4). Renders one button per
 * permitted action and nothing at all when `availableActions` is empty.
 */
export function ActionBar({ tradeId, state, viewer }: ActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingConfirm, setPendingConfirm] = useState<TradeAction | null>(null);

  const actions = availableActions(state, viewer);

  // No permitted actions -> render nothing (Req 11.4).
  if (actions.length === 0) {
    return null;
  }

  function invoke(action: TradeAction) {
    const config = ACTION_CONFIG[action];
    startTransition(async () => {
      const result = await config.run(tradeId);
      if (result.ok) {
        toast.success(config.successMessage);
      } else {
        toast.error(errorMessage(result));
      }
    });
  }

  function handleClick(action: TradeAction) {
    const config = ACTION_CONFIG[action];
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
      </div>

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
