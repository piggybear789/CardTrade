// components/messages/groupMessages.ts
//
// Collapse a chronological thread into day marks, participant clusters, and
// contract-event runs. Every row participates in the same calendar chronology:
// a day marker appears once, then human and system activity share that day.

import type { Tables } from '@/lib/supabase/database.types';

export type ChatMessage = Tables<'messages'>;

const CLUSTER_GAP_MS = 5 * 60 * 1000;
const CONVERSATION_TIME_ZONE = 'Australia/Sydney';
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  timeZone: CONVERSATION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type MessageCluster =
  | { type: 'day'; key: string; label: string; dateTime: string }
  | {
      type: 'system';
      key: string;
      cashSaleId: string | null;
      messages: ChatMessage[];
    }
  | {
      type: 'user';
      key: string;
      mine: boolean;
      senderId: string;
      messages: ChatMessage[];
    };

function dayKey(iso: string): string {
  const parts = DAY_KEY_FORMATTER.formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

function localDayKey(date: Date): string {
  return dayKey(date.toISOString());
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(iso) === localDayKey(today)) return 'Today';
  if (dayKey(iso) === localDayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-AU', {
    timeZone: CONVERSATION_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Local clock label for an entry beneath its shared day marker. */
export function messageTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    timeZone: CONVERSATION_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Group a chronological message collection without changing its order.
 *
 * System runs stop at a calendar boundary, a different Cash_Sale, or a new
 * AGREEMENT_CREATED event. The last rule also segments legacy rows created
 * before messages carried cash_sale_id.
 */
export function groupMessages(
  messages: ChatMessage[],
  currentUserId: string,
): MessageCluster[] {
  const out: MessageCluster[] = [];
  let lastDay: string | null = null;
  let lastStamp: number | null = null;

  for (const message of messages) {
    const day = dayKey(message.created_at);
    if (day !== lastDay) {
      out.push({
        type: 'day',
        key: `day-${day}`,
        label: dayLabel(message.created_at),
        dateTime: day,
      });
      lastDay = day;
      lastStamp = null;
    }

    if (message.kind === 'SYSTEM') {
      const open = out[out.length - 1];
      const startsContract = message.system_event === 'AGREEMENT_CREATED';
      if (
        open?.type === 'system' &&
        open.cashSaleId === message.cash_sale_id &&
        !startsContract
      ) {
        open.messages.push(message);
      } else {
        out.push({
          type: 'system',
          key: message.id,
          cashSaleId: message.cash_sale_id,
          messages: [message],
        });
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
