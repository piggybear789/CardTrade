'use client';

// TEMPORARY verification route. Delete after the 390px pass.
//
// The real contract rooms are auth-gated and the seed users do not exist on the
// hosted project this dev server points at, so this mounts the actual room
// shell — ContractLiveRow, ContractConversationPanel, ContractDetailList — with
// a null conversation id, the state the panel already renders while a thread is
// opening. Everything changed in this pass is exercised: the thread bar, the
// back control, the tappable subject, the actions slot, and the details sheet.
//
// Client, not server: `ContractDetailList` matches rows by exact identity, and
// a Server Component importing `ContractDetailRow` hands over a client
// reference proxy instead, so every row is silently dropped. Both real rooms
// are 'use client', so this mirrors them. MarketplaceShell is an async Server
// Component and cannot be rendered here, so its flush geometry is inlined.

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { Button } from '@/components/ui/button';
import {
  ContractDetailList,
  ContractDetailRow,
  ContractFocusProvider,
  ContractLiveRow,
} from '@/components/contract';
import { ContractConversationPanel } from '@/components/contract/ContractConversationPanel';

function Room() {
  const params = useSearchParams();
  const shortAction = params.get('short') === '1';

  return (
    <ContractFocusProvider>
      <div className="flex min-h-0 flex-1 flex-col gap-group lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
        <ContractLiveRow
          detailsTitle="Vaporeon · 2000 Team Rocket 1st Edition"
          detailsMeta={<span className="display-value">$232.50 total</span>}
          conversation={
            <ContractConversationPanel
              conversationId={null}
              currentUserId="viewer"
              counterpartyName="test"
              backHref="/purchases"
              statusLabel="In transit"
              subject={{
                title: 'Vaporeon · 2000 Team Rocket 1st Edition',
                thumb: null,
                price: '$232.50',
              }}
              actions={
                <Button type="button" variant="action" size="sm">
                  {shortAction ? 'Track' : 'Confirm delivery'}
                </Button>
              }
            />
          }
        >
          <ContractDetailList>
            <ContractDetailRow label="Item" id="contract-exchange" defaultOpen>
              <p>Item panel body</p>
            </ContractDetailRow>
            <ContractDetailRow
              label="Terms"
              id="contract-terms"
              action={
                <Button type="button" variant="outline" size="sm">
                  Edit
                </Button>
              }
            >
              <p>Terms panel body</p>
            </ContractDetailRow>
            <ContractDetailRow label="Payment" id="contract-payment">
              <p>Payment panel body</p>
            </ContractDetailRow>
            <ContractDetailRow label="Protection" id="contract-collateral">
              <p>Protection panel body</p>
            </ContractDetailRow>
            <ContractDetailRow label="History" id="contract-history">
              <p>History panel body</p>
            </ContractDetailRow>
          </ContractDetailList>
        </ContractLiveRow>
      </div>
    </ContractFocusProvider>
  );
}

export default function RoomCheckPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* MarketplaceShell `flush` geometry, copied so the measurements match. */}
      <section className="mx-auto flex min-h-0 w-full max-w-workspace flex-1 flex-col items-center overflow-hidden bg-background px-4 pb-4 pt-3 max-h-[calc(100dvh-env(safe-area-inset-top)-3.5rem-1px-env(safe-area-inset-bottom))] md:max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))] md:px-7 md:py-7">
        <div className="mx-auto flex min-h-0 w-full max-w-workspace flex-1 flex-col">
          <Suspense fallback={null}>
            <Room />
          </Suspense>
        </div>
      </section>
      {/* Stand-in for MobileBottomNav, which the details sheet docks above. */}
      <div className="fixed inset-x-0 bottom-0 h-14 border-t border-border bg-card md:hidden" />
    </div>
  );
}
