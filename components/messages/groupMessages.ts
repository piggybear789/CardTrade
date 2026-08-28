// components/messages/groupMessages.ts
//
// Collapse a chronological thread into day marks and sender clusters.
// Consecutive messages from the same person within five minutes share a
// timestamp; a system line or a new day always starts a new cluster.

import type { Tables } from '@/lib/supabase/database.types';

export type ChatMessage = Tables<'messages'>;

const CLUSTER_GAP_MS = 5 * 60 * 1000;

export type MessageCluster =
  | { type: 'day'; key: string; label: string }
  /**
   * A RUN of consecutive contract events, not a single line. A contract
   * advances in bursts — pay, then ship, then deliver — and rendering each as
   * its own centred sentence turned the room's own record into six
   * indistinguishable lines of grey. Grouped, the run reads as one block of
   * "what the contract did" between two stretches of what people said.
   */
  | { type: 'system'; key: string; messages: ChatMessage[] }
  | {
      type: 'user';
      key: string;
      mine: boolean;
      senderId: string;
      messages: ChatMessage[];
    };

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === localDayKey(today)) return 'Today';
  if (dayKey(iso) === localDayKey(yesterday)) return 'Yesterday';
  // Pin en-AU: `[]` follows the host locale, so SSR (often en-AU) and the
  // browser (often en-US) disagree — "Tue, 25 Aug" vs "Tue, Aug 25" — and
  // hydrate as a mismatch. Same locale as `messageDateTimeLabel`.
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function messageTimeLabel(iso: string): string {
  return timeLabel(iso);
}

/**
 * Absolute date and time for one contract row, e.g. `16 Jul, 11:49 am`.
 *
 * A contract run spans days, so its rows cannot lean on a day marker the way a
 * chat bubble does — each one has to say when it happened on its own. The
 * weekday is dropped that `formatContractDateTime` includes: this sits inline
 * after the event sentence rather than in the room's audit column, and
 * "Thu, 16 Jul, 11:49 am" pushed most sentences onto a second line.
 */
export function messageDateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function groupMessages(
  messages: ChatMessage[],
  currentUserId: string,
): MessageCluster[] {
  const out: MessageCluster[] = [];
  let lastDay: string | null = null;
  let lastStamp: number | null = null;

  for (const message of messages) {
    const isSystem = message.kind === 'SYSTEM';

    // DAY MARKERS SCOPE HUMAN CONVERSATION ONLY.
    //
    // They used to be pushed for every message, which meant a contract run could
    // never span midnight: a five-event sale that paid on Thursday and completed
    // on Sunday rendered as four separate records with a date label wedged
    // between each. The calendar boundary is meaningful for chat — "did they
    // reply today or last week" — and arbitrary inside a contract, which is one
    // continuous thing. Contract rows carry their own absolute date instead
    // (`messageDateTimeLabel`), so nothing is lost by not marking the day here.
    if (!isSystem) {
      const day = dayKey(message.created_at);
      if (day !== lastDay) {
        out.push({ type: 'day', key: `day-${day}`, label: dayLabel(message.created_at) });
        lastDay = day;
        lastStamp = null;
      }
    }

    if (isSystem) {
      const open = out[out.length - 1];
      if (open?.type === 'system') {
        open.messages.push(message);
      } else {
        out.push({ type: 'system', key: message.id, messages: [message] });
      }
      lastStamp = null;
      continue;
    }

    const at = new Date(message.created_at).getTime();
    const senderId = message.sender_id ?? '';
    const last = out[out.length - 1];
    const canMerge =
      last?.type === 'user' &&
      last.senderId === senderId &&
      lastStamp !== null &&
      at - lastStamp <= CLUSTER_GAP_MS;

    if (canMerge && last.type === 'user') {
      last.messages.push(message);
    } else {
      out.push({
        type: 'user',
        key: message.id,
        mine: senderId === currentUserId,
        senderId,
        messages: [message],
      });
    }
    lastStamp = at;
  }

  return out;
}
