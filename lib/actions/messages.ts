'use server';

// lib/actions/messages.ts
//
// Server Actions for buyer<->seller Messaging (Phase 2). These are THIN wrappers
// that authenticate the caller and operate through the cookie-bound Supabase
// client so RLS enforces the two-participant access rules on `conversations`
// and `messages` end-to-end.
//
// Participant ordering convention: a conversation stores its two participants as
// `participant_a` < `participant_b` (ordered as text). Ordering the pair the
// same way on every lookup/insert lets conversations dedupe: a given
// (item_id, a, b) triple maps to exactly one conversation regardless of who
// initiated it.
//
// Every export is an async Server Action; shared shapes are `export type` only
// (type exports are erased and permitted in a 'use server' module).

import { createClient } from '@/lib/supabase/server';
import { createNotification } from '@/lib/notifications/createNotification';
import { MESSAGE_BODY_MIN, MESSAGE_BODY_MAX } from '@/lib/marketplace-constants';
import type { Tables } from '@/lib/supabase/database.types';

/** A persisted conversation row. */
export type ConversationRow = Tables<'conversations'>;
/** A persisted message row. */
export type MessageRow = Tables<'messages'>;

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/**
 * Order two user ids into the `(participant_a, participant_b)` convention where
 * `a < b` as text. Keeps a conversation between the same two users unique
 * regardless of who starts it.
 */
function orderParticipants(
  x: string,
  y: string,
): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// getOrCreateConversation
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link getOrCreateConversation}. */
export type GetOrCreateError =
  | 'unauthenticated'
  | 'self-conversation'
  | 'not-found';

/** Result of {@link getOrCreateConversation}. */
export type GetOrCreateConversationResult =
  | { ok: true; conversationId: string }
  | ActionFailure<GetOrCreateError>;

/**
 * Find or create the conversation between the caller and `otherUserId`,
 * optionally scoped to an item (`itemId`). Resolves the `(a, b)` ordering,
 * looks for an existing conversation matching `(item_id, a, b)`, and inserts one
 * if none exists. RLS permits a participant to insert their own conversation.
 */
