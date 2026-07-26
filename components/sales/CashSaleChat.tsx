'use client';

// components/sales/CashSaleChat.tsx
// The cash sale room's chat panel (Req 4.2). The behaviour lives in the shared
// <ContractChat/>, which the private deal room renders too; this keeps the
// sale-specific copy in one place.

import { ContractChat } from '@/components/messages/ContractChat';

export interface CashSaleChatProps {
  conversationId: string;
  currentUserId: string;
  counterpartyName: string;
  /** Link to the full `/messages/[id]` thread for this sale's conversation. */
  contractHref?: string;
}

/** Chat panel sized for the center column of a sale room. */
export function CashSaleChat(props: CashSaleChatProps) {
  return <ContractChat {...props} title="Contract chat" />;
}
