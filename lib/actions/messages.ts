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
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createNotification } from '@/lib/notifications/createNotification';
import { MESSAGE_BODY_MIN, MESSAGE_BODY_MAX } from '@/lib/marketplace-constants';
import type { Enums, Tables } from '@/lib/supabase/database.types';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import { createAdminClient } from '@/lib/supabase/admin';
import { attachmentPreviewLabel } from '@/lib/storage/messageAttachmentsShared';
import { verifyMessageAttachmentPath } from '@/lib/storage/messageAttachments';
import { isTerminalCashSaleStatus } from '@/domain/contract/cashSaleStatus';

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

/**
 * Resolve the current authenticated user id, or `null`.
 *
 * Reads through the request-cached lookup rather than `client.auth.getUser()`,
 * which revalidates the JWT against the auth server on every call.
 */
async function getUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
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

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!otherUserId || otherUserId === me) {
    return { ok: false, error: 'self-conversation' };
  }

  const { a, b } = orderParticipants(me, otherUserId);

  // Look for an existing conversation for this exact (item_id, a, b) triple.
  // `item_id` is nullable, so match it with `.is(null)` when unscoped.
  //
  // This used to exclude deal-scoped threads via `.is('deal_id', null)`, because a
  // deal room's chat is never a general DM and would otherwise make an unscoped
  // lookup between two members match two rows. The Deal ledger is gone; private
  // deals now open a Cash_Sale or Trade conversation instead. Trade rooms are
  // resolved by `ensure_trade_conversation`, never by this lookup.
  let existingQuery = supabase
    .from('conversations')
    .select('id')
    .eq('participant_a', a)
    .eq('participant_b', b);
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
    const { data: retried } = await existingQuery.maybeSingle();
    if (retried) {
      return { ok: true, conversationId: retried.id };
    }
    return {
      ok: false,
      error: 'not-found',
      detail: friendlyWriteFailure(error, 'Failed to create conversation'),
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
  /** Avatar object path, or null. A PATH, not a URL. */
  avatarPath?: string | null;
}

