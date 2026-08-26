// TEMPORARY verification route. Delete after the 390px pass.
//
// The real contract rooms are auth-gated and the seed users do not exist on the
// hosted project this dev server points at, so this mounts the actual room
// shell — ContractLiveRow, ContractConversationPanel, ContractDetailList — with
// a null conversation id, which is the state the panel already renders while a
// thread is opening. Everything changed in this pass is exercised: the thread
// bar, the back control, the tappable subject, the actions slot, and the sheet.

import { Button } from '@/components/ui/button';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  ContractDetailList,
  ContractDetailRow,
  ContractFocusProvider,
  ContractLiveRow,
} from '@/components/contract';
import { ContractConversationPanel } from '@/components/contract/ContractConversationPanel';

export const dynamic = 'force-dynamic';

export default function RoomCheckPage() {
  return (
    <MarketplaceShell title="Purchase" flush>
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
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="action" size="sm">
                      Confirm delivery
                    </Button>
                  </div>
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
    </MarketplaceShell>
  );
}
