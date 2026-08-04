// components/contract/types.ts
//
// The shared vocabulary of a contract room. Cash_Sales, 2-way Trades and private
// Deals are three different state machines over the same UX: two parties, a
// status, agreed terms, money, collateral and an audit trail. These types are the
// flow-agnostic shapes the presentational primitives in this folder consume, so
// each room only has to map its own row/enum into them.
//
// Nothing here imports from `app/`, a realtime hook, or a server action — the
// primitives stay presentational and every flow-specific concern (state machine
// gating, action wiring, copy) stays in the room component.

import type { ReactNode } from 'react';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Realtime connection state, identical across `useCashSaleRealtime`,
 * `useTradeRealtime` and `useDealRealtime`.
 */
export type ContractConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error';

/** Badge treatment for a contract status label. */
export type ContractStatusTone = NonNullable<BadgeProps['variant']>;

/** One label/value row in a party card's reputation + stake summary. */
export interface ContractPartyStat {
  label: ReactNode;
  value: ReactNode;
  /**
   * Render the value in muted, non-tabular type — for "Not required" style
   * placeholders rather than figures.
   */
  muted?: boolean;
}

/**
 * A participant in a contract room, reduced to what every flow can supply.
 *
 * Reputation only: a party card never carries merchant or compliance detail.
 * `legalEntityName` is the one exception — a provider-approved legal identity
 * snapshot, which only a Cash_Sale seller currently has.
 */
export interface ContractParty {
  /** Display name, already defaulted by the caller (never blank). */
  name: string;
  /** Short side label — "Buyer", "Seller", "Trader". Omit when a flow has none. */
  roleLabel?: string | null;
  /** KYC identity verification state. */
  verified: boolean;
  /** Average review score out of 5, or `null` when never reviewed. */
  rating: number | null;
  ratingCount: number;
  /** Flow-specific figures: completed sales, collateral, and so on. */
  stats?: ContractPartyStat[];
  /** Provider-approved legal identity, when the flow snapshots one. */
  legalEntityName?: string | null;
  registrationNumber?: string | null;
}

/**
 * Whether a party has agreed to the current version of the terms. Cash sales
 * call this "accepted terms vN", deals call it "confirmed" — same signal.
 */
export interface ContractConsent {
  agreed: boolean;
  /** Line shown once they have agreed, e.g. `Accepted terms v3`. */
  agreedLabel: string;
  /** Line shown while they have not, e.g. `Has not accepted the current terms`. */
  pendingLabel: string;
}

/** One row of a contract's money or terms breakdown. */
export interface ContractMoneyRow {
  label: ReactNode;
  value: ReactNode;
  /** The bottom-line total: rendered bolder and larger. */
  total?: boolean;
  /** Render the value muted instead of as a figure (e.g. "Not required"). */
  muted?: boolean;
  /** Second line under the label — the detail behind the figure. */
  hint?: ReactNode;
  /**
   * Row-level control, e.g. the dialog trigger that edits this term. Lets the
   * compact one-page layout put editing next to the value it changes instead of
   * giving every term its own section.
   */
  action?: ReactNode;
}

/**
 * A collateral / pre-authorization hold, labelled relative to the viewer by the
 * room that owns it. `Pre_Auth_Hold` (trades) and `deal_holds` rows both reduce
 * to this.
 */
export interface ContractHold {
  id: string;
  /** e.g. "Your collateral" / "Ada's collateral". */
  label: string;
  amountCents: number;
  capturedCents?: number;
  status: ContractHoldStatus;
}

/** The `hold_status` enum values, shared by trade and deal holds. */
export type ContractHoldStatus =
  | 'ACTIVE'
  | 'VOIDED'
  | 'PARTIALLY_CAPTURED'
  | 'FULLY_CAPTURED'
  | 'FAILED'
  /**
   * The provider's authorisation lapsed and it released the collateral itself.
   * Shown distinctly from VOIDED: a release is escrow working, an expiry means
   * the protection is GONE and the parties need to know before handing anything
   * over.
   */
  | 'EXPIRED';

/** One entry in a contract's audit trail. */
export interface ContractEvent {
  id: string;
  /** The raw enum name; the timeline humanises it. */
  event: string;
  detail?: string | null;
  created_at: string;
  /** Marked "(you)" when it matches the viewer. */
  actor_id?: string | null;
}