/** A compact summary of the item a conversation is about (if any). */
export interface ConversationItemSummary {
  id: string;
  title: string;
  imagePath: string | null;
  /** Asking price in the listing's own smallest currency unit. */
  priceCents?: number | null;
  /** ISO 4217 currency for priceCents. Loaded for the thread view. */
  currency?: string | null;
  /** Listing lifecycle status (e.g. AVAILABLE / SOLD). Loaded for the thread view. */
  status?: string | null;
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
  /** Set when this thread is a 2-way trade's chat. */
  trade: ConversationTradeSummary | null;
  /**
   * Set when this thread IS a cash sale's contract thread, with the contract's live
   * status — including `DISPUTED`, which is how the inbox badges a dispute.
   *
   * The sale thread is pointed at from the sale's side, by `cash_sales.conversation_id`,
   * and carries `item_id` like any listing enquiry. There is no conversation-side
   * marker: the separate "arbitration chat" that 0019 used to open (and flag with
   * `conversations.cash_sale_id`) was retired in 0115, because the dispute already
   * appears in this thread as a `DISPUTE_RAISED` notice and produced a duplicate
   * inbox row for the same two people.
   *
   * Without this the inbox could not tell a live $400 contract from someone asking
   * whether a card was still available: both were a name, a preview and a thumbnail.
   */
  sale: ConversationSaleSummary | null;
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

/** Columns required to choose and describe one contract in a reused thread. */
type ConversationSaleRow = Pick<
  Tables<'cash_sales'>,
  | 'id'
  | 'status'
  | 'conversation_id'
  | 'agreed_price_cents'
  | 'currency'
  | 'fulfillment_method'
  | 'from_shopfront'
  | 'buyer_id'
  | 'seller_id'
  | 'created_at'
>;

const CONVERSATION_SALE_SELECT =
  'id, status, conversation_id, agreed_price_cents, currency, fulfillment_method, from_shopfront, buyer_id, seller_id, created_at' as const;

/** Additional delivery fields needed by the open thread. */
type ConversationSaleDetailRow = ConversationSaleRow &
  Pick<
    Tables<'cash_sales'>,
    'tracking_carrier' | 'tracking_number' | 'tracking_url'
  >;

const CONVERSATION_SALE_DETAIL_SELECT =
  'id, status, conversation_id, agreed_price_cents, currency, fulfillment_method, from_shopfront, buyer_id, seller_id, created_at, tracking_carrier, tracking_number, tracking_url' as const;

/**
 * Pick the contract a reused conversation should present.
 *
 * A binder can have several active contracts in one participant/item thread.
 * Prefer the newest active contract, then the newest closed contract, and carry
 * the counts so the UI can route multiple active contracts to the list instead
 * of presenting one arbitrary row as the whole conversation.
 */
function summarizeConversationSales(
  rows: readonly ConversationSaleRow[],
  viewerId: string,
): ConversationSaleSummary | null {
  if (rows.length === 0) return null;

  const newestFirst = [...rows].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
  const active = newestFirst.filter(
    (row) => !isTerminalCashSaleStatus(row.status),
  );
  const selected = active[0] ?? newestFirst[0];

  return {
    id: selected.id,
    status: selected.status,
    agreedPriceCents: selected.agreed_price_cents,
    currency: selected.currency,
    fulfillmentMethod: selected.fulfillment_method,
    fromShopfront: selected.from_shopfront,
    activeContractCount: active.length,
    contractCount: newestFirst.length,
    viewerRole: selected.buyer_id === viewerId ? 'BUYER' : 'SELLER',
  };
}

/**
 * List the caller's conversations, newest activity first, each enriched with the
 * other participant's display name, the related item summary (if any), the
 * latest message preview, and the caller's unread count. RLS restricts the base
 * query to conversations the caller participates in.
 */
export async function listMyConversations(): Promise<ListMyConversationsResult> {
  const supabase = await createClient();

  const me = await getUserId();
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
  const conversationIds = conversations.map((c) => c.id);

  // Batch the enrichment lookups. Each tolerates missing rows (null).
  const [profilesRes, itemsRes, saleThreadsRes, messagesRes] =
    await Promise.all([
      supabase
        .from('public_profiles')
        .select('id, display_name, avatar_path')
        .in('id', otherIds),
      itemIds.length > 0
        ? supabase.from('items').select('id, title, image_paths').in('id', itemIds)
        : Promise.resolve({ data: [] as { id: string; title: string; image_paths: string[] }[] }),
      // WHICH THREADS ARE CONTRACTS. Looked up from the sale's own
      // `conversation_id` rather than from the conversation row, because a sale thread
      // is not marked on the conversation at all — see `ConversationListEntry.sale`.
      // RLS scopes `cash_sales` to its buyer and seller, who are exactly the two
      // participants of the thread, so this returns a row or nothing.
      supabase
        .from('cash_sales')
        .select(CONVERSATION_SALE_SELECT)
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('messages')
        .select(
          'id, conversation_id, sender_id, kind, body, read_at, created_at, attachment_path, attachment_name, attachment_mime',
        )
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false }),
    ]);

  const nameById = new Map<string, string | null>(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  const avatarById = new Map<string, string | null>(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.avatar_path as string | null) ?? null,
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

  // Group every sale attached from the cash-sale side. A listing conversation can be
  // reused after a closed contract and binder listings can have several active rows,
  // so a single Map assignment would make database return order decide the header.
  const saleRowsByConversation = new Map<string, ConversationSaleRow[]>();
  for (const row of (saleThreadsRes.data ?? []) as ConversationSaleRow[]) {
    if (!row.conversation_id) continue;
    const grouped = saleRowsByConversation.get(row.conversation_id) ?? [];
    grouped.push(row);
    saleRowsByConversation.set(row.conversation_id, grouped);
  }
  const saleByConversation = new Map<string, ConversationSaleSummary>();
  for (const [conversationId, rows] of saleRowsByConversation) {
    const summary = summarizeConversationSales(rows, me);
    if (summary) saleByConversation.set(conversationId, summary);
  }

  // Group messages by conversation (already sorted newest-first) so we can pick
  // the latest preview and count unread messages in a single pass.
  const latestByConversation = new Map<string, { body: string; createdAt: string }>();
  const unreadByConversation = new Map<string, number>();
  for (const msg of (messagesRes.data ?? []) as MessageRow[]) {
    if (!latestByConversation.has(msg.conversation_id)) {
      latestByConversation.set(msg.conversation_id, {
        body: attachmentPreviewLabel({
          body: msg.body,
          attachmentMime: msg.attachment_mime,
          attachmentName: msg.attachment_name,
        }),
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
      other: {
        id: otherId,
        displayName: nameById.get(otherId) ?? null,
        avatarPath: avatarById.get(otherId) ?? null,
      },
      item: c.item_id ? (itemById.get(c.item_id) ?? null) : null,
      trade: c.trade_id ? { id: c.trade_id } : null,
      sale: saleByConversation.get(c.id) ?? null,
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

/**
 * Carrier details for the sale this thread belongs to, once one is recorded.
 *
 * The shipped SYSTEM line embeds the carrier and number as PROSE — SQL's
 * `describe_cash_sale_event` builds the sentence — so the thread cannot turn
 * that into a link without the structured values alongside it.
 */
export interface ConversationShipment {
  carrier: string | null;
  trackingNumber: string;
  /** Carrier deep link. Null for the manual provider, which cannot supply one. */
  trackingUrl: string | null;
}

/**
 * The cash sale this thread belongs to, when it has one.
 *
 * The ITEM's status and the CONTRACT's status are different facts and the
 * thread was showing the wrong one: a finished purchase read "Sold", which is
 * true of the listing and says nothing about whether the money settled. This
 * also carries the id, because on a live or completed sale the contract room is
 * the correct destination and the listing is not.
 */
export interface ConversationSaleSummary {
  id: string;
  status: Enums<'cash_sale_status'>;
  /** Agreed item price in the contract's own smallest currency unit. */
  agreedPriceCents: number;
  /** ISO 4217 currency code frozen on the contract. */
  currency: string;
  /** The agreed handover path, once terms exist. */
  fulfillmentMethod: Enums<'handover_method'> | null;
  /** True when the contract buys named goods from a binder or bulk listing. */
  fromShopfront: boolean;
  /** Number of non-terminal contracts sharing this conversation. */
  activeContractCount: number;
  /** Number of historical and active contracts sharing this conversation. */
  contractCount: number;
  /** The viewing member's side of the selected contract. */
  viewerRole: 'BUYER' | 'SELLER';
}

/** A conversation with its participant, item context, and full message history. */
export interface ConversationDetail {
  conversation: ConversationRow;
  other: OtherParticipant;
  item: ConversationItemSummary | null;
  /** Set when this thread is a 2-way trade's chat. */
  trade: ConversationTradeSummary | null;
  /** Set when this thread belongs to a cash sale. */
  sale: ConversationSaleSummary | null;
  /** Set once the seller has recorded a shipment on the related cash sale. */
  shipment: ConversationShipment | null;
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

  const me = await getUserId();
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

  // Sale threads are linked from cash_sales.conversation_id. An ordered collection,
  // because a listing conversation can be reused by several sequential — or
  // binder — contracts.
  const salePromise = supabase
    .from('cash_sales')
    .select(CONVERSATION_SALE_DETAIL_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  // Read the message snapshot before contract context. If a transition commits
  // between them, the later sale read is newer; the reverse order can render a
  // new SYSTEM event with a stale amount, status, shipment, and CTA while also
  // seeding that event as already seen by Realtime.
  const [profileRes, itemRes, messagesRes] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, display_name, avatar_path')
      .eq('id', otherId)
      .maybeSingle(),
    conv.item_id
      ? supabase
          .from('items')
          .select('id, title, image_paths, fmv_cents, currency, status')
          .eq('id', conv.item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  ]);
  const saleRes = await salePromise;

  const item = itemRes.data
    ? {
        id: itemRes.data.id as string,
        title: itemRes.data.title as string,
        imagePath: ((itemRes.data.image_paths as string[] | null) ?? [])[0] ?? null,
        priceCents: (itemRes.data.fmv_cents as number | null) ?? null,
        currency: (itemRes.data.currency as string | null) ?? null,
        status: (itemRes.data.status as string | null) ?? null,
      }
    : null;

  const saleRows = (saleRes.data ?? []) as ConversationSaleDetailRow[];
  const sale = summarizeConversationSales(saleRows, me);
  const selectedSale = sale
    ? (saleRows.find((row) => row.id === sale.id) ?? null)
    : null;

  // A number is what makes the shipment real: the carrier and URL are both
  // nullable, and a manual provider records the number with neither.
  const trackingNumber = selectedSale?.tracking_number ?? null;
  const shipment: ConversationShipment | null = trackingNumber
    ? {
        carrier: selectedSale?.tracking_carrier ?? null,
        trackingNumber,
        trackingUrl: selectedSale?.tracking_url ?? null,
      }
    : null;

  return {
    ok: true,
    data: {
      conversation: conv,
      other: {
        id: otherId,
        displayName: (profileRes.data?.display_name as string | null) ?? null,
        avatarPath: (profileRes.data?.avatar_path as string | null) ?? null,
      },
      item,
      trade: conv.trade_id ? { id: conv.trade_id } : null,
      sale,
      shipment,
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
  | 'invalid-attachment'
  | 'persistence-error';

/** Optional file already uploaded to the message-attachments bucket. */
export interface MessageAttachmentInput {
  path: string;
  name: string;
  mime: string;
  bytes: number;
}

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
  attachment?: MessageAttachmentInput | null,
): Promise<SendMessageResult> {
  const supabase = await createClient();

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };

  const trimmed = (body ?? '').trim();
  const length = Array.from(trimmed).length;
  const hasAttachment = Boolean(attachment?.path);
  if (hasAttachment) {
    if (length > MESSAGE_BODY_MAX) {
      return { ok: false, error: 'invalid-body' };
    }
  } else if (length < MESSAGE_BODY_MIN || length > MESSAGE_BODY_MAX) {
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

  let storedAttachment: MessageAttachmentInput | null = null;
  if (attachment?.path) {
    const exists = await verifyMessageAttachmentPath(
      createAdminClient(),
      me,
      attachment.path,
    );
    if (!exists) {
      return { ok: false, error: 'invalid-attachment' };
    }
    storedAttachment = {
      path: attachment.path,
      name: attachment.name.slice(0, 200),
      mime: attachment.mime,
      bytes: attachment.bytes,
    };
  }

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: me,
      body: trimmed,
      ...(storedAttachment
        ? {
            attachment_path: storedAttachment.path,
            attachment_name: storedAttachment.name,
            attachment_mime: storedAttachment.mime,
            attachment_bytes: storedAttachment.bytes,
          }
        : {}),
    })
    .select('*')
    .single();

  if (error || !message) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: friendlyWriteFailure(error, 'Failed to send message'),
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
    body: (() => {
      const preview = attachmentPreviewLabel({
        body: trimmed,
        attachmentMime: storedAttachment?.mime,
        attachmentName: storedAttachment?.name,
      });
      return preview.length > 120 ? `${preview.slice(0, 117)}…` : preview;
    })(),
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

  const me = await getUserId();
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