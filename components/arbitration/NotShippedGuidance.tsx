// components/arbitration/NotShippedGuidance.tsx
//
// The Decision card for a "Not shipped" case (0132): a posted sale whose ship-by date
// passed with nothing recorded, so the buyer's payment is still held.
//
// NO OUTCOME BUTTONS, deliberately. There is nothing to decide on the merits yet. The
// sale is not disputed, so every refund or release would be refused by
// `resolveCashSaleDispute`, and offering them is how this card came to show three
// buttons that each failed after a confirmation saying they moved real money. What
// staff can do is follow up, so the card says what happens next. A staff action that
// cancels and refunds an unposted sale would be a new way to move money, and is not
// here.
//
// Presentational and hook-free, so it renders on the server with the rest of the page.

import { formatContractDateTime } from '@/lib/format';

export interface NotShippedGuidanceProps {
  /** The ship-by date the seller missed. Null on a sale that never had one. */
  shipByAt: string | null;
  /** When the hourly sweep flagged the sale. */
  shipLapsedAt: string | null;
  /**
   * Whether the record shows the buyer has the goods, from `returnRequiredForRefund`,
   * the rule the refund path applies. False on any sale still waiting to be posted,
   * which is what makes a full refund immediate once the buyer reports a problem. Read
   * rather than assumed, so the card never promises an outcome the refund would not take.
   */
  buyerHasGoods: boolean;
}

export function NotShippedGuidance({
  shipByAt,
  shipLapsedAt,
  buyerHasGoods,
}: NotShippedGuidanceProps) {
  return (
    <div className="space-y-cozy text-body">
      <p className="font-medium">Nothing to decide yet</p>
      <p className="text-meta text-muted-foreground">
        The seller has not posted by the ship-by date, and the buyer&apos;s payment is
        still held.
      </p>
      <dl className="grid gap-tight text-meta text-muted-foreground">
        <div>
          <dt className="inline font-medium text-foreground">Ship by: </dt>
          <dd className="inline">{formatContractDateTime(shipByAt) ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Flagged: </dt>
          <dd className="inline">{formatContractDateTime(shipLapsedAt) ?? 'Not recorded'}</dd>
        </div>
      </dl>
      <div className="space-y-snug text-meta text-muted-foreground">
        <p>Nothing has been cancelled or refunded, and nothing happens automatically.</p>
        <p>
          The parcel may be in the post without tracking. Check in with the seller and
          keep a record in the staff notes.
        </p>
        <p>When the seller adds tracking, the sale moves on and this case closes by itself.</p>
        <p>
          The buyer can report a problem from their contract room. That turns this into a
          dispute you can resolve here
          {buyerHasGoods
            ? '.'
            : ', and because no delivery is recorded, a full refund goes straight back to the buyer.'}
        </p>
      </div>
    </div>
  );
}
