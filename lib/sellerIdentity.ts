import 'server-only';

// lib/sellerIdentity.ts
//
// Server-only projection of provider-approved merchant data into the narrow,
// buyer-safe seller identity shown before payment (Req 4.8-4.12). It never
// exposes contact, bank, document, credential, or compliance-note fields.

import {
  sellerIdentityDisclosure,
  type SellerIdentityDisclosure,
} from '@/domain/orchestrator/merchantOnboarding';
import { createSupabaseMerchantRepository } from '@/domain/orchestrator/supabaseMerchantRepository';

/** Load the current approved disclosure for a seller, or null when unavailable. */
export async function loadSellerIdentityDisclosure(
  sellerId: string,
): Promise<SellerIdentityDisclosure | null> {
  const merchant = await createSupabaseMerchantRepository().loadMerchant(sellerId);
  return sellerIdentityDisclosure(merchant);
}
