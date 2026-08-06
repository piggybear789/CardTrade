// domain/orchestrator/supabaseMerchantRepository.ts
//
// Production wiring of the merchant onboarding data-access seam. Backed by the
// service-role admin client because every sub-merchant column is
// provider-controlled: 0005_merchant_onboarding.sql revokes column UPDATE on
// them from `authenticated`, so these writes can only happen here (or in the
// webhook handler).
//
// Kept out of `merchantOnboarding.ts` so that core stays importable by the
// domain tests without `server-only`/Supabase.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import {
  createMerchantOnboardingOrchestrator,
  type MerchantOnboardingDeps,
  type MerchantOnboardingOrchestrator,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantUpdate,
} from './merchantOnboarding';
import type { PaymentService } from '../services/types';

type AdminClient = ReturnType<typeof createAdminClient>;

/** The `profiles` sub-merchant columns this repository reads. */
const MERCHANT_COLUMNS =
  'id, merchant_ref, merchant_status, merchant_compliance_status, merchant_live_enabled, ' +
  'merchant_transactions_enabled, merchant_settlements_enabled, merchant_notes, ' +
  'merchant_legal_entity_name, merchant_trading_name, merchant_registration_number, ' +
  'merchant_organisation_type, merchant_identity_version, ' +
  'merchant_identity_disclosure_consented_at, merchant_identity_verified_at';

interface MerchantRow {
  id: string;
  merchant_ref: string | null;
  merchant_status: MerchantRecord['merchantStatus'];
  merchant_compliance_status: string | null;
  merchant_live_enabled: boolean;
  merchant_transactions_enabled: boolean;
  merchant_settlements_enabled: boolean;
  merchant_notes: string | null;
  merchant_legal_entity_name: string | null;
  merchant_trading_name: string | null;
  merchant_registration_number: string | null;
  merchant_organisation_type: string | null;
  merchant_identity_version: string | null;
  merchant_identity_disclosure_consented_at: string | null;
  merchant_identity_verified_at: string | null;
}

/** Map a DB row (snake_case) to the domain {@link MerchantRecord}. */
function toMerchantRecord(row: MerchantRow): MerchantRecord {
  return {
    profileId: row.id,
    merchantRef: row.merchant_ref,
    merchantStatus: row.merchant_status,
    complianceStatus: row.merchant_compliance_status,
    liveEnabled: row.merchant_live_enabled,
    transactionsEnabled: row.merchant_transactions_enabled,
    settlementsEnabled: row.merchant_settlements_enabled,
    notes: row.merchant_notes,
    legalEntityName: row.merchant_legal_entity_name,
    tradingName: row.merchant_trading_name,
    registrationNumber: row.merchant_registration_number,
    organisationType: row.merchant_organisation_type,
    identityVersion: row.merchant_identity_version,
    identityDisclosureConsentedAt: row.merchant_identity_disclosure_consented_at,
    identityVerifiedAt: row.merchant_identity_verified_at,
  };
}

/** Build a {@link MerchantRepository} backed by the Supabase admin client. */
export function createSupabaseMerchantRepository(
  client: AdminClient = createAdminClient(),
): MerchantRepository {
  return {
    async loadMerchant(profileId: string): Promise<MerchantRecord | null> {
      const { data } = await client
        .from('profiles')
        .select(MERCHANT_COLUMNS)
        .eq('id', profileId)
        .maybeSingle();
      return data ? toMerchantRecord(data as unknown as MerchantRow) : null;
    },

    async updateMerchant(update: MerchantUpdate): Promise<void> {
      // Undefined fields are omitted so a partial update leaves them unchanged.
      const patch: TablesUpdate<'profiles'> = { merchant_status: update.merchantStatus };
      if (update.merchantRef !== undefined) patch.merchant_ref = update.merchantRef;
      if (update.complianceStatus !== undefined) {
        patch.merchant_compliance_status = update.complianceStatus;
      }
      if (update.liveEnabled !== undefined) patch.merchant_live_enabled = update.liveEnabled;
      if (update.transactionsEnabled !== undefined) {
        patch.merchant_transactions_enabled = update.transactionsEnabled;
      }
      if (update.settlementsEnabled !== undefined) {
        patch.merchant_settlements_enabled = update.settlementsEnabled;
      }
      if (update.notes !== undefined) patch.merchant_notes = update.notes;
      if (update.legalEntityName !== undefined) {
        patch.merchant_legal_entity_name = update.legalEntityName;
      }
      if (update.tradingName !== undefined) patch.merchant_trading_name = update.tradingName;
      if (update.registrationNumber !== undefined) {
        patch.merchant_registration_number = update.registrationNumber;
      }
      if (update.organisationType !== undefined) {
        patch.merchant_organisation_type = update.organisationType;
      }
      if (update.identityVersion !== undefined) {
        patch.merchant_identity_version = update.identityVersion;
      }
      if (update.identityDisclosureConsentedAt !== undefined) {
        patch.merchant_identity_disclosure_consented_at = update.identityDisclosureConsentedAt;
      }
      if (update.identityVerifiedAt !== undefined) {
        patch.merchant_identity_verified_at = update.identityVerifiedAt;
      }
      if (update.submittedAt !== undefined) patch.merchant_submitted_at = update.submittedAt;
      if (update.decisionAt !== undefined) patch.merchant_decision_at = update.decisionAt;

      const { error } = await client.from('profiles').update(patch).eq('id', update.profileId);
      // Loudly, on purpose. This write is what remembers a provider account that
      // has ALREADY been created, so discarding the error (as this did) reports
      // successful onboarding while leaving a live connected account with no
      // reference to it anywhere. The account cannot then be reached or recreated,
      // and the Member is stuck. A throw here surfaces as SUBMISSION_FAILED with
      // the reference in the detail, which is recoverable.
      if (error) {
        throw new Error(
          `Failed to persist merchant state for profile ${update.profileId}` +
            `${update.merchantRef ? ` (merchantRef ${update.merchantRef})` : ''}: ${error.message}`,
        );
      }
    },

    async findProfileIdByMerchantRef(merchantRef: string): Promise<string | null> {
      const { data } = await client
        .from('profiles')
        .select('id')
        .eq('merchant_ref', merchantRef)
        .maybeSingle();
      return data ? (data as { id: string }).id : null;
    },
  };
}

/**
 * Default production onboarding orchestrator: a Supabase-backed repository plus
 * the injected payment service seam.
 */
export function createDefaultMerchantOnboardingOrchestrator(
  deps: { payments: PaymentService } & Partial<Pick<MerchantOnboardingDeps, 'repository' | 'now'>>,
): MerchantOnboardingOrchestrator {
  return createMerchantOnboardingOrchestrator({
    repository: deps.repository ?? createSupabaseMerchantRepository(),
    payments: deps.payments,
    now: deps.now,
  });
}
