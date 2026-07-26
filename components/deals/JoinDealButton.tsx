'use client';

// components/deals/JoinDealButton.tsx
//
// The joiner's single action on the share-link page: become the deal's
// counterparty (INVITED -> TERMS) and drop straight into the deal room.
//
// Every guard lives server-side in `joinDealByToken` (self-join, already joined,
// closed, the concurrency-safe write); this component only surfaces the typed
// errors as toasts.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Handshake, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { joinDealByToken } from '@/lib/actions/deals';

/** Friendly messages for each typed joinDealByToken error. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to join this deal.',
  'not-found': 'This deal link is no longer valid.',
  'already-joined': 'Someone else already joined this deal.',
  'self-join': 'This is your own deal link.',
  closed: 'This deal is no longer open to join.',
  'persistence-error': 'Could not join the deal. Please try again.',
};

export interface JoinDealButtonProps {
  /** The share token from the link's URL. */
  token: string;
}

/** "Join this deal" — claims the counterparty slot, then opens the deal room. */
export function JoinDealButton({ token }: JoinDealButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleJoin() {
    startTransition(async () => {
      const result = await joinDealByToken(token);
      if (result.ok) {
        toast.success("You're in — agree the handover next.");
        router.replace(`/deals/${result.dealId}`);
        return;
      }
      toast.error(
        ERROR_MESSAGES[result.error] ?? result.detail ?? 'Could not join the deal.',
      );
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      onClick={handleJoin}
      disabled={isPending}
      aria-busy={isPending}
    >
      {isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Handshake aria-hidden />
      )}
      {isPending ? 'Joining…' : 'Join this deal'}
    </Button>
  );
}
