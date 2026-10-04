// components/messages/inboxState.ts
//
// The inbox pane's state transitions, as plain functions over plain data.
//
// The pane beside an open thread is LIVE: it sits in the thread route's layout, so it
// survives a thread-to-thread click instead of being rebuilt by one, and Realtime keeps
// it current rather than a re-render of the whole route (`InboxProvider`). Every change
// it can undergo — a message arriving, a thread being opened, a recount, a fresh server
// snapshot — is one of the functions below. Each takes the current list and returns the
// next, and returns the SAME array when nothing changed, so a no-op event costs no render.
//
// No React and no Supabase in this module, so the rules can be read on their own.

import type { ConversationListEntry } from '@/lib/actions/messages';
import type { Tables } from '@/lib/supabase/database.types';
import { attachmentPreviewLabel } from '@/lib/storage/messageAttachmentsShared';

type MessageRow = Tables<'messages'>;

/**
 * Milliseconds for a timestamp, or 0 when it is absent or unreadable.
 *
 * COMPARED AS NUMBERS, NEVER AS STRINGS. The list mixes two spellings of an instant:
 * `last_message_at` is written by `sendMessage` from a JavaScript `Date`
 * (`…T01:02:03.456Z`) while `messages.created_at` comes back from Postgres
 * (`…T01:02:03.456789+00:00`), and ordering those lexically is wrong as often as right.
 *
 * Postgres's own TEXT form (`2026-10-03 01:02:03.456789+00`) is not ISO 8601 and
 * `Date.parse` rejects it — realtime-js only swaps the space for a `T`, so a payload in
 * that shape would arrive as `…T01:02:03.456789+00`. It is normalised rather than read
 * as 0, because a 0 here does not throw: it quietly sorts a fresh message below
 * everything else.
 */
export function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  let ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    ms = Date.parse(iso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  }
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Newest activity first — the server's own order (`last_message_at desc`).
 *
 * Stable, so a list that arrives from the server already in that order keeps it
 * exactly, ties included. `last_message_at` is bumped for SYSTEM lines as well as
 * member messages (the contract-event triggers do `greatest(last_message_at, …)`), so
 * a local bump on ANY inserted row matches what the next server render will say.
 */
export function sortByActivity(
  list: readonly ConversationListEntry[],
): ConversationListEntry[] {
  return [...list].sort((a, b) => timeOf(b.lastMessageAt) - timeOf(a.lastMessageAt));
}

/**
 * Whether a message puts a number on the unread badge: a MEMBER's message, from the
 * other participant, that nobody has read yet.
 *
 * The same three tests `listMyConversations` applies, deliberately — SYSTEM lines are
 * contract history and never nag, and a badge the client computed differently from the
 * server would change the moment the next snapshot landed.
 */
export function isUnreadInbound(message: MessageRow, currentUserId: string): boolean {
  return (
    message.kind === 'USER' &&
    message.sender_id !== currentUserId &&
    message.read_at === null
  );
}

