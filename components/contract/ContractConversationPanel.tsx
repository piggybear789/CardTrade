'use client';

// components/contract/ContractConversationPanel.tsx
//
// The conversation column of a contract room. Wraps <ContractChat/> with the
// loading and failed states each room previously duplicated, so every flow shows
// the same "Opening chat…" spinner and the same retry affordance.
//
// The live-step control docks between the log and the composer (the `actions`
// slot), where the next thing to happen in the conversation would appear. While
// the thread is still opening it docks in the same place, so the contract can be
// acted on without chat and the control does not jump once chat arrives.
//
// It relies on `ContractSplit` for its bounded height — that is what lets the message
// log scroll in place instead of growing the page.

import type { ReactNode } from 'react';

import {
  ContractChat,
  ContractChatBar,
  type ContractChatSubject,
} from '@/components/messages/ContractChat';
import type { MessageLogShipment } from '@/components/messages/MessageLog';

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
  /** The live-step control. Docked between the log and the composer. */
  actions?: ReactNode;
  /** Secondary actions about the counterparty, in the subject bar's ⋯ menu. */
  menu?: ReactNode;
  /** Phone back target. The bar is the top of the room below `md`. */
  backHref?: string;
  /** The flow's status in words, e.g. "In transit". */
  statusLabel?: string | null;
  /** Carrier details, so the shipped milestone can link out to tracking. */
  shipment?: MessageLogShipment | null;
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
  menu,
  backHref,
  statusLabel,
  shipment = null,
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
        menu={menu}
        backHref={backHref}
        statusLabel={statusLabel}
        shipment={shipment}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:shadow-none">
      <ContractChatBar
        counterpartyName={counterpartyName}
        counterpartyAvatarPath={counterpartyAvatarPath}
        subject={subject}
        backHref={backHref}
        statusLabel={statusLabel}
        menu={menu}
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
          // Empty while it opens. The bar above and the dock below are already
          // drawn, so the column reads as a chat with no messages yet rather
          // than as a broken one, and a spinner in the middle of it was the
          // loudest thing on the screen for the second it lasted.
          <span className="sr-only" role="status">
            Opening chat…
          </span>
        )}
      </div>
      {/* Docked in the same place it will be once the thread opens, so the
          control does not jump when chat arrives. The original reason for
          putting actions on the bar during this state still holds: a contract
          has to be actionable even if its chat never loads. */}
      {actions ? (
        <div className="relative z-10 shrink-0 border-t bg-card">{actions}</div>
      ) : null}
    </section>
  );
}
