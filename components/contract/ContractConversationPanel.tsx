'use client';

// components/contract/ContractConversationPanel.tsx
//
// The conversation column of a contract room. Wraps <ContractChat/> with the
// loading and failed states each room previously duplicated, so every flow shows
// the same "Opening chat…" spinner and the same retry affordance.
//
// Live-step controls sit on the product strip (the `actions` slot), the way
// 闲鱼 puts 我想要 beside the goods. While the thread is still opening those
// same actions still sit there so the contract can be acted on without chat.
//
// It relies on `ContractSplit` for its bounded height — that is what lets the message
// log scroll in place instead of growing the page.

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import {
  ContractChat,
  ContractChatBar,
  type ContractChatSubject,
} from '@/components/messages/ContractChat';

export interface ContractConversationPanelProps {
  /** Resolved thread id, or `null` while it is still being opened. */
  conversationId: string | null;
  currentUserId: string;
  counterpartyName: string;
  /** Avatar object path, or null. A PATH, not a URL. */
  counterpartyAvatarPath?: string | null;
  /** Panel heading. Unused visually — the counterpart's name is the title. */
  title?: string;
  placeholder?: string;
  emptyHint?: string;
  /** Item strip under the person bar (Xianyu product header). */
  subject?: ContractChatSubject | null;
  /** Live-step controls, rendered on the product strip. */
  actions?: ReactNode;
  /** Phone back target. The bar is the top of the room below `md`. */
  backHref?: string;
  /** The flow's status in words, e.g. "In transit". */
  statusLabel?: string | null;
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
  counterpartyAvatarPath,
  placeholder,
  emptyHint,
  subject,
  actions,
  backHref,
  statusLabel,
  failed = false,
  onRetry,
}: ContractConversationPanelProps) {
  if (conversationId) {
    return (
      <ContractChat
        conversationId={conversationId}
        currentUserId={currentUserId}
        counterpartyName={counterpartyName}
        counterpartyAvatarPath={counterpartyAvatarPath}
        placeholder={placeholder}
        emptyHint={emptyHint}
        subject={subject}
        actions={actions}
        backHref={backHref}
        statusLabel={statusLabel}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <ContractChatBar
        counterpartyName={counterpartyName}
        counterpartyAvatarPath={counterpartyAvatarPath}
        subject={subject}
        actions={actions}
        backHref={backHref}
        statusLabel={statusLabel}
      />
      <div className="grid min-h-0 flex-1 place-items-center p-cozy text-center text-body text-muted-foreground">
        {failed ? (
          <p>
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
          </p>
        ) : (
          <span className="flex items-center gap-snug">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Opening chat…
          </span>
        )}
      </div>
    </section>
  );
}
