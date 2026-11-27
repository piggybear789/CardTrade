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

import { Icon } from '@/components/ui/icon';
import { WarningIcon } from '@/components/ui/icons';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  HandoverFailedDialog,
  RecordShipmentDialog,
  type ShipmentInput,
} from '@/components/fulfilment';
import { AcceptWithPhotoDialog } from '@/components/contract/AcceptWithPhotoDialog';
import { PendingLabel } from '@/components/ui/pending-label';
import { availableActions } from '@/domain/state-machine/actions';
import type {
  TradeAction,
  TradeState,
  TradeViewerContext,
} from '@/domain/state-machine/types';
import type { FulfilmentMethod } from '@/domain/fulfilment';
import { TRADE_INSPECTION_HOURS } from '@/domain/fulfilment/inspection';
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
import { CARD_LIMIT_SENTENCE, HOLD_DECLINED_MESSAGE } from '@/lib/handover/terms';
import {
  SavedCardRow,
  type SavedCardStatus,
} from '@/components/payments/SavedCardRow';

/** A minimal shape common to every trade action result. */
type ActionResult = { ok: boolean; error?: string; detail?: string };

/** Static descriptor for how each action renders and behaves. */
interface ActionConfig {
  label: string;
  /** Toast shown on success. */
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
    variant: 'action',
  },
  CONFIRM_HANDOVER: {
    label: 'Confirm handover',
    variant: 'action',
    // Worth a confirmation step, but note what it does and does not say. Confirming
    // means "we met and swapped", and the trade moves to INSPECTION — it does NOT
    // release the collateral, which is what accepting the item does afterwards.
    // A trader who has just been robbed or handed a fake must not sign the trade off
    // at the meeting point, which is why this does not complete the trade.
    confirm: {
      title: 'Confirm the handover happened?',
      description:
        'Only confirm once you have met and swapped. Both holds stay in place, and you have ' + TRADE_INSPECTION_HOURS / 24 + ' days from the meeting to check what you got.',
      confirmLabel: 'We met and swapped',
      helpHref: '/help#holds',
    },
  },
  RECORD_RECEIPT: {
    label: 'Record receipt',
    variant: 'action',
    confirm: {
      title: 'Confirm you received the item?',
      description: 'This starts your inspection window.',
      confirmLabel: 'Record receipt',
      helpHref: '/help#holds',
    },
  },
  RECORD_ACCEPTANCE: {
    label: 'Accept item',
    variant: 'action',
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
    variant: 'secondary',
  },
  REPORT_FRAUD: {
    label: 'Report fraud',
    variant: 'destructive-quiet',
  },
  RETRY_COLLATERAL: {
    label: 'Retry hold',
    variant: 'action',
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
    'The other trader updated this trade. Please try again.',
  TRADE_NOT_FOUND: 'This trade could not be found.',
  HOLD_NOT_FOUND: 'A collateral hold for this trade could not be found.',
  // Shared with the negotiation panel's toasts (design §1.12).
  'bond-failed': HOLD_DECLINED_MESSAGE,
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

/** The escalations behind the Problem button, in menu order. */
type ProblemKind = 'HANDOVER_FAILED' | 'RAISE_DISPUTE' | 'REPORT_FRAUD';

/** Menu row copy: what it is, and when it fits, so the reader can pick. */
function problemRow(kind: ProblemKind, inPerson: boolean): { label: string; hint: string } {
  switch (kind) {
    case 'HANDOVER_FAILED':
      return inPerson
        ? { label: 'Handover failed', hint: 'They did not show, or the swap went wrong' }
        : { label: 'Item never arrived', hint: 'The parcel is lost or came empty' };
    case 'RAISE_DISPUTE':
      return { label: 'Raise dispute', hint: 'Not in the condition agreed' };
    case 'REPORT_FRAUD':
      return { label: 'Report fraud', hint: 'Fake, or an empty box' };
  }
}

/**
 * "Problem", a soft red button that opens the escalations. It only CHOOSES one;
 * each claim's dialog lives outside the popover so closing the menu cannot take
 * a just-opened dialog with it.
 */
function ProblemMenu({
  problems,
  inPerson,
  disabled,
  onChoose,
}: {
  problems: readonly ProblemKind[];
  inPerson: boolean;
  disabled?: boolean;
  onChoose: (kind: ProblemKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="destructive-soft"
          disabled={disabled}
        >
          <Icon icon={WarningIcon} aria-hidden />
          Problem
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-tight">
        <p className="px-2.5 pb-tight pt-snug text-meta font-medium text-muted-foreground">
          What went wrong?
        </p>
        <ul className="flex flex-col">
          {problems.map((kind) => {
            const row = problemRow(kind, inPerson);
            return (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChoose(kind);
                  }}
                  className={cn(
                    'flex w-full flex-col items-start rounded-md px-2.5 py-snug text-left transition-colors',
                    'hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                >
                  <span
                    className={cn(
                      'text-body font-medium',
                      kind === 'REPORT_FRAUD' ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {row.label}
                  </span>
                  <span className="text-meta text-muted-foreground">{row.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
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
  /** Server-known saved card, so the retry branch's card row paints complete. */
  paymentMethod?: SavedCardStatus | null;
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
  paymentMethod = null,
}: ActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingConfirm, setPendingConfirm] = useState<BarAction | null>(null);
  const [shipOpen, setShipOpen] = useState(false);

  const [problemOpen, setProblemOpen] = useState<ProblemKind | null>(null);

  const permitted = availableActions(state, viewer);
  // THE ESCALATIONS SHARE ONE "PROBLEM" BUTTON (UX review 2026-11-27). Accept,
  // Raise dispute and Report fraud side by side were three equal choices for what
  // is one happy path and a rare exit. The exits stay one tap away, behind a red
  // button that says what they are for, and the menu says which one fits.
  const actions = permitted
    .filter(isBarAction)
    .filter((action) => action !== 'RAISE_DISPUTE' && action !== 'REPORT_FRAUD');
  const problems: ProblemKind[] = [
    ...(permitted.includes('REPORT_HANDOVER_FAILED') ? (['HANDOVER_FAILED'] as const) : []),
    ...(permitted.includes('RAISE_DISPUTE') ? (['RAISE_DISPUTE'] as const) : []),
    ...(permitted.includes('REPORT_FRAUD') ? (['REPORT_FRAUD'] as const) : []),
  ];

  if (actions.length === 0 && problems.length === 0) {
    return null;
  }

  const inPerson = handoverMethod === 'IN_PERSON';

  function invoke(action: BarAction, shipment?: ShipmentInput): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await runAction(action, tradeId, shipment);
        if (result.ok) {
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
      {/* WRAP, DO NOT STACK. This was `flex-col` until `sm` (640px), so on every
          phone both controls went full width on their own rows — two 44px bars
          plus a gap, inside a dock that is already permanently docked over the
          conversation. The action labels are all short ("Record shipment",
          "Item never arrived" are the longest at roughly 180px), so two of them
          sit side by side inside a 390px viewport with room to spare, and
          `flex-wrap` drops the second to its own line at its NATURAL width if a
          future label is longer. Nothing here can overflow: a button at its
          natural width is about half the container. */}
      <div className="flex w-full flex-wrap gap-snug sm:gap-cozy" role="group" aria-label="Trade actions">
        {problems.length > 0 ? (
          <ProblemMenu
            problems={problems}
            inPerson={inPerson}
            disabled={isPending}
            onChoose={setProblemOpen}
          />
        ) : null}
        {actions.map((action) => {
          const config = ACTION_CONFIG[action];

          if (action === 'RETRY_COLLATERAL') {
            return (
              <div key={action} className="flex w-full min-w-0 flex-col gap-snug">
                <p className="text-body text-muted-foreground">
                  A card declined the hold, so the trade is paused. Nothing was
                  charged. {CARD_LIMIT_SENTENCE}
                </p>
                <SavedCardRow
                  initialStatus={paymentMethod}
                  className="w-full sm:max-w-sm"
                />
                <Button
                  variant="action"
                  className="w-full sm:w-auto"
                  onClick={() => invoke(action)}
                  disabled={isPending}
                  aria-busy={isPending}
                >
                  <PendingLabel pending={isPending} pendingLabel="Retrying…" spinner={false}>
                    Retry hold
                  </PendingLabel>
                </Button>
              </div>
            );
          }

          if (action === 'RECORD_ACCEPTANCE') {
            return (
              <AcceptWithPhotoDialog
                key={action}
                onAccept={async () => {
                  const result = await recordAcceptance(tradeId);
                  if (!result.ok) toast.error(errorMessage(result));
                  return result;
                }}
                evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
                triggerLabel="Accept item"
                title="Accept what you received"
                description="We recommend photographing or filming the item as you received it. This becomes your baseline evidence if a dispute arises later."
              />
            );
          }

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

      {/* The claim dialogs, opened from the Problem menu. Each collects the
          claimant's own account rather than a bare confirm (0083), because a
          dispute or a fraud claim must say what it is about. */}
      <HandoverFailedDialog
        hideTrigger
        open={problemOpen === 'HANDOVER_FAILED'}
        onOpenChange={(open) => setProblemOpen(open ? 'HANDOVER_FAILED' : null)}
        title={inPerson ? 'Report a failed handover' : 'Report an item that never arrived'}
        outcomeDescription={
          inPerson
            ? 'Use this if the other trader didn’t show up or the swap went wrong. The trade freezes, nobody is charged, and NoDitto support decides what happens next.'
            : 'Use this if the parcel hasn’t arrived or arrived empty. The trade freezes and nobody is charged while support looks into it.'
        }
        reasonPlaceholder={
          inPerson
            ? 'e.g. they did not turn up at the agreed time and have not replied…'
            : 'e.g. tracking says delivered but nothing arrived; the box was empty…'
        }
        evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
        onSubmit={async (reason) => {
          const result = await reportTradeHandoverFailed(tradeId, reason);
          return result.ok ? { ok: true } : { ok: false, message: errorMessage(result) };
        }}
      />
      <HandoverFailedDialog
        hideTrigger
        open={problemOpen === 'RAISE_DISPUTE'}
        onOpenChange={(open) => setProblemOpen(open ? 'RAISE_DISPUTE' : null)}
        title="Raise a condition dispute"
        // NOTHING IS TAKEN AT RAISE (ESC-01). This used to promise $20.00 from the
        // other trader, which stopped being true when capture moved to the decision.
        outcomeDescription="Use this when the item is not in the condition that was agreed. Both trade collateral holds stay in place while NoDitto support reviews it. Nothing is charged when you raise it; support decides any compensation from what you write here."
        reasonPlaceholder="e.g. Listed NM, arrived creased"
        evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
        onSubmit={async (reason) => {
          const result = await raiseDispute(tradeId, reason);
          return result.ok ? { ok: true } : { ok: false, message: errorMessage(result) };
        }}
      />
      <HandoverFailedDialog
        hideTrigger
        open={problemOpen === 'REPORT_FRAUD'}
        onOpenChange={(open) => setProblemOpen(open ? 'REPORT_FRAUD' : null)}
        title="Report fraud"
        outcomeDescription="Use this for an empty box or a counterfeit item. This freezes both deposits and sends the trade to NoDitto support, who decides the outcome. Reporting it does not by itself move any money, and the other trader will see what you have alleged."
        reasonPlaceholder="e.g. Fails the light test"
        evidenceContext={{ caseKind: 'TRADE', caseRef: tradeId }}
        onSubmit={async (reason) => {
          const result = await reportFraud(tradeId, reason);
          return result.ok ? { ok: true } : { ok: false, message: errorMessage(result) };
        }}
      />

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
