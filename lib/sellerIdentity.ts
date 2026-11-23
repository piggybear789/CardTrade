import 'server-only';

// lib/sellerIdentity.ts
//
// Server-only projection of provider-approved merchant data into the narrow,
// buyer-safe seller identity shown before payment (Req 4.8-4.12). It never
// exposes contact, bank, document, credential, or compliance-note fields.

import {
  canReceiveFunds,
  sellerIdentityDisclosure,
  type SellerIdentityDisclosure,
} from '@/domain/orchestrator/merchantOnboarding';
import { chargesOnBehalfOfSeller } from '@/domain/payments/onBehalfOf';
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
 * - `disclosure-needed` — verified, but the seller has not yet agreed to their
 *   verified name being shown to a buyer (`merchant_identity_disclosure_consented_at`,
 *   Req 4.8-4.12). One tap (`allowSellerNameDisclosure`), not payout setup. Never
 *   reported as `identity-needed`, which would send an already-verified member back to
 *   a check they passed.
 * - `payout-setup-needed` — ONLY for a sale charged on behalf of the seller's own
 *   Connect account (a currency the platform does not settle in,
 *   `domain/payments/onBehalfOf.ts`), which Stripe cannot charge until that account is
 *   live. Every other sale is paid into the platform balance and waits there for the
 *   seller's payout setup (`SELLER_NOT_PAYABLE` at the drain), so payout setup is NOT
 *   asked for before the buyer pays.
 */
export type SellerPayReadiness =
  | {
      state: 'ready';
      identity: Pick<SellerIdentityDisclosure, 'version' | 'legalEntityName' | 'tradingName'>;
    }
  | { state: 'identity-needed' }
  | { state: 'disclosure-needed' }
  | { state: 'payout-setup-needed' };

export async function readSellerPayReadiness(
  sellerId: string,
  /** The sale's currency, when known: it decides whether Stripe needs payouts live first. */
  currency?: string | null,
): Promise<SellerPayReadiness> {
  const merchant = await createSupabaseMerchantRepository().loadMerchant(sellerId);
  const disclosure = sellerIdentityDisclosure(merchant);
  if (disclosure) {
    if (currency && chargesOnBehalfOfSeller(currency) && !canReceiveFunds(merchant)) {
      return { state: 'payout-setup-needed' };
    }
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
  return gate.satisfied ? { state: 'disclosure-needed' } : { state: 'identity-needed' };
}
