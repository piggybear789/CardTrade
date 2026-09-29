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
import { readIdentityGate } from '@/lib/identityGate';

/** Load the current approved disclosure for a seller, or null when unavailable. */
export async function loadSellerIdentityDisclosure(
  sellerId: string,
): Promise<SellerIdentityDisclosure | null> {
  const merchant = await createSupabaseMerchantRepository().loadMerchant(sellerId);
  return sellerIdentityDisclosure(merchant);
}

/**
 * Whether a buyer can pay this seller yet, and if not, what the seller still owes.
 *
 * - `ready` — a buyer-safe disclosure exists; carries the name the Buyer confirms.
 * - `identity-needed` — Stripe Identity is not done.
 * - `payout-setup-needed` — verified, but payout setup (the only writer of the
 *   disclosure consent) is not finished. Never reported as `identity-needed`, which
 *   would send an already-verified member back to a check they passed.
 */
export type SellerPayReadiness =
  | {
      state: 'ready';
      identity: Pick<SellerIdentityDisclosure, 'version' | 'legalEntityName' | 'tradingName'>;
    }
  | { state: 'identity-needed' }
  | { state: 'payout-setup-needed' };

export async function readSellerPayReadiness(sellerId: string): Promise<SellerPayReadiness> {
  const disclosure = await loadSellerIdentityDisclosure(sellerId);
  if (disclosure) {
    return {
      state: 'ready',
      identity: {
        version: disclosure.version,
        legalEntityName: disclosure.legalEntityName,
        tradingName: disclosure.tradingName,
      },
    };
  }
  const gate = await readIdentityGate(sellerId);
  return gate.satisfied ? { state: 'payout-setup-needed' } : { state: 'identity-needed' };
}
