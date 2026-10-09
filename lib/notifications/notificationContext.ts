import 'server-only';

// lib/notifications/notificationContext.ts
//
// Builds the "what is this about" half of a notification (0126): the listing's title
// and cover, the other member's public name, and the money involved.
//
// LAZY ON PURPOSE. A producer already knows the title and the amount, but the cover
// photo and the other member's display name are two more reads. `createNotification`
// resolves this inside its deferred `after()` insert, so those reads never sit on the
// request that raised the notification — and a failure here only means a plainer row.

import { createAdminClient } from '@/lib/supabase/admin';
import type { NotificationContext } from '@/lib/notifications/createNotification';

export interface ListingContextInput {
  /** The listing the notification is about, for its cover photo (and title if not given). */
  itemId?: string | null;
  /** The title as the producer has it (a contract's snapshot beats the live listing). */
  itemTitle?: string | null;
  /** The member whose action raised it; shown by their PUBLIC display name only. */
  actorId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
}

/**
 * A trade's context: the listing the trade was opened on (the counterpart's card, the
 * one that brought the two traders together) and the other trader. No amount — a
 * trade's sides are goods, and the room states their values.
 */
export function tradeContext(tradeId: string, actorId: string | null): () => Promise<NotificationContext> {
  return async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from('trades')
      .select('counterpart_item_id')
      .eq('id', tradeId)
      .maybeSingle();
    const itemId = (data as { counterpart_item_id: string | null } | null)?.counterpart_item_id ?? null;
    return listingContext({ itemId, actorId })();
  };
}

export function listingContext(input: ListingContextInput): () => Promise<NotificationContext> {
  return async () => {
    const admin = createAdminClient();
    const [item, actor] = await Promise.all([
      input.itemId
        ? admin.from('items').select('title, image_paths, currency').eq('id', input.itemId).maybeSingle()
        : Promise.resolve({ data: null }),
      input.actorId
        ? admin.from('public_profiles').select('display_name').eq('id', input.actorId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const itemRow = item.data as
      | { title: string | null; image_paths: string[] | null; currency: string | null }
      | null;
    const actorRow = actor.data as { display_name: string | null } | null;
    // A contract's own currency wins; otherwise the listing's, which is what an offer
    // on it is denominated in.
    const currency = input.currency ?? itemRow?.currency ?? null;
    return {
      subjectTitle: input.itemTitle?.trim() || itemRow?.title || null,
      imagePath: itemRow?.image_paths?.[0] ?? null,
      actorName: actorRow?.display_name?.trim() || null,
      amountCents: input.amountCents ?? null,
      currency: currency ? currency.toLowerCase() : null,
    };
  };
}
