'use client';

// components/contract/ContractConversationPanel.tsx
//
// The conversation column of a contract room. Wraps <ContractChat/> with the
// loading and failed states each room previously duplicated, so every flow shows
// the same "Opening chat…" spinner and the same retry affordance.
//
// It relies on `ContractSplit` for its bounded height — that is what lets the message
// log scroll in place instead of growing the page.

import { Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { ContractChat } from '@/components/messages/ContractChat';

export interface ContractConversationPanelProps {
  /** Resolved thread id, or `null` while it is still being opened. */
  conversationId: string | null;
  currentUserId: string;
  counterpartyName: string;
  /** Panel heading, e.g. "Contract chat" / "Trade chat" / "Deal chat". */
  title?: string;
  placeholder?: string;
  emptyHint?: string;
  /** True once opening the thread failed. */
  failed?: boolean;
  /** Re-run the self-heal; renders a "Try again" control when provided. */
  onRetry?: () => void;
}

/** The shared chat panel for a contract room, including its pending states. */
export function ContractConversationPanel({
  conversationId,
  currentUserId,
  counterpartyName,
  title = 'Contract chat',
  placeholder,
  emptyHint,
  failed = false,
  onRetry,
}: ContractConversationPanelProps) {
  if (conversationId) {
    return (
      <ContractChat
        conversationId={conversationId}
        currentUserId={currentUserId}
        counterpartyName={counterpartyName}
        title={title}
        placeholder={placeholder}
        emptyHint={emptyHint}
        contractHref={`/messages/${conversationId}`}
      />
    );
  }

  return (
    <Card className="grid flex-1 place-items-center">
      <CardContent className="pt-6 text-center text-body text-muted-foreground">
        {failed ? (
          <>
            Chat could not be opened.
            {onRetry ? (
              <>
                {' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-4"
                  onClick={onRetry}
                >
                  Try again
                </button>
              </>
            ) : null}
          </>
        ) : (
          <span className="flex items-center gap-snug">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Opening chat…
          </span>
        )}
      </CardContent>
    </Card>
  );
}
