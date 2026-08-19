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
  | { type: 'system'; message: ChatMessage }
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
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function messageTimeLabel(iso: string): string {
  return timeLabel(iso);
}

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
      out.push({ type: 'day', key: `day-${day}`, label: dayLabel(message.created_at) });
      lastDay = day;
      lastStamp = null;
    }

    if (message.kind === 'SYSTEM') {
      out.push({ type: 'system', message });
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
