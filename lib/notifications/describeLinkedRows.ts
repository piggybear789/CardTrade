import 'server-only';

// lib/notifications/describeLinkedRows.ts
//
// The pure half of the notification list's contract reads. Given what those reads
// returned, each row that links to a sale or trade gets three things the table cannot
// tell it: whether the contract still opens, what it is about (where the producer named
// nothing), and what it is waiting on now for the person reading it.
//
// The reads, and why they cost no extra round trip, are `resolveContractLinks` in
// `lib/actions/notifications.ts`. Split out so the mapping is tested against fixtures
// rather than a database (`tests/unit/notificationLinkedContract.test.ts`).

import { currentStep, type ContractStep } from '@/domain/contract';
import type { HoldRowLike } from '@/domain/state-machine/holdLegs';
import type { TradeRow } from '@/lib/actions/tradeLifecycleStore';
import {
  parseContractLink,
  subjectFields,
  type ContractMove,
  type ContractSubject,
  type SubjectFields,
} from '@/lib/notifications/linkedContract';
import {
  CASH_SALE_STEP_COLUMNS,
  cashSaleStepsForRow,
  type CashSaleStepRow,
} from '@/lib/sales/cashSaleStepsForRow';
import { tradeStepsForRow } from '@/lib/trades/tradeStepsForRow';

/** One PostgREST to-one embed. An object in practice; the hand-kept types cannot say so. */
type Embedded<T> = T | T[] | null;

function one<T>(embed: Embedded<T> | undefined): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
}

type EmbeddedName = Embedded<{ display_name: string | null }>;

// `public_profiles`, never `profiles`: a member may read only their own profile row, and
// the view is the public display name every other surface shows (closed accounts masked).
// Items through the member's own RLS, which lets a party read the cards on their trades
// (0071) and on their live sales (0096); a sale's title and cover are its own snapshot.

/** The sale read: frozen title and cover, both parties, and what its plan reads. */
export const SALE_CONTRACT_SELECT = [
  'id',
  'item_title',
  'item_image_paths',
  ...CASH_SALE_STEP_COLUMNS,
  'buyer_profile:public_profiles!cash_sales_buyer_id_fkey(display_name)',
  'seller_profile:public_profiles!cash_sales_seller_id_fkey(display_name)',
].join(', ');

/**
 * The trade read: the WHOLE row, as the Trades list reads it, because `factsFromTrade`
 * maps the entire row onto the facts its plan needs and a partial column list would be a
 * silently wrong plan rather than a type error. Plus the listing the trade was opened on
 * and both parties.
 */
export const TRADE_CONTRACT_SELECT = [
  '*',
  'subject_item:items!trades_counterpart_item_id_fkey(title, image_paths)',
  'initiator_profile:public_profiles!trades_initiator_id_fkey(display_name)',
  'counterpart_profile:public_profiles!trades_counterpart_id_fkey(display_name)',
].join(', ');

/** The holds a trade's plan needs for its collateral and release steps. */
export const TRADE_HOLDS_SELECT = 'trade_id, trader_id, status, created_at';

/** A sale as {@link SALE_CONTRACT_SELECT} returns it. */
export interface SaleContractRow extends CashSaleStepRow {
  id: string;
  item_title: string | null;
  item_image_paths: string[] | null;
  buyer_profile: EmbeddedName;
  seller_profile: EmbeddedName;
}

/** A trade as {@link TRADE_CONTRACT_SELECT} returns it. */
export type TradeContractRow = TradeRow & {
  subject_item: Embedded<{ title: string | null; image_paths: string[] | null }>;
  initiator_profile: EmbeddedName;
  counterpart_profile: EmbeddedName;
};

/** A hold as {@link TRADE_HOLDS_SELECT} returns it. */
export type TradeHoldRow = HoldRowLike & { trade_id: string };

