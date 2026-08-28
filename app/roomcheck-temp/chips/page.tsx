'use client';

// TEMPORARY verification route. Delete after the chip-consistency check.

import { Badge } from '@/components/ui/badge';
import { ContractExchangePanel } from '@/components/contract';
import { DeliveryAddressPanel } from '@/components/fulfilment';

const party = { name: 'Test', verified: true, rating: null, ratingCount: 0 } as never;

export default function ChipsCheck() {
  return (
    <div className="min-h-dvh space-y-7 bg-background p-7">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-group">
        <span className="text-body text-muted-foreground">Reference:</span>
        <Badge>Collateral locked</Badge>
        <Badge variant="secondary">You receive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>

      <div className="rounded-lg border bg-card p-group">
        <ContractExchangePanel
          sides={[
            {
              heading: 'You send',
              partyName: 'Test',
              party,
              isMine: true,
              items: [{ id: '1', title: 'Pikachu · 2016 Evolutions', valueCents: 15900 }],
              feeCents: 825,
              feeLabel: 'NoDitto fee (5%)',
            },
            {
              heading: 'You receive',
              partyName: 'test',
              party,
              items: [{ id: '2', title: 'Vaporeon · 2016 XY', valueCents: 14500 }],
              cashCents: 2000,
              cashLabel: 'Cash they pay via Stripe',
              feeCents: 795,
              feeLabel: 'NoDitto fee (5%)',
            },
          ]}
        />
      </div>

      <div className="max-w-xl rounded-lg border bg-card p-group">
        <DeliveryAddressPanel
          mine={null}
          theirs={null}
          theirsPending="Shared once collateral is locked on both sides."
          counterpartName="test"
          editable
          onSave={async () => ({ ok: true as const })}
        />
      </div>
    </div>
  );
}