/** Replace one entry by id. The same array back when the id is absent or nothing moved. */
function updateEntry(
  list: ConversationListEntry[],
  conversationId: string,
  update: (entry: ConversationListEntry) => ConversationListEntry,
): ConversationListEntry[] {
  const index = list.findIndex((entry) => entry.id === conversationId);
  if (index === -1) return list;
  const next = update(list[index]);
  if (next === list[index]) return list;
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

/**
 * A thread has been opened here, so its badge clears now.
 *
 * Ahead of the read receipt, on purpose: `ChatThread` writes `read_at` on mount, and a
 * badge that waited for that round trip would sit on the very thread being read.
 */
export function markConversationReadLocally(
  list: ConversationListEntry[],
  conversationId: string,
): ConversationListEntry[] {
  return updateEntry(list, conversationId, (entry) =>
    entry.unreadCount === 0 ? entry : { ...entry, unreadCount: 0 },
  );
}

/** An authoritative unread count for one thread, from a recount query. */
export function setUnreadCount(
  list: ConversationListEntry[],
  conversationId: string,
  count: number,
): ConversationListEntry[] {
  return updateEntry(list, conversationId, (entry) =>
    entry.unreadCount === count ? entry : { ...entry, unreadCount: count },
  );
}

/**
 * Fold one inserted message into the list: a newer preview, a newer activity time
 * (which re-sorts the list) and, when `countUnread`, one more on the badge.
 *
 * Returns `null` when the message belongs to a conversation the list does not hold —
 * a thread someone has just started with this member. The caller refreshes from the
 * server rather than inventing a row, because a row needs the other participant's
 * name, the listing and the contract state, and none of that is in a message.
 *
 * Safe to apply twice. A catch-up query can return a row Realtime already delivered;
 * the preview only moves to a message at least as new as the current one, an
 * identical preview is kept as is, and catch-up passes `countUnread: false`.
 */
export function applyMessageToList(
  list: ConversationListEntry[],
  message: MessageRow,
  options: { currentUserId: string; countUnread: boolean },
): ConversationListEntry[] | null {
  const index = list.findIndex((entry) => entry.id === message.conversation_id);
  if (index === -1) return null;

  const entry = list[index];
  const at = timeOf(message.created_at);

  let lastMessage = entry.lastMessage;
  if (at >= timeOf(entry.lastMessage?.createdAt)) {
    const body = attachmentPreviewLabel({
      body: message.body,
      attachmentMime: message.attachment_mime,
      attachmentName: message.attachment_name,
    });
    const unchanged =
      entry.lastMessage !== null &&
      entry.lastMessage.body === body &&
      timeOf(entry.lastMessage.createdAt) === at;
    if (!unchanged) lastMessage = { body, createdAt: message.created_at };
  }

  const lastMessageAt =
    at > timeOf(entry.lastMessageAt) ? message.created_at : entry.lastMessageAt;
  const unreadCount =
    options.countUnread && isUnreadInbound(message, options.currentUserId)
      ? entry.unreadCount + 1
      : entry.unreadCount;

  if (
    lastMessage === entry.lastMessage &&
    lastMessageAt === entry.lastMessageAt &&
    unreadCount === entry.unreadCount
  ) {
    return list;
  }

  const copy = list.slice();
  copy[index] = { ...entry, lastMessage, lastMessageAt, unreadCount };
  return lastMessageAt === entry.lastMessageAt ? copy : sortByActivity(copy);
}

/**
 * Merge a fresh server list into the live one.
 *
 * The server is the source of truth for WHICH conversations exist, their order, their
 * contract state and their unread counts. Two things survive from the live list:
 *
 * - A preview newer than the server's. The snapshot was taken when its render began,
 *   and a message Realtime delivered while that render was in flight is newer than it.
 * - A cleared badge on `readIds` — the open thread and the one being opened. Their read
 *   receipts may still be in flight, and a snapshot taken before they land would put
 *   the badge back on the thread being read.
 */
export function mergeServerList(
  local: readonly ConversationListEntry[],
  server: readonly ConversationListEntry[],
  readIds: readonly (string | null)[],
): ConversationListEntry[] {
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const merged = server.map((entry) => {
    let next = entry;
    const live = localById.get(entry.id);
    if (
      live?.lastMessage &&
      timeOf(live.lastMessage.createdAt) > timeOf(entry.lastMessage?.createdAt)
    ) {
      next = {
        ...next,
        lastMessage: live.lastMessage,
        lastMessageAt:
          timeOf(live.lastMessageAt) > timeOf(next.lastMessageAt)
            ? live.lastMessageAt
            : next.lastMessageAt,
      };
    }
    if (next.unreadCount !== 0 && readIds.includes(entry.id)) {
      next = { ...next, unreadCount: 0 };
    }
    return next;
  });
  return sortByActivity(merged);
}

/**
 * Insert or replace one message in a chronological history.
 *
 * For the CACHED copy of a thread the member is not looking at (`InboxProvider`), so
 * that reopening it shows what arrived while it was closed instead of popping it in a
 * moment later. Rows within one thread all come from Postgres, so this is nearly always
 * an append; the sort is there for the rare out-of-order delivery.
 */
export function upsertMessage(
  history: readonly MessageRow[],
  message: MessageRow,
): MessageRow[] {
  const index = history.findIndex((row) => row.id === message.id);
  if (index !== -1) {
    const copy = history.slice();
    copy[index] = message;
    return copy;
  }
  return [...history, message].sort(
    (a, b) =>
      timeOf(a.created_at) - timeOf(b.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