/** What the reads returned. A read that failed is `null`, and decides nothing. */
export interface LinkedContractReads {
  /** Linked sales and trades the reader can still open; `null` when an id read failed. */
  liveIds: ReadonlySet<string> | null;
  sales: readonly SaleContractRow[] | null;
  trades: readonly TradeContractRow[] | null;
  /** `null` leaves every trade's move unknown: a plan without its holds misstates them. */
  holds: readonly TradeHoldRow[] | null;
}

/** The row fields this reads and fills. */
export type DescribableRow = { user_id: string; link: string | null } & SubjectFields & {
    target_missing?: boolean;
    contract_move?: ContractMove | null;
  };

/** The step copy's name for a counterparty whose profile cannot be read (as the lists). */
const UNKNOWN_COUNTERPARTY = 'the other party';

function displayName(embed: EmbeddedName): string | null {
  return one(embed)?.display_name?.trim() || null;
}

/** The live step of a plan as a move, or `null` once nothing is outstanding. */
function moveFrom(steps: ContractStep[]): ContractMove | null {
  const step = currentStep(steps);
  return step ? { owner: step.owner, label: step.label } : null;
}

/** One linked contract: what it is about, and what it is waiting on for a given reader. */
interface LinkedContract {
  subject: ContractSubject;
  moveFor(viewerId: string): ContractMove | null;
}

function saleContract(sale: SaleContractRow): LinkedContract {
  const names = new Map([
    [sale.buyer_id, displayName(sale.buyer_profile)],
    [sale.seller_id, displayName(sale.seller_profile)],
  ]);
  return {
    subject: {
      title: sale.item_title,
      imagePath: sale.item_image_paths?.[0] ?? null,
      participants: names,
    },
    // `cashSaleStepsForRow` refuses a reader who is not a party.
    moveFor: (viewerId) =>
      moveFrom(
        cashSaleStepsForRow(
          sale,
          viewerId,
          names.get(viewerId === sale.buyer_id ? sale.seller_id : sale.buyer_id) ??
            UNKNOWN_COUNTERPARTY,
        ),
      ),
  };
}

function tradeContract(trade: TradeContractRow, holds: readonly TradeHoldRow[] | null): LinkedContract {
  const item = one(trade.subject_item);
  const names = new Map([
    [trade.initiator_id, displayName(trade.initiator_profile)],
    [trade.counterpart_id, displayName(trade.counterpart_profile)],
  ]);
  return {
    subject: {
      title: item?.title ?? null,
      imagePath: item?.image_paths?.[0] ?? null,
      participants: names,
    },
    moveFor: (viewerId) => {
      if (holds === null) return null;
      if (viewerId !== trade.initiator_id && viewerId !== trade.counterpart_id) return null;
      return moveFrom(
        tradeStepsForRow(
          trade,
          holds.filter((hold) => hold.trade_id.toLowerCase() === trade.id.toLowerCase()),
          viewerId,
          names.get(viewerId === trade.initiator_id ? trade.counterpart_id : trade.initiator_id) ??
            UNKNOWN_COUNTERPARTY,
        ),
      );
    },
  };
}

/**
 * Each contract-linked row with its "gone" verdict, its subject where it named none, and
 * the contract's live move for its reader. Rows that link elsewhere come back untouched.
 */
export function describeLinkedRows<T extends DescribableRow>(
  rows: readonly T[],
  reads: LinkedContractReads,
): T[] {
  const contracts = new Map<string, LinkedContract>();
  for (const sale of reads.sales ?? []) contracts.set(sale.id.toLowerCase(), saleContract(sale));
  for (const trade of reads.trades ?? []) {
    contracts.set(trade.id.toLowerCase(), tradeContract(trade, reads.holds));
  }

  return rows.map((row) => {
    const link = parseContractLink(row.link);
    if (!link) return row;
    const contract = contracts.get(link.id);
    return {
      ...row,
      // A failed read decides nothing: better a link that might 404 than a live
      // contract reported as gone.
      ...(reads.liveIds ? { target_missing: !reads.liveIds.has(link.id) } : {}),
      ...subjectFields(row, contract?.subject),
      contract_move: contract ? contract.moveFor(row.user_id) : null,
    };
  });
}