export async function getOrCreateConversation(
  itemId: string | null,
  otherUserId: string,
): Promise<GetOrCreateConversationResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!otherUserId || otherUserId === me) {
    return { ok: false, error: 'self-conversation' };
  }

  const { a, b } = orderParticipants(me, otherUserId);

  // Look for an existing conversation for this exact (item_id, a, b) triple.
  // `item_id` is nullable, so match it with `.is(null)` when unscoped.
  // A deal's thread is scoped by `deal_id` and is never a general DM, so it is
  // excluded here — otherwise an unscoped lookup between two members who also
  // have a deal together would match two rows.
  let existingQuery = supabase
    .from('conversations')
    .select('id')
    .eq('participant_a', a)
    .eq('participant_b', b)
    .is('deal_id', null);
  existingQuery = itemId
    ? existingQuery.eq('item_id', itemId)
    : existingQuery.is('item_id', null);

  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) {
    return { ok: true, conversationId: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from('conversations')
    .insert({
      item_id: itemId,
      participant_a: a,
      participant_b: b,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    return {
      ok: false,
      error: 'not-found',
      detail: error?.message ?? 'Failed to create conversation',
    };
  }

  return { ok: true, conversationId: inserted.id };
}

// ---------------------------------------------------------------------------
// Shared enrichment shapes
// ---------------------------------------------------------------------------

/** The other participant's public, catalog-safe profile info. */
export interface OtherParticipant {
  id: string;
  displayName: string | null;
}

/** A compact summary of the item a conversation is about (if any). */
export interface ConversationItemSummary {
  id: string;
  title: string;
  imagePath: string | null;
}

/** A compact summary of the private deal a conversation belongs to (if any). */
export interface ConversationDealSummary {
  id: string;
  title: string;
}

/** A compact summary of the trade a conversation belongs to (if any). */
export interface ConversationTradeSummary {
  id: string;
}

/** A conversation enriched for the inbox list. */
export interface ConversationListEntry {
  id: string;
  itemId: string | null;
  lastMessageAt: string;
  other: OtherParticipant;
  item: ConversationItemSummary | null;
  /** Set when this thread is a private deal room's chat. */
  deal: ConversationDealSummary | null;
  /** Set when this thread is a 2-way trade's chat. */
  trade: ConversationTradeSummary | null;
  lastMessage: { body: string; createdAt: string } | null;
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// listMyConversations
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link listMyConversations}. */
export type ListConversationsError = 'unauthenticated' | 'persistence-error';

/** Result of {@link listMyConversations}. */
export type ListMyConversationsResult =
  | { ok: true; conversations: ConversationListEntry[] }
  | ActionFailure<ListConversationsError>;

/**
 * List the caller's conversations, newest activity first, each enriched with the
 * other participant's display name, the related item summary (if any), the
 * latest message preview, and the caller's unread count. RLS restricts the base
 * query to conversations the caller participates in.
 */
export async function listMyConversations(): Promise<ListMyConversationsResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data: convData, error } = await supabase
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  const conversations = (convData ?? []) as ConversationRow[];
  if (conversations.length === 0) {
    return { ok: true, conversations: [] };
  }

  // Resolve the "other" participant for each conversation.
  const otherIds = Array.from(
    new Set(
      conversations.map((c) =>
        c.participant_a === me ? c.participant_b : c.participant_a,
      ),
    ),
  );
  const itemIds = Array.from(
    new Set(
      conversations
        .map((c) => c.item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const dealIds = Array.from(
    new Set(
      conversations
        .map((c) => c.deal_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const conversationIds = conversations.map((c) => c.id);

  // Batch the enrichment lookups. Each tolerates missing rows (null).
  const [profilesRes, itemsRes, dealsRes, messagesRes] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, display_name')
      .in('id', otherIds),
    itemIds.length > 0
      ? supabase.from('items').select('id, title, image_paths').in('id', itemIds)
      : Promise.resolve({ data: [] as { id: string; title: string; image_paths: string[] }[] }),
    // Deal RLS already scopes `deals` to its two parties, so this can only
    // return deals the caller is part of.
    dealIds.length > 0
      ? supabase.from('deals').select('id, title').in('id', dealIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    supabase
      .from('messages')
      .select('id, conversation_id, sender_id, body, read_at, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false }),
  ]);

  const nameById = new Map<string, string | null>(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  const itemById = new Map<string, ConversationItemSummary>(
    (itemsRes.data ?? []).map((it) => [
      it.id as string,
      {
        id: it.id as string,
        title: it.title as string,
        imagePath: ((it.image_paths as string[] | null) ?? [])[0] ?? null,
      },
    ]),
  );

  const dealById = new Map<string, ConversationDealSummary>(
    (dealsRes.data ?? []).map((d) => [
      d.id as string,
      { id: d.id as string, title: d.title as string },
    ]),
  );

  // Group messages by conversation (already sorted newest-first) so we can pick
  // the latest preview and count unread messages in a single pass.
  const latestByConversation = new Map<string, { body: string; createdAt: string }>();
  const unreadByConversation = new Map<string, number>();
  for (const msg of (messagesRes.data ?? []) as MessageRow[]) {
    if (!latestByConversation.has(msg.conversation_id)) {
      latestByConversation.set(msg.conversation_id, {
        body: msg.body,
        createdAt: msg.created_at,
      });
    }
    // Only a real person's message should nag with an unread badge.
    if (msg.kind === 'USER' && msg.sender_id !== me && msg.read_at === null) {
      unreadByConversation.set(
        msg.conversation_id,
        (unreadByConversation.get(msg.conversation_id) ?? 0) + 1,
      );
    }
  }

  const entries: ConversationListEntry[] = conversations.map((c) => {
    const otherId = c.participant_a === me ? c.participant_b : c.participant_a;
    return {
      id: c.id,
      itemId: c.item_id,
      lastMessageAt: c.last_message_at,
      other: { id: otherId, displayName: nameById.get(otherId) ?? null },
      item: c.item_id ? (itemById.get(c.item_id) ?? null) : null,
      deal: c.deal_id ? (dealById.get(c.deal_id) ?? null) : null,
      trade: c.trade_id ? { id: c.trade_id } : null,
      lastMessage: latestByConversation.get(c.id) ?? null,
      unreadCount: unreadByConversation.get(c.id) ?? 0,
    };
  });

  return { ok: true, conversations: entries };
}

// ---------------------------------------------------------------------------
// getConversation
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link getConversation}. */
export type GetConversationError =
  | 'unauthenticated'
  | 'not-participant'
  | 'not-found';

/** A conversation with its participant, item context, and full message history. */
export interface ConversationDetail {
  conversation: ConversationRow;
  other: OtherParticipant;
  item: ConversationItemSummary | null;
  /** Set when this thread is a private deal room's chat. */
  deal: ConversationDealSummary | null;
  /** Set when this thread is a 2-way trade's chat. */
  trade: ConversationTradeSummary | null;
  messages: MessageRow[];
}

/** Result of {@link getConversation}. */
export type GetConversationResult =
  | { ok: true; data: ConversationDetail }
  | ActionFailure<GetConversationError>;

/**
 * Load a single conversation with the other participant's public profile, the
 * related item summary (if any), and all messages ordered oldest-first. RLS
 * restricts reads to the two participants, so a non-participant (or a missing
 * conversation) surfaces as `not-found` / `not-participant`.
 */
export async function getConversation(
  conversationId: string,
): Promise<GetConversationResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conversation) {
    // RLS hides conversations from non-participants; treat as not found.
    return { ok: false, error: 'not-found' };
  }

  const conv = conversation as ConversationRow;
  if (conv.participant_a !== me && conv.participant_b !== me) {
    return { ok: false, error: 'not-participant' };
  }

  const otherId = conv.participant_a === me ? conv.participant_b : conv.participant_a;

  const [profileRes, itemRes, dealRes, messagesRes] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, display_name')
      .eq('id', otherId)
      .maybeSingle(),
    conv.item_id
      ? supabase
          .from('items')
          .select('id, title, image_paths')
          .eq('id', conv.item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    conv.deal_id
      ? supabase.from('deals').select('id, title').eq('id', conv.deal_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  ]);

  const item = itemRes.data
    ? {
        id: itemRes.data.id as string,
        title: itemRes.data.title as string,
        imagePath: ((itemRes.data.image_paths as string[] | null) ?? [])[0] ?? null,
      }
    : null;

  return {
    ok: true,
    data: {
      conversation: conv,
      other: {
        id: otherId,
        displayName: (profileRes.data?.display_name as string | null) ?? null,
      },
      item,
      deal: dealRes.data
        ? {
            id: dealRes.data.id as string,
            title: dealRes.data.title as string,
          }
        : null,
      trade: conv.trade_id ? { id: conv.trade_id } : null,
      messages: (messagesRes.data ?? []) as MessageRow[],
    },
  };
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link sendMessage}. */
export type SendMessageError =
  | 'unauthenticated'
  | 'not-participant'
  | 'invalid-body'
  | 'persistence-error';

/** Result of {@link sendMessage}. */
export type SendMessageResult =
  | { ok: true; message: MessageRow }
  | ActionFailure<SendMessageError>;

/**
 * Send a message in a conversation. Validates the body length (1..4000 after
 * trimming), inserts a message with `sender_id = caller`, and bumps the
 * conversation's `last_message_at` so the inbox re-sorts. RLS ensures only a
 * participant can insert into (or update) the conversation.
 */
export async function sendMessage(
  conversationId: string,
  body: string,
): Promise<SendMessageResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const trimmed = (body ?? '').trim();
  const length = Array.from(trimmed).length;
  if (length < MESSAGE_BODY_MIN || length > MESSAGE_BODY_MAX) {
    return { ok: false, error: 'invalid-body' };
  }

  // Confirm participation before writing (RLS also enforces this).
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, participant_a, participant_b')
    .eq('id', conversationId)
    .maybeSingle();

  if (
    !conversation ||
    (conversation.participant_a !== me && conversation.participant_b !== me)
  ) {
    return { ok: false, error: 'not-participant' };
  }

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: me,
      body: trimmed,
    })
    .select('*')
    .single();

  if (error || !message) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: error?.message ?? 'Failed to send message',
    };
  }

  // Bump the conversation's activity timestamp so the inbox re-orders. A failure
  // here does not invalidate the sent message, so it is best-effort.
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  // Best-effort: notify the OTHER participant of the new message. Never blocks
  // the sent message on failure.
  const recipientId =
    conversation.participant_a === me
      ? conversation.participant_b
      : conversation.participant_a;
  await createNotification({
    userId: recipientId,
    type: 'MESSAGE',
    title: 'New message',
    body: trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed,
    link: `/messages/${conversationId}`,
  });

  return { ok: true, message: message as MessageRow };
}

// ---------------------------------------------------------------------------
// markConversationRead
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link markConversationRead}. */
export type MarkReadError = 'unauthenticated' | 'persistence-error';

/** Result of {@link markConversationRead}. */
export type MarkConversationReadResult =
  | { ok: true; updated: number }
  | ActionFailure<MarkReadError>;

/**
 * Mark every message in a conversation that was sent by the OTHER participant
 * and is still unread as read (`read_at = now()`). RLS restricts the update to
 * conversations the caller participates in, so a non-participant simply updates
 * no rows.
 */
export async function markConversationRead(
  conversationId: string,
): Promise<MarkConversationReadResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  // System messages have no sender, and `sender_id <> me` never matches NULL, so
  // they must be included explicitly or they would stay unread forever.
  const { data, error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .or(`sender_id.neq.${me},sender_id.is.null`)
    .is('read_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  return { ok: true, updated: (data ?? []).length };
}
