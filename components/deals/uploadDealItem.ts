// components/deals/uploadDealItem.ts
//
// Browser-side: photos go to Storage, then the action receives object paths.
// Same boundary as TradeOfferForm — never send File bytes through a Server Action.

import type { PrivateDealItemInput } from '@/lib/actions/dealInvites';
import { uploadItemImages } from '@/lib/storage/uploadItemImages';
import type { UnlistedItemDraft } from '@/components/trade/UnlistedItemDialog';

export async function pathsFromUnlistedDraft(
  draft: UnlistedItemDraft,
  fmvCents: number,
): Promise<{ ok: true; item: PrivateDealItemInput } | { ok: false; message: string }> {
  const uploaded = await uploadItemImages(draft.images);
  if (!uploaded.ok) return uploaded;
  return {
    ok: true,
    item: {
      description: draft.description,
      category: draft.category,
      condition: draft.condition,
      fmvCents,
      images: uploaded.paths,
    },
  };
}
