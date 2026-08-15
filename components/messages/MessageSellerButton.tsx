'use client';

// components/messages/MessageSellerButton.tsx
//
// Client entry point for messaging a seller from the item detail page.
// Two variants:
//   - "button" (default): a simple button that opens/creates the conversation.
//   - "inline": a compact input row ("Send seller a message" label + text field
//     + send button) styled like a mini-compose box, matching marketplace UX
//     patterns where the first message can be fired without leaving the page.
//
// Both call `getOrCreateConversation` and, on success, route the buyer to the
// conversation thread at `/messages/[conversationId]`.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getOrCreateConversation } from '@/lib/actions/messages';
import { sendMessage } from '@/lib/actions/messages';

/** Human-readable messages for the get-or-create action error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to message the seller.',
  'self-conversation': 'You cannot message yourself.',
  'not-found': 'Could not start the conversation. Please try again.',
};

/**
 * Copy for a refused `sendMessage`, keyed to `SendMessageError`.
 *
 * Separate from the map above because opening a conversation and writing into one
 * fail for different reasons, and one of them is actionable in a way the other is
 * not: an over-long body is something the member can fix, so saying "please try
 * again" would be advice that cannot work.
 */
const SEND_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to send a message.',
  'not-participant': 'You are not part of this conversation.',
  'invalid-body': 'Messages must be between 1 and 4000 characters.',
  'persistence-error': 'Your message could not be sent. Please try again.',
};

/**
 * A "Message seller" control with two presentation modes.
 */
export function MessageSellerButton({
  itemId,
  sellerId,
  size = 'lg',
  variant = 'button',
}: {
  itemId: string;
  sellerId: string;
  /** Trigger button size (button variant only). */
  size?: 'default' | 'sm' | 'lg';
  /** "button" renders a standalone button; "inline" renders a compose row. */
  variant?: 'button' | 'inline';
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await getOrCreateConversation(itemId, sellerId);
      if (result.ok) {
        router.push(`/messages/${result.conversationId}`);
        return;
      }
      setError(
        ERROR_MESSAGES[result.error] ??
          'Unable to open the conversation. Please try again.',
      );
    });
  }

  function handleInlineSend(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const result = await getOrCreateConversation(itemId, sellerId);
      if (!result.ok) {
        setError(
          ERROR_MESSAGES[result.error] ??
            'Unable to send the message. Please try again.',
        );
        return;
      }

      // CHECK THE RESULT. This was `await sendMessage(...)` with the result
      // discarded, so a refusal left `isPending` true, the composer disabled, and no
      // message on screen — a dead control with the member's text still in it and no
      // reason given. `handleClick` above always surfaced its failure; this path did
      // not, which made it an inconsistency inside one component rather than a
      // missing convention.
      const sent = await sendMessage(result.conversationId, text);
      if (!sent.ok) {
        setError(
          SEND_ERROR_MESSAGES[sent.error] ??
            'Your message could not be sent. Please try again.',
        );
        return;
      }

      router.push(`/messages/${result.conversationId}`);
    });
  }

  if (variant === 'inline') {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border bg-muted/40 p-cozy">
          <label
            htmlFor="message-seller-input"
            className="mb-2 flex items-center gap-tight text-body font-medium text-foreground"
          >
            <MessageCircle className="size-4 text-muted-foreground" aria-hidden />
            Send seller a message
          </label>
          <form onSubmit={handleInlineSend} className="flex items-center gap-2">
            <Input
              id="message-seller-input"
              type="text"
              name="message"
              placeholder="Is this still available?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isPending}
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              disabled={isPending || message.trim() === ''}
              aria-busy={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Send
            </Button>
          </form>
        </div>
        {error && (
          <p role="alert" className="text-body text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size={size}
        className="w-full sm:w-auto"
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <MessageCircle aria-hidden />
        )}
        {isPending ? 'Opening…' : 'Message seller'}
      </Button>

      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
