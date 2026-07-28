'use client';

// components/contract/useContractConversation.ts
//
// Resolves the participant chat thread for a contract room (demo-contract-ux
// Req 1, 2). Cash sales, trades and deals each had a near-identical effect plus
// `chatId` / `chatError` state; this is the single implementation.
//
// Contracts opened before chat was linked — or where the create was interrupted —
// self-heal on first view: the room calls the flow's `ensure*Conversation` server
// action, which resolves or creates the two-party thread.

import { useEffect, useRef, useState } from 'react';

export interface ContractConversationOptions {
  /**
   * Set `false` while there is nobody to talk to yet (an unjoined deal has one
   * participant, so no thread can exist).
   */
  enabled?: boolean;
}

export interface ContractConversation {
  /** The resolved thread, or `null` while it is still being opened. */
  conversationId: string | null;
  /** True once opening the thread failed; the panel offers a retry. */
  failed: boolean;
  /** Re-run the self-heal after a failure. */
  retry: () => void;
}

/**
 * Resolve a contract's conversation id, healing the link when it is missing.
 *
 * @param linkedId - The thread already recorded on the contract row, if any.
 * @param ensure - Flow-specific server action that resolves or creates the
 *   thread, returning its id or `null` on failure. Read through a ref, so it does
 *   not need to be memoised by the caller.
 */
export function useContractConversation(
  linkedId: string | null,
  ensure: () => Promise<string | null>,
  { enabled = true }: ContractConversationOptions = {},
): ContractConversation {
  const [conversationId, setConversationId] = useState<string | null>(linkedId);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const ensureRef = useRef(ensure);
  ensureRef.current = ensure;

  useEffect(() => {
    if (linkedId) {
      setConversationId(linkedId);
      setFailed(false);
      return;
    }
    if (!enabled) return;

    let cancelled = false;
    setFailed(false);
    void ensureRef
      .current()
      .then((id) => {
        if (cancelled) return;
        if (id) setConversationId(id);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [linkedId, enabled, attempt]);

  return {
    conversationId,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((count) => count + 1);
    },
  };
}
