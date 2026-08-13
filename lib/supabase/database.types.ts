// CardTrade — Supabase database types
//
// HAND-AUTHORED to faithfully mirror the SQL migrations in
// `supabase/migrations/` (0001_schema.sql, 0002_rls.sql, 0003_realtime.sql).
//
// This environment has no linked/running Supabase instance, so the standard
// generator (`supabase gen types typescript`) cannot be run here. The shape
// below intentionally matches the output that
//   supabase gen types typescript --local > lib/supabase/database.types.ts
// (or `--project-id <ref>`) produces, so it can be regenerated later to match
// once a Supabase instance is linked — with no changes required at call sites.
//
// Type mapping used (Postgres -> TypeScript):
//   uuid          -> string
//   text          -> string
//   text[]        -> string[]
//   bigint        -> number
//   integer       -> number
//   boolean       -> boolean
//   timestamptz   -> string
//   jsonb         -> Json
//   enum          -> the corresponding string-literal union (see Enums below)
//
// Nullability follows the migration: columns without NOT NULL (and without a
// server-side default that always populates them) are `T | null` in Row.
// Insert marks columns optional when they have a default or are nullable.
// Update marks every column optional.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // CardTrade lives in its own `cardtrade` Postgres schema (isolated from the
  // shared instance's `public` schema). The Supabase clients are configured
  // with `db: { schema: 'cardtrade' }` so `.from(...)` resolves here.
  cardtrade: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          contact_email: string;
          // The retired payer gate lived here: `kyc_status`, `kyc_reason`,
          // `identity_session_id` and the `identity_verified_*` columns. All were
          // dropped by migration 0043. Verification is the Identity_Gate —
          // `merchant_status` with `merchant_settlements_enabled` — and the only
          // identity held is `merchant_legal_entity_name`.
          /** Stripe Customer id (`cus_...`), platform-scoped. */
          payer_id: string | null;
          payment_token_type: 'credit-card' | 'bank-account' | null;
          payment_method_label: string | null;
          payment_source_id: string | null;
          merchant_ref: string | null;
          merchant_status: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status: string | null;
          merchant_live_enabled: boolean;
          merchant_transactions_enabled: boolean;
          merchant_settlements_enabled: boolean;
          merchant_submitted_at: string | null;
          merchant_decision_at: string | null;
          merchant_notes: string | null;
          merchant_legal_entity_name: string | null;
          merchant_trading_name: string | null;
          merchant_registration_number: string | null;
          merchant_organisation_type: string | null;
          merchant_identity_version: string | null;
          merchant_identity_disclosure_consented_at: string | null;
          merchant_identity_verified_at: string | null;
          rating: number | null;
          rating_count: number;
          is_admin: boolean;
          /** Staff capability: may arbitrate disputes (0047). Not member-writable. */
          is_support: boolean;
          onboarding_completed_at: string | null;
          /**
           * ISO 3166-1 alpha-2 jurisdiction the member transacts in (0065).
           *
           * Read by the contract guards through `checkRegionCompatibility`, and it
           * must agree with the member's Stripe Connect account country — a
           * transfer to an account registered elsewhere fails. Set at onboarding
           * and NEVER from an IP address; see `domain/region/regions.ts` for why
           * the browse region and this are separate values.
           */
          region_code: string | null;

          /**
           * Storage object path in the `profile-images` bucket, or null (0066).
           *
           * A PATH, never a URL — `avatarUrl()` in `lib/format.ts` resolves it.
           * Self-chosen and unverified, so it is never identity: that is the
           * Identity_Gate plus `merchant_legal_entity_name`.
           */
          avatar_path: string | null;

          /**
           * Stripe Identity check state (0069). THIS is the Identity_Gate.
           *
           * Provider-controlled: `authenticated` may SELECT it but holds no UPDATE
           * grant, so only the Identity webhook or a server read-back writes it.
           */
          identity_check_status: Database['cardtrade']['Enums']['identity_check_status'];
          identity_check_session_id: string | null;
          identity_check_verified_at: string | null;
          identity_check_name: string | null;
          fraud_banned_at: string | null;
          fraud_banned_by: string | null;
          fraud_ban_trade_id: string | null;
          /** Optional social media handles keyed by platform slug (0085). */
          social_links: Record<string, string> | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          contact_email: string;
          payer_id?: string | null;
          payment_token_type?: 'credit-card' | 'bank-account' | null;
          payment_method_label?: string | null;
          payment_source_id?: string | null;
          merchant_ref?: string | null;
          merchant_status?: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status?: string | null;
          merchant_live_enabled?: boolean;
          merchant_transactions_enabled?: boolean;
          merchant_settlements_enabled?: boolean;
          merchant_submitted_at?: string | null;
          merchant_decision_at?: string | null;
          merchant_notes?: string | null;
          merchant_legal_entity_name?: string | null;
          merchant_trading_name?: string | null;
          merchant_registration_number?: string | null;
          merchant_organisation_type?: string | null;
          merchant_identity_version?: string | null;
          merchant_identity_disclosure_consented_at?: string | null;
          merchant_identity_verified_at?: string | null;
          rating?: number | null;
          rating_count?: number;
          is_admin?: boolean;
          is_support?: boolean;
          onboarding_completed_at?: string | null;
          region_code?: string | null;

          avatar_path?: string | null;


          identity_check_status?: Database['cardtrade']['Enums']['identity_check_status'];

          identity_check_session_id?: string | null;

          identity_check_verified_at?: string | null;

          identity_check_name?: string | null;
          fraud_banned_at?: string | null;
          fraud_banned_by?: string | null;
          fraud_ban_trade_id?: string | null;
          social_links?: Record<string, string> | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          contact_email?: string;
          payer_id?: string | null;
          payment_token_type?: 'credit-card' | 'bank-account' | null;
          payment_method_label?: string | null;
          payment_source_id?: string | null;
          merchant_ref?: string | null;
          merchant_status?: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status?: string | null;
          merchant_live_enabled?: boolean;
          merchant_transactions_enabled?: boolean;
          merchant_settlements_enabled?: boolean;
          merchant_submitted_at?: string | null;
          merchant_decision_at?: string | null;
          merchant_notes?: string | null;
          merchant_legal_entity_name?: string | null;
          merchant_trading_name?: string | null;
          merchant_registration_number?: string | null;
          merchant_organisation_type?: string | null;
          merchant_identity_version?: string | null;
          merchant_identity_disclosure_consented_at?: string | null;
          merchant_identity_verified_at?: string | null;
          rating?: number | null;
          rating_count?: number;
          is_admin?: boolean;
          is_support?: boolean;
          onboarding_completed_at?: string | null;
          region_code?: string | null;

          avatar_path?: string | null;


          identity_check_status?: Database['cardtrade']['Enums']['identity_check_status'];

          identity_check_session_id?: string | null;

          identity_check_verified_at?: string | null;

          identity_check_name?: string | null;
          fraud_banned_at?: string | null;
          fraud_banned_by?: string | null;
          fraud_ban_trade_id?: string | null;
          social_links?: Record<string, string> | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      items: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          fmv_cents: number;
          status: Database['cardtrade']['Enums']['item_status'];
          /**
           * SINGLE = one physical object, reserved by its one live contract.
           * SHOPFRONT = a browsable inventory many buyers contract against at
           * once; never reserved, never sold (0064).
           */
          listing_kind: Database['cardtrade']['Enums']['listing_kind'];
          /** When the owner closed a SHOPFRONT. SINGLE listings use status. */
          closed_at: string | null;
          image_paths: string[];
          hidden: boolean;
          seller_rating: number | null;
          /**
           * Denormalised Identity_Gate for the owner, kept fresh by triggers (0041).
           * The only verification flag on items: the duplicate `seller_verified`
           * column was dropped in 0049.
           */
          seller_identity_verified: boolean;
          location_label: string | null;
          location_place_id: string | null;
          location_lat: number | null;
          location_lng: number | null;
          location_precision: 'suburb' | 'exact' | null;
          /**
           * ISO 3166-1 alpha-2 of the listing pin, uppercase (0065). Scopes the
           * catalog by region.
           *
           * Null for listings created before 0065 and for the free-text place
           * fallback, which resolves no country — `searchCatalog` treats null as
           * unscoped and always visible rather than hiding it from everyone. This
           * is where the GOODS are, NOT the seller's trading region: see
           * `profiles.region_code`.
           */
          location_country_code: string | null;
          /**
           * ISO 4217 currency `fmv_cents` is denominated in (0068), lowercase.
           *
           * Derived from the OWNER's region by the `items_set_currency` trigger, not
           * from `location_country_code` — the listing's country is where the goods
           * are, the currency is what the owner sells in.
           */
          currency: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          fmv_cents: number;
          status?: Database['cardtrade']['Enums']['item_status'];
          listing_kind?: Database['cardtrade']['Enums']['listing_kind'];
          closed_at?: string | null;
          image_paths: string[];
          hidden?: boolean;
          seller_rating?: number | null;
          seller_identity_verified?: boolean;
          location_label?: string | null;
          location_place_id?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          location_precision?: 'suburb' | 'exact' | null;
          location_country_code?: string | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string;
          category?: string;
          condition?: string;
          fmv_cents?: number;
          status?: Database['cardtrade']['Enums']['item_status'];
          listing_kind?: Database['cardtrade']['Enums']['listing_kind'];
          closed_at?: string | null;
          image_paths?: string[];
          hidden?: boolean;
          seller_rating?: number | null;
          seller_identity_verified?: boolean;
          location_label?: string | null;
          location_place_id?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          location_precision?: 'suburb' | 'exact' | null;
          location_country_code?: string | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'items_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      trades: {
        Row: {
          id: string;
          initiator_id: string;
          counterpart_id: string;
          initiator_item_id: string;
          counterpart_item_id: string;
          state: Database['cardtrade']['Enums']['trade_state'];
          version: number;
          initiator_shipped_at: string | null;
          counterpart_shipped_at: string | null;
          /**
           * Dispatch deadline for DELIVERY trades (0039). Null for IN_PERSON,
           * which is inspected on the spot and never races the ~7-day card
           * authorisation window.
           */
          shipping_deadline_at: string | null;
          shipping_warned_at: string | null;
          /** Deadline breached. Advisory — the trade is not cancelled. */
          shipping_overdue_at: string | null;
          initiator_tracking_carrier: string | null;
          initiator_tracking_number: string | null;
          initiator_tracking_url: string | null;
          counterpart_tracking_carrier: string | null;
          counterpart_tracking_number: string | null;
          counterpart_tracking_url: string | null;
          /**
           * Carrier state per outbound parcel (0057). Normalised by the tracking
           * seam, so a delivery is the carrier's word and not the sender's.
           */
          initiator_tracking_status: string | null;
          counterpart_tracking_status: string | null;
          initiator_carrier_delivered_at: string | null;
          counterpart_carrier_delivered_at: string | null;
          initiator_received_at: string | null;
          counterpart_received_at: string | null;
          initiator_accepted_at: string | null;
          counterpart_accepted_at: string | null;
          /**
           * Face-to-face handover confirmations (0057). Both move the trade to
           * INSPECTION, never straight to COMPLETED: confirming says "we met and
           * swapped", not "I am satisfied".
           */
          initiator_handover_confirmed_at: string | null;
          counterpart_handover_confirmed_at: string | null;
          /**
           * Presence of a protected postal address (0057). Booleans only — the
           * address itself lives in `trade_delivery_details`, because this table IS
           * Realtime-published.
           */
          initiator_delivery_address_configured: boolean;
          counterpart_delivery_address_configured: boolean;
          /** 72h inspection window (0057). Shorter than a Cash_Sale's 7 days
           *  because collateral is a ~7-day card authorisation. */
          inspection_deadline_at: string | null;
          inspection_warned_at: string | null;
          /** Completed by the inspection timeout rather than by both traders. */
          auto_completed: boolean;
          dispute_raised_by: string | null;
          disputed_against: string | null;
          disputed_at: string | null;
          /** The disputing trader's own words (0083). Mirrors cash_sales.dispute_reason. */
          dispute_reason: string | null;
          fraud_victim_id: string | null;
          /** Fraud ALLEGED by a trader (0046). Not a finding: see fraud_victim_id. */
          fraud_claimed_by: string | null;
          fraud_claimed_against: string | null;
          fraud_claim_reason: string | null;
          fraud_claimed_at: string | null;
          cash_amount_cents: number;
          /**
           * ISO 4217 currency the collateral, fees and any cash leg are denominated
           * in (0068), lowercase.
           *
           * There is exactly one because `checkRegionCompatibility` has already
           * established that both traders are in the same region before a trade can
           * be agreed. Set by the `trades_set_currency` trigger from the initiator.
           */
          currency: string;
          cash_direction: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          delivery_details: string | null;
          delivery_cost_cents: number | null;
          friction_tax_return_cents: number | null;
          friction_tax_platform_cents: number | null;
          /**
           * Payout of the return-shipping share (0075). `paid_at` NULL with
           * `friction_tax_return_cents` set means the money is captured but still owed.
           */
          friction_tax_return_nonce: string | null;
          friction_tax_return_paid_at: string | null;
          friction_tax_return_error: string | null;
          partial_capture_failed: boolean;
          return_overdue: boolean;
          full_capture_failed: boolean;
          manual_reconciliation: boolean;
          created_at: string;
          updated_at: string;
          conversation_id: string | null;
          /**
           * Negotiated terms (0052). A Trade now exists from the first offer, so
           * these carry the negotiation that `trade_proposals` used to hold.
           */
          terms_version: number;
          terms_updated_at: string | null;
          /** Equal to `terms_version` means this trader accepts the current terms. */
          initiator_terms_accepted_version: number | null;
          counterpart_terms_accepted_version: number | null;
          initiator_terms_accepted_at: string | null;
          counterpart_terms_accepted_at: string | null;
          /** The opening note, and each counter's note. */
          offer_message: string | null;
          /**
           * What the proposer SAYS their side is worth. Self-declared, so it never
           * sizes a bond — see the column comment in 0015 and
           * `domain/trade/tradeSideValues.ts`, which is where side values come from.
           */
          declared_value_cents: number | null;
          /**
           * What the counterpart is handing over, in prose, when their listing is a
           * SHOPFRONT and so cannot say (0081). Null on a SINGLE listing. Part of the
           * terms: revising it voids both acceptances.
           */
          counterpart_goods_description: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          initiator_id: string;
          counterpart_id: string;
          initiator_item_id: string;
          counterpart_item_id: string;
          state?: Database['cardtrade']['Enums']['trade_state'];
          version?: number;
          terms_version?: number;
          terms_updated_at?: string | null;
          initiator_terms_accepted_version?: number | null;
          counterpart_terms_accepted_version?: number | null;
          initiator_terms_accepted_at?: string | null;
          counterpart_terms_accepted_at?: string | null;
          offer_message?: string | null;
          declared_value_cents?: number | null;
          counterpart_goods_description?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          initiator_shipped_at?: string | null;
          counterpart_shipped_at?: string | null;
          shipping_deadline_at?: string | null;
          shipping_warned_at?: string | null;
          shipping_overdue_at?: string | null;
          initiator_tracking_carrier?: string | null;
          initiator_tracking_number?: string | null;
          initiator_tracking_url?: string | null;
          counterpart_tracking_carrier?: string | null;
          counterpart_tracking_number?: string | null;
          counterpart_tracking_url?: string | null;
          initiator_tracking_status?: string | null;
          counterpart_tracking_status?: string | null;
          initiator_carrier_delivered_at?: string | null;
          counterpart_carrier_delivered_at?: string | null;
          initiator_received_at?: string | null;
          counterpart_received_at?: string | null;
          initiator_accepted_at?: string | null;
          counterpart_accepted_at?: string | null;
          initiator_handover_confirmed_at?: string | null;
          counterpart_handover_confirmed_at?: string | null;
          initiator_delivery_address_configured?: boolean;
          counterpart_delivery_address_configured?: boolean;
          inspection_deadline_at?: string | null;
          inspection_warned_at?: string | null;
          auto_completed?: boolean;
          dispute_raised_by?: string | null;
          disputed_against?: string | null;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          fraud_victim_id?: string | null;
          fraud_claimed_by?: string | null;
          fraud_claimed_against?: string | null;
          fraud_claim_reason?: string | null;
          fraud_claimed_at?: string | null;
          cash_amount_cents?: number;
          currency?: string;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          friction_tax_return_cents?: number | null;
          friction_tax_platform_cents?: number | null;
          friction_tax_return_nonce?: string | null;
          friction_tax_return_paid_at?: string | null;
          friction_tax_return_error?: string | null;
          partial_capture_failed?: boolean;
          return_overdue?: boolean;
          full_capture_failed?: boolean;
          manual_reconciliation?: boolean;
          created_at?: string;
          updated_at?: string;
          conversation_id?: string | null;
        };
        Update: {
          id?: string;
          initiator_id?: string;
          counterpart_id?: string;
          initiator_item_id?: string;
          counterpart_item_id?: string;
          cash_amount_cents?: number;
          currency?: string;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          state?: Database['cardtrade']['Enums']['trade_state'];
          version?: number;
          terms_version?: number;
          terms_updated_at?: string | null;
          initiator_terms_accepted_version?: number | null;
          counterpart_terms_accepted_version?: number | null;
          initiator_terms_accepted_at?: string | null;
          counterpart_terms_accepted_at?: string | null;
          offer_message?: string | null;
          declared_value_cents?: number | null;
          counterpart_goods_description?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          initiator_shipped_at?: string | null;
          counterpart_shipped_at?: string | null;
          shipping_deadline_at?: string | null;
          shipping_warned_at?: string | null;
          shipping_overdue_at?: string | null;
          initiator_tracking_carrier?: string | null;
          initiator_tracking_number?: string | null;
          initiator_tracking_url?: string | null;
          counterpart_tracking_carrier?: string | null;
          counterpart_tracking_number?: string | null;
          counterpart_tracking_url?: string | null;
          initiator_tracking_status?: string | null;
          counterpart_tracking_status?: string | null;
          initiator_carrier_delivered_at?: string | null;
          counterpart_carrier_delivered_at?: string | null;
          initiator_received_at?: string | null;
          counterpart_received_at?: string | null;
          initiator_accepted_at?: string | null;
          counterpart_accepted_at?: string | null;
          initiator_handover_confirmed_at?: string | null;
          counterpart_handover_confirmed_at?: string | null;
          initiator_delivery_address_configured?: boolean;
          counterpart_delivery_address_configured?: boolean;
          inspection_deadline_at?: string | null;
          inspection_warned_at?: string | null;
          auto_completed?: boolean;
          dispute_raised_by?: string | null;
          disputed_against?: string | null;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          conversation_id?: string | null;
          fraud_victim_id?: string | null;
          fraud_claimed_by?: string | null;
          fraud_claimed_against?: string | null;
          fraud_claim_reason?: string | null;
          fraud_claimed_at?: string | null;
          friction_tax_return_cents?: number | null;
          friction_tax_platform_cents?: number | null;
          friction_tax_return_nonce?: string | null;
          friction_tax_return_paid_at?: string | null;
          friction_tax_return_error?: string | null;
          partial_capture_failed?: boolean;
          return_overdue?: boolean;
          full_capture_failed?: boolean;
          manual_reconciliation?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trades_initiator_id_fkey';
            columns: ['initiator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_counterpart_id_fkey';
            columns: ['counterpart_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_initiator_item_id_fkey';
            columns: ['initiator_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_counterpart_item_id_fkey';
            columns: ['counterpart_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_dispute_raised_by_fkey';
            columns: ['dispute_raised_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_disputed_against_fkey';
            columns: ['disputed_against'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_fraud_victim_id_fkey';
            columns: ['fraud_victim_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cash_sales: {
        Row: {
          id: string;
          item_id: string;
          buyer_id: string;
          seller_id: string;
          amount_cents: number;
          agreed_price_cents: number;
          platform_fee_cents: number;
          status: Database['cardtrade']['Enums']['cash_sale_status'];
          version: number;
          transfer_id: string | null;
          payment_nonce: string | null;
          payment_requested_at: string | null;
          payment_settled_at: string | null;
          item_title: string;
          item_description: string | null;
          item_condition: string | null;
          item_image_paths: string[];
          fulfillment_method: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents: number;
          shipping_notes: string | null;
          /** Non-sensitive indicator; raw residential address is in the protected table. */
          delivery_address_configured: boolean;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          terms_version: number;
          terms_updated_at: string | null;
          buyer_terms_accepted_version: number | null;
          seller_terms_accepted_version: number | null;
          buyer_terms_accepted_at: string | null;
          seller_terms_accepted_at: string | null;
          tracking_carrier: string | null;
          tracking_number: string | null;
          tracking_url: string | null;
          tracking_status: string | null;
          shipped_at: string | null;
          received_at: string | null;
          inspection_accepted_at: string | null;
          carrier_delivered_at: string | null;
          /** Return-conditional refund leg (0088). Separate from the outbound
              columns above so a return event cannot overwrite the original
              delivery record that inspection and arbitration depend on. */
          return_tracking_carrier: string | null;
          return_tracking_number: string | null;
          return_tracking_status: string | null;
          return_tracking_url: string | null;
          return_carrier_delivered_at: string | null;
          return_shipped_at: string | null;
          return_deadline_at: string | null;
          return_lapsed_at: string | null;
      return_warned_at: string | null;
          return_disputed_at: string | null;
          return_dispute_reason: string | null;          inspection_deadline_at: string | null;
          auto_completed: boolean;
          buyer_handover_confirmed_at: string | null;
          seller_handover_confirmed_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          disputed_at: string | null;
          disputed_by: string | null;
          dispute_reason: string | null;
          dispute_conversation_id: string | null;
          conversation_id: string | null;
          seller_identity_version: string | null;
          seller_legal_entity_name: string | null;
          seller_trading_name: string | null;
          seller_registration_number: string | null;
          seller_organisation_type: string | null;
          seller_identity_verified_at: string | null;
          buyer_seller_identity_confirmed_at: string | null;
          /** Release leg of escrow (0038). FAILED = platform holds seller funds. */
          seller_payout_status: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          seller_payout_ref: string | null;
          /** Stable idempotency key; never regenerated on retry. */
          seller_payout_nonce: string | null;
          seller_payout_due_at: string | null;
          seller_payout_at: string | null;
          seller_payout_attempts: number;
          seller_payout_error: string | null;
          /** Dispute resolution (0044). Null until an operator decides. */
          dispute_resolution: 'REFUND_BUYER' | 'PARTIAL_REFUND' | 'RELEASE_SELLER' | null;
          dispute_resolved_at: string | null;
          dispute_resolved_by: string | null;
          /**
           * True when opened against a SHOPFRONT listing (0064). Exempts the row
           * from `cash_sales_one_active_per_item` and means `agreed_price_cents`
           * is derived from `cash_sale_items` rather than proposed directly.
           */
          from_shopfront: boolean;
          /**
           * ISO 4217 currency EVERY `*_cents` column on this row is denominated in
           * (0068), lowercase.
           *
           * Frozen at creation from the seller's region by the `cash_sales_set_currency`
           * trigger. Deliberately stored rather than re-derived from the seller's
           * profile: a contract's denomination must not move if that profile is later
           * corrected, exactly like the seller identity snapshot beside it.
           */
          currency: string;
          /** Returned to the buyer, in cents. Subtracted from the seller release. */
          refund_cents: number;
          refund_status: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          refund_ref: string | null;
          refund_nonce: string | null;
          refund_error: string | null;
          refund_attempts: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          buyer_id: string;
          seller_id: string;
          amount_cents: number;
          agreed_price_cents: number;
          platform_fee_cents: number;
          status?: Database['cardtrade']['Enums']['cash_sale_status'];
          version?: number;
          transfer_id?: string | null;
          payment_nonce?: string | null;
          payment_requested_at?: string | null;
          payment_settled_at?: string | null;
          item_title: string;
          item_description?: string | null;
          item_condition?: string | null;
          item_image_paths?: string[];
          fulfillment_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents?: number;
          shipping_notes?: string | null;
          delivery_address_configured?: boolean;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          terms_version?: number;
          terms_updated_at?: string | null;
          buyer_terms_accepted_version?: number | null;
          seller_terms_accepted_version?: number | null;
          buyer_terms_accepted_at?: string | null;
          seller_terms_accepted_at?: string | null;
          tracking_carrier?: string | null;
          tracking_number?: string | null;
          tracking_url?: string | null;
          tracking_status?: string | null;
          shipped_at?: string | null;
          received_at?: string | null;
          inspection_accepted_at?: string | null;
          carrier_delivered_at?: string | null;
          return_tracking_carrier?: string | null;
          return_tracking_number?: string | null;
          return_tracking_status?: string | null;
          return_tracking_url?: string | null;
          return_carrier_delivered_at?: string | null;
          return_shipped_at?: string | null;
          return_deadline_at?: string | null;
          return_lapsed_at?: string | null;
      return_warned_at?: string | null;
          return_disputed_at?: string | null;
          return_dispute_reason?: string | null;          inspection_deadline_at?: string | null;
          auto_completed?: boolean;
          buyer_handover_confirmed_at?: string | null;
          seller_handover_confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          disputed_at?: string | null;
          disputed_by?: string | null;
          dispute_reason?: string | null;
          dispute_conversation_id?: string | null;
          conversation_id?: string | null;
          seller_identity_version?: string | null;
          seller_legal_entity_name?: string | null;
          seller_trading_name?: string | null;
          seller_registration_number?: string | null;
          seller_organisation_type?: string | null;
          seller_identity_verified_at?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          seller_payout_status?: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          seller_payout_ref?: string | null;
          seller_payout_nonce?: string | null;
          seller_payout_due_at?: string | null;
          seller_payout_at?: string | null;
          seller_payout_attempts?: number;
          seller_payout_error?: string | null;
          dispute_resolution?: 'REFUND_BUYER' | 'PARTIAL_REFUND' | 'RELEASE_SELLER' | null;
          dispute_resolved_at?: string | null;
          dispute_resolved_by?: string | null;
          refund_cents?: number;
          refund_status?: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          refund_ref?: string | null;
          refund_nonce?: string | null;
          refund_error?: string | null;
          refund_attempts?: number;
          from_shopfront?: boolean;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          buyer_id?: string;
          seller_id?: string;
          amount_cents?: number;
          agreed_price_cents?: number;
          platform_fee_cents?: number;
          status?: Database['cardtrade']['Enums']['cash_sale_status'];
          version?: number;
          transfer_id?: string | null;
          payment_nonce?: string | null;
          payment_requested_at?: string | null;
          payment_settled_at?: string | null;
          item_title?: string;
          item_description?: string | null;
          item_condition?: string | null;
          item_image_paths?: string[];
          fulfillment_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents?: number;
          shipping_notes?: string | null;
          delivery_address_configured?: boolean;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          terms_version?: number;
          terms_updated_at?: string | null;
          buyer_terms_accepted_version?: number | null;
          seller_terms_accepted_version?: number | null;
          buyer_terms_accepted_at?: string | null;
          seller_terms_accepted_at?: string | null;
          tracking_carrier?: string | null;
          tracking_number?: string | null;
          tracking_url?: string | null;
          tracking_status?: string | null;
          shipped_at?: string | null;
          received_at?: string | null;
          inspection_accepted_at?: string | null;
          carrier_delivered_at?: string | null;
          return_tracking_carrier?: string | null;
          return_tracking_number?: string | null;
          return_tracking_status?: string | null;
          return_tracking_url?: string | null;
          return_carrier_delivered_at?: string | null;
          return_shipped_at?: string | null;
          return_deadline_at?: string | null;
          return_lapsed_at?: string | null;
      return_warned_at?: string | null;
          return_disputed_at?: string | null;
          return_dispute_reason?: string | null;          inspection_deadline_at?: string | null;
          auto_completed?: boolean;
          buyer_handover_confirmed_at?: string | null;
          seller_handover_confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          disputed_at?: string | null;
          disputed_by?: string | null;
          dispute_reason?: string | null;
          dispute_conversation_id?: string | null;
          conversation_id?: string | null;
          seller_identity_version?: string | null;
          seller_legal_entity_name?: string | null;
          seller_trading_name?: string | null;
          seller_registration_number?: string | null;
          seller_organisation_type?: string | null;
          seller_identity_verified_at?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          seller_payout_status?: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          seller_payout_ref?: string | null;
          seller_payout_nonce?: string | null;
          seller_payout_due_at?: string | null;
          seller_payout_at?: string | null;
          seller_payout_attempts?: number;
          seller_payout_error?: string | null;
          dispute_resolution?: 'REFUND_BUYER' | 'PARTIAL_REFUND' | 'RELEASE_SELLER' | null;
          dispute_resolved_at?: string | null;
          dispute_resolved_by?: string | null;
          refund_cents?: number;
          refund_status?: Database['cardtrade']['Enums']['cash_sale_payout_status'];
          refund_ref?: string | null;
          refund_nonce?: string | null;
          refund_error?: string | null;
          refund_attempts?: number;
          from_shopfront?: boolean;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sales_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_buyer_id_fkey';
            columns: ['buyer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_seller_id_fkey';
            columns: ['seller_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      /**
       * What a Cash_Sale actually covers, line by line (0064). Required for
       * SHOPFRONT contracts; SINGLE contracts describe their goods with the
       * `cash_sales.item_*` snapshot columns instead. Frozen once the contract
       * leaves AGREEMENT.
       */
      cash_sale_items: {
        Row: {
          id: string;
          cash_sale_id: string;
          description: string;
          condition: string | null;
          quantity: number;
          unit_price_cents: number;
          image_path: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          cash_sale_id: string;
          description: string;
          condition?: string | null;
          quantity?: number;
          unit_price_cents: number;
          image_path?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          cash_sale_id?: string;
          description?: string;
          condition?: string | null;
          quantity?: number;
          unit_price_cents?: number;
          image_path?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sale_items_cash_sale_id_fkey';
            columns: ['cash_sale_id'];
            isOneToOne: false;
            referencedRelation: 'cash_sales';
            referencedColumns: ['id'];
          },
        ];
      };
      cash_sale_events: {
        Row: {
          id: string;
          cash_sale_id: string;
          actor_id: string | null;
          event: string;
          from_status: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cash_sale_id: string;
          actor_id?: string | null;
          event: string;
          from_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cash_sale_id?: string;
          actor_id?: string | null;
          event?: string;
          from_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sale_events_cash_sale_id_fkey';
            columns: ['cash_sale_id'];
            isOneToOne: false;
            referencedRelation: 'cash_sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sale_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cash_sale_delivery_details: {
        Row: {
          cash_sale_id: string;
          buyer_id: string;
          address_label: string;
          place_id: string;
          country_code: string | null;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          cash_sale_id: string;
          buyer_id: string;
          address_label: string;
          place_id: string;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          cash_sale_id?: string;
          buyer_id?: string;
          address_label?: string;
          place_id?: string;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sale_delivery_details_cash_sale_id_fkey';
            columns: ['cash_sale_id'];
            isOneToOne: true;
            referencedRelation: 'cash_sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sale_delivery_details_buyer_id_fkey';
            columns: ['buyer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      /**
       * Protected postal addresses for a posted trade (0057).
       *
       * TWO rows per trade, keyed `(trade_id, trader_id)`, because a swap posts in
       * both directions and each trader needs to read the OTHER's address. The
       * Cash_Sale equivalent has one row: only the Buyer receives goods there.
       *
       * Deliberately NOT in the Realtime publication.
       */
      trade_delivery_details: {
        Row: {
          trade_id: string;
          trader_id: string;
          address_label: string;
          place_id: string;
          country_code: string | null;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          trade_id: string;
          trader_id: string;
          address_label: string;
          place_id: string;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          trade_id?: string;
          trader_id?: string;
          address_label?: string;
          place_id?: string;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_delivery_details_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_delivery_details_trader_id_fkey';
            columns: ['trader_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      pre_auth_holds: {
        Row: {
          id: string;
          trade_id: string;
          trader_id: string;
          /** Stripe PaymentIntent id (`pi_...`). */
          hold_ref: string | null;
          amount_cents: number;
          captured_cents: number;
          status: Database['cardtrade']['Enums']['hold_status'];
          /**
           * When the provider authorisation lapses (Stripe `capture_before`).
           * Null for providers whose holds do not expire. After this instant the
           * provider releases the funds itself and the hold cannot be voided or
           * captured.
           */
          expires_at: string | null;
          /** When the pre-expiry warning was sent (0035). Null until warned. */
          expiry_warned_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trade_id: string;
          trader_id: string;
          hold_ref?: string | null;
          amount_cents: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          expires_at?: string | null;
          expiry_warned_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trade_id?: string;
          trader_id?: string;
          hold_ref?: string | null;
          amount_cents?: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          expires_at?: string | null;
          expiry_warned_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pre_auth_holds_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pre_auth_holds_trader_id_fkey';
            columns: ['trader_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_items: {
        Row: {
          trade_id: string;
          trader_id: string;
          item_id: string;
          created_at: string;
        };
        Insert: {
          trade_id: string;
          trader_id: string;
          item_id: string;
          created_at?: string;
        };
        Update: {
          trade_id?: string;
          trader_id?: string;
          item_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_items_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_items_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_fees: {
        Row: {
          trade_id: string;
          trader_id: string;
          amount_cents: number;
          status: Database['cardtrade']['Enums']['trade_fee_status'];
          charge_ref: string | null;
          refund_ref: string | null;
          nonce: string;
          error: string | null;
          attempts: number;
          settled_at: string | null;
          refunded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          trade_id: string;
          trader_id: string;
          amount_cents: number;
          status?: Database['cardtrade']['Enums']['trade_fee_status'];
          charge_ref?: string | null;
          refund_ref?: string | null;
          nonce: string;
          error?: string | null;
          attempts?: number;
          settled_at?: string | null;
          refunded_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          status?: Database['cardtrade']['Enums']['trade_fee_status'];
          charge_ref?: string | null;
          refund_ref?: string | null;
          error?: string | null;
          attempts?: number;
          settled_at?: string | null;
          refunded_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_fees_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_state_transitions: {
        Row: {
          id: string;
          trade_id: string;
          from_state: Database['cardtrade']['Enums']['trade_state'];
          to_state: Database['cardtrade']['Enums']['trade_state'];
          requested_by: string | null;
          event: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trade_id: string;
          from_state: Database['cardtrade']['Enums']['trade_state'];
          to_state: Database['cardtrade']['Enums']['trade_state'];
          requested_by?: string | null;
          event: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          trade_id?: string;
          from_state?: Database['cardtrade']['Enums']['trade_state'];
          to_state?: Database['cardtrade']['Enums']['trade_state'];
          requested_by?: string | null;
          event?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_state_transitions_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_state_transitions_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      /**
       * Chargebacks reported by the provider (0036). The platform is merchant of
       * record and absorbs these, so a dispute is recorded even when it cannot be
       * attributed to a Trade or Cash_Sale. Admin-read-only under RLS; writes come
       * from the webhook pipeline on the service-role client.
       */
      charge_disputes: {
        Row: {
          id: string;
          dispute_ref: string;
          charge_ref: string;
          trade_id: string | null;
          cash_sale_id: string | null;
          profile_id: string | null;
          amount_cents: number;
          reason: string | null;
          status: string;
          /** `lost` is the only outcome that means funds were absorbed. */
          outcome: 'won' | 'lost' | 'warning_closed' | 'other' | null;
          /** Hard provider deadline; missing it forfeits automatically. */
          evidence_due_by: string | null;
          opened_at: string;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          dispute_ref: string;
          charge_ref: string;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          profile_id?: string | null;
          amount_cents: number;
          reason?: string | null;
          status: string;
          outcome?: 'won' | 'lost' | 'warning_closed' | 'other' | null;
          evidence_due_by?: string | null;
          opened_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          dispute_ref?: string;
          charge_ref?: string;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          profile_id?: string | null;
          amount_cents?: number;
          reason?: string | null;
          status?: string;
          outcome?: 'won' | 'lost' | 'warning_closed' | 'other' | null;
          evidence_due_by?: string | null;
          opened_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_logs: {
        Row: {
          id: string;
          event_id: string;
          event_type: string;
          payload: Json;
          outcome: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          event_type: string;
          payload: Json;
          outcome: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          event_type?: string;
          payload?: Json;
          outcome?: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_logs_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
        ];
      };
      /**
       * Jurisdictions the marketplace can operate in (0068).
       *
       * Reference data: one row per country Stripe supports separate charges and
       * transfers in. Publicly readable, writable only by a migration. Mirrors
       * `domain/region/regions.ts`, and the two are pinned together by
       * `tests/unit/regionCurrencyAgreement.test.ts`.
       */
      regions: {
        Row: {
          /** ISO 3166-1 alpha-2, uppercase. */
          code: string;
          label: string;
          /** ISO 4217, lowercase to match Stripe. */
          currency: string;
          /** 0 or 2. Three-decimal currencies are unrepresentable by design. */
          minor_unit_digits: number;
          /**
           * PRODUCT INTENT ONLY. A region is genuinely live only when a Stripe
           * platform account is also configured for it, which no column can know —
           * see `operationalRegions()` in `domain/services`.
           */
          trading_enabled: boolean;
          created_at: string;
        };
        Insert: {
          code: string;
          label: string;
          currency: string;
          minor_unit_digits: number;
          trading_enabled?: boolean;
          created_at?: string;
        };
        Update: {
          code?: string;
          label?: string;
          currency?: string;
          minor_unit_digits?: number;
          trading_enabled?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      watchlist: {
        Row: {
          user_id: string;
          item_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          item_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          item_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: Database['cardtrade']['Enums']['notification_type'];
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type?: Database['cardtrade']['Enums']['notification_type'];
          title: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: Database['cardtrade']['Enums']['notification_type'];
          title?: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Stripe cash escrow for private deals (0027). Separate from deal_holds
       * (collateral). HELD when both parties confirm; SETTLED when both mark
       * complete; left locked on dispute.
       */
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details: string | null;
          status: Database['cardtrade']['Enums']['report_status'];
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details?: string | null;
          status?: Database['cardtrade']['Enums']['report_status'];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: string;
          target_id?: string;
          reason?: string;
          details?: string | null;
          status?: Database['cardtrade']['Enums']['report_status'];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          reviewer_id: string;
          reviewee_id: string;
          rating: number;
          comment: string | null;
          source_type: string;
          source_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          reviewer_id: string;
          reviewee_id: string;
          rating: number;
          comment?: string | null;
          source_type: string;
          source_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          reviewer_id?: string;
          reviewee_id?: string;
          rating?: number;
          comment?: string | null;
          source_type?: string;
          source_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          id: string;
          item_id: string;
          seller_id: string;
          buyer_id: string;
          offered_by: string;
          amount_cents: number;
          status: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id: string | null;
          message: string | null;
          seller_identity_version: string | null;
          buyer_seller_identity_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          seller_id: string;
          buyer_id: string;
          offered_by: string;
          amount_cents: number;
          status?: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id?: string | null;
          message?: string | null;
          seller_identity_version?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          seller_id?: string;
          buyer_id?: string;
          offered_by?: string;
          amount_cents?: number;
          status?: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id?: string | null;
          message?: string | null;
          seller_identity_version?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          item_id: string | null;
          /** Set when this thread belongs to a private deal (0013). */
          /** Set when this thread belongs to a 2-way trade (0016). */
          trade_id: string | null;
          /** Set when this thread is the arbitration chat for a dispute (0019). */
          cash_sale_id: string | null;
          participant_a: string;
          participant_b: string;
          last_message_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          participant_a: string;
          participant_b: string;
          last_message_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          participant_a?: string;
          participant_b?: string;
          last_message_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          /** Null for a SYSTEM message mirrored from a contract event. */
          sender_id: string | null;
          kind: 'USER' | 'SYSTEM';
          system_event: string | null;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          kind?: 'USER' | 'SYSTEM';
          system_event?: string | null;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          kind?: 'USER' | 'SYSTEM';
          system_event?: string | null;
          body?: string;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Which staff member is working an arbitration case (0047). Keyed by
       * (kind, ref) because a case is a view over a cash sale, trade or chargeback
       * rather than a row of its own.
       */
      arbitration_assignments: {
        Row: {
          case_kind: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref: string;
          assignee_id: string;
          assigned_by: string | null;
          assigned_at: string;
        };
        Insert: {
          case_kind: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref: string;
          assignee_id: string;
          assigned_by?: string | null;
          assigned_at?: string;
        };
        Update: {
          case_kind?: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref?: string;
          assignee_id?: string;
          assigned_by?: string | null;
          assigned_at?: string;
        };
        Relationships: [];
      };
      /**
       * Internal staff notes on an arbitration case (0047). Append-only and NOT
       * visible to the parties — there is no member read policy and one must not be
       * added.
       */
      arbitration_notes: {
        Row: {
          id: string;
          case_kind: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref: string;
          author_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_kind: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref: string;
          author_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          case_kind?: Database['cardtrade']['Enums']['arbitration_case_kind'];
          case_ref?: string;
          author_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Participant-submitted dispute evidence (0082). Append-only: statements and
       * media a party files on a DISPUTED contract. Readable by both participants and
       * by staff — deliberately mutual, because deciding against someone on material
       * they never saw is not a process anyone can trust.
       */
      dispute_evidence: {
        Row: {
          id: string;
          /** CASH_SALE or TRADE. Same addressing as `arbitration_notes`. */
          case_kind: 'CASH_SALE' | 'TRADE';
          case_ref: string;
          author_id: string;
          statement: string;
          /** Object paths in the private `dispute-evidence` bucket. */
          media_paths: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          case_kind: 'CASH_SALE' | 'TRADE';
          case_ref: string;
          author_id: string;
          statement: string;
          media_paths?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          case_kind?: 'CASH_SALE' | 'TRADE';
          case_ref?: string;
          author_id?: string;
          statement?: string;
          media_paths?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string;
          display_name: string;
          rating: number | null;
          rating_count: number;
          /**
           * The Identity_Gate, and the only verification signal in the view:
           * `identity_check_status = 'VERIFIED'` (0069). Connect state is no part of it.
           *
           * The former `identity_verified` column was the same expression under a
           * name that implied a document-and-selfie check Connect does not prove.
           * Removed in 0049.
           */
          is_verified: boolean;
          /**
           * Provider-verified GIVEN name, public by design. The full legal name
           * is never exposed through this view.
           */
          identity_first_name: string | null;
          /**
           * The member's trading jurisdiction (0065), ISO 3166-1 alpha-2.
           *
           * See also `cardtrade.regions`, which this references from 0068.
           *
           * Exposed so a buy surface on the cookie-bound client can explain that a
           * listing is out of region BEFORE the member commits — `profiles` itself
           * is owner-only by RLS, so without this the refusal could only arrive
           * after the attempt. Not sensitive: it is already implied by every
           * listing the member has published.
           */
          region_code: string | null;

          /**
           * Storage object path in the `profile-images` bucket, or null (0066).
           *
           * A PATH, never a URL — `avatarUrl()` in `lib/format.ts` resolves it.
           * Self-chosen and unverified, so it is never identity: that is the
           * Identity_Gate plus `merchant_legal_entity_name`.
           */
          avatar_path: string | null;

          /**
           * Stripe Identity check state (0069). THIS is the Identity_Gate.
           *
           * Provider-controlled: `authenticated` may SELECT it but holds no UPDATE
           * grant, so only the Identity webhook or a server read-back writes it.
           */
          identity_check_status: Database['cardtrade']['Enums']['identity_check_status'];
          identity_check_session_id: string | null;
          identity_check_verified_at: string | null;
          identity_check_name: string | null;
          /** Optional social media handles keyed by platform slug (0085). */
          social_links: Record<string, string> | null;
          /**
           * Member-authored bio (0086, exposed on the view by 0087).
           *
           * Free text the member wrote about themselves — NOT part of the identity
           * disclosure and never provider-verified. Render it as untrusted copy.
           */
          bio: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_cash_sale_agreement: {
        Args: {
          p_item_id: string;
          p_buyer_id: string;
          p_agreed_price_cents: number;
          p_platform_fee_cents: number;
          p_seller_identity_version: string;
          p_seller_legal_entity_name: string;
          p_seller_trading_name: string | null;
          p_seller_registration_number: string;
          p_seller_organisation_type: string | null;
          p_seller_identity_verified_at: string;
          p_buyer_identity_confirmed_at: string;
          /**
           * Opening line items for a SHOPFRONT contract, written in the same
           * transaction (0064). Required for a shopfront, null for a SINGLE
           * listing. Snake_case keys: `description`, `condition`, `quantity`,
           * `unit_price_cents`, `image_path`.
           */
          p_items?: Json | null;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      /** 0064. Replace a shopfront contract's line items and re-derive its price. */
      replace_cash_sale_items: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
          p_expected_terms_version: number;
          p_items: Json;
          p_agreed_price_cents: number;
          p_platform_fee_cents: number;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      /** 0064. Retire a SHOPFRONT listing without touching its open contracts. */
      close_shopfront_listing: {
        Args: {
          p_item_id: string;
          p_owner_id: string;
        };
        Returns: Database['cardtrade']['Tables']['items']['Row'][];
      };
      update_cash_sale_terms: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
          p_expected_terms_version: number;
          p_fulfillment_method: Database['cardtrade']['Enums']['handover_method'];
          p_shipping_cost_cents: number;
          p_shipping_notes: string | null;
          p_meeting_location: string | null;
          p_meeting_lat: number | null;
          p_meeting_lng: number | null;
          p_meeting_place_id: string | null;
          p_meeting_at: string | null;
          p_delivery_address_label?: string | null;
          p_delivery_place_id?: string | null;
          p_delivery_country_code?: string | null;
          p_delivery_lat?: number | null;
          p_delivery_lng?: number | null;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      attach_cash_sale_conversation: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      attach_dispute_conversation: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      ensure_deal_conversation: {
        Args: {
          p_deal_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      ensure_trade_conversation: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      /** Negotiated trades (0053). A Trade now opens at NEGOTIATING. */
      open_trade_negotiation: {
        Args: {
          p_initiator_id: string;
          p_counterpart_id: string;
          p_initiator_item_id: string;
          p_counterpart_item_id: string;
          p_initiator_extra_item_ids?: string[] | null;
          p_counterpart_extra_item_ids?: string[] | null;
          p_cash_amount_cents?: number;
          p_cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          p_declared_value_cents?: number | null;
          p_handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          p_meeting_location?: string | null;
          p_meeting_lat?: number | null;
          p_meeting_lng?: number | null;
          p_meeting_place_id?: string | null;
          p_meeting_at?: string | null;
          p_delivery_details?: string | null;
          p_delivery_cost_cents?: number | null;
          p_offer_message?: string | null;
          /**
           * Required when the counterpart's listing is a SHOPFRONT, refused otherwise
           * (0081). The RPC raises `counterpart-goods-required` /
           * `counterpart-goods-not-applicable` rather than guessing.
           */
          p_counterpart_goods_description?: string | null;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'];
      };
      update_trade_terms: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
          p_expected_terms_version: number;
          p_cash_amount_cents: number;
          p_cash_direction: Database['cardtrade']['Enums']['trade_cash_direction'];
          p_declared_value_cents?: number | null;
          p_handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          p_meeting_location?: string | null;
          p_meeting_lat?: number | null;
          p_meeting_lng?: number | null;
          p_meeting_place_id?: string | null;
          p_meeting_at?: string | null;
          p_delivery_details?: string | null;
          p_delivery_cost_cents?: number | null;
          p_offer_message?: string | null;
          /**
           * A counter may revise what comes out of the binder. Null LEAVES the current
           * description in place (0081) — a counter about postage must not erase the
           * statement of what is being swapped.
           */
          p_counterpart_goods_description?: string | null;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      accept_trade_terms: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
          p_terms_version: number;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      begin_trade_collateral: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      decline_trade_negotiation: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
          p_reason?: string | null;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      apply_cash_sale_tracking: {
        Args: {
          p_cash_sale_id: string;
          p_tracking_status: string;
          p_delivered_at?: string;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      /**
       * Records a carrier update for the RETURN leg of a return-conditional refund
       * (0088).
       *
       * Distinct from `apply_cash_sale_tracking` on purpose: it writes only the
       * `return_*` columns, so a return event can never overwrite the outbound
       * delivery record the original inspection and any arbitration read. A
       * DELIVERED status queues the refund; it is monotonic, so a duplicate carrier
       * event cannot queue it twice.
       */
      apply_cash_sale_return_tracking: {
        Args: {
          p_cash_sale_id: string;
          p_tracking_status: string;
          p_delivered_at?: string;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      /**
       * Records a carrier update for ONE trader's outbound parcel (0057).
       *
       * Unlike the cash sale equivalent, a DELIVERED status does not advance the
       * state by itself: a trade needs both parcels to land, and the orchestrator
       * derives BOTH_RECEIVED from the columns instead.
       */
      apply_trade_tracking: {
        Args: {
          p_trade_id: string;
          p_trader_id: string;
          p_tracking_status: string;
          p_delivered_at?: string;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      /** Upserts one trader's protected postal address and flags it (0057). */
      set_trade_delivery_address: {
        Args: {
          p_trade_id: string;
          p_trader_id: string;
          p_address_label: string;
          p_place_id: string;
          p_country_code?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
        };
        Returns: Database['cardtrade']['Tables']['trades']['Row'][];
      };
      /** Queues the Seller release for a COMPLETED Cash_Sale (0038). */
      mark_cash_sale_payout_due: {
        Args: { p_cash_sale_id: string };
        Returns: Database['cardtrade']['Enums']['cash_sale_payout_status'];
      };
      /** Queues a dispute refund on a DISPUTED Cash_Sale, assigning a nonce (0044). */
      mark_cash_sale_refund_due: {
        Args: { p_cash_sale_id: string; p_amount_cents: number };
        Returns: Database['cardtrade']['Enums']['cash_sale_payout_status'];
      };
      /**
       * Records a dispute refund that failed after acceptance (0045). Reopens a
       * fully-refunded sale to DISPUTED; only flags a partial one.
       */
      record_cash_sale_refund_failure: {
        Args: { p_cash_sale_id: string; p_reason?: string | null };
        Returns: Database['cardtrade']['Enums']['cash_sale_status'];
      };
      /**
       * Records a participant's allegation of objective fraud on a trade (0046).
       * Records the claim only — capturing collateral is an operator decision.
       */
      record_trade_fraud_claim: {
        Args: { p_trade_id: string; p_claimant_id: string; p_reason: string };
        Returns: boolean;
      };
      /** Upserts a provider chargeback and alerts admins once (0036). */
      record_charge_dispute: {
        Args: {
          p_dispute_ref: string;
          p_charge_ref: string;
          p_amount_cents: number;
          p_status: string;
          p_reason?: string | null;
          p_trade_id?: string | null;
          p_cash_sale_id?: string | null;
          p_profile_id?: string | null;
          p_evidence_due_by?: string | null;
          p_outcome?: string | null;
        };
        Returns: string;
      };
      /** Marks lapsed collateral holds EXPIRED and notifies both traders (0035). */
      expire_lapsed_holds: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** Warns traders before a collateral authorisation lapses (0035). */
      warn_expiring_holds: {
        Args: Record<string, never>;
        Returns: number;
      };
      auto_complete_due_cash_sales: {
        Args: Record<string, never>;
        Returns: number;
      };
      member_sale_stats: {
        Args: { p_profile_id: string };
        Returns: {
          completed_sales: number;
          completed_purchases: number;
        }[];
      };
    };
    Enums: {
      merchant_status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
      /** Stripe Identity outcome (0069). VERIFIED is the Identity_Gate. */
      identity_check_status: 'NONE' | 'PENDING' | 'VERIFIED' | 'FAILED';
      item_status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
      /** 0064. See `items.listing_kind`. */
      listing_kind: 'SINGLE' | 'SHOPFRONT';
      trade_proposal_status:
        | 'PENDING'
        | 'ACCEPTED'
        | 'DECLINED'
        | 'WITHDRAWN'
        | 'SUPERSEDED';
      trade_cash_direction: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
      /** Lifecycle of one trader's Trade_Fee collection (0056). */
      trade_fee_status: 'PENDING' | 'SETTLED' | 'FAILED' | 'REFUNDED';
      trade_state:
        // Order matches the enum's sort order, which matches the lifecycle (0051).
        | 'NEGOTIATING'
        | 'COLLATERAL_PENDING'
        | 'COLLATERAL_LOCKED'
        | 'IN_TRANSIT'
        | 'INSPECTION'
        | 'COMPLETED'
        | 'DISPUTED'
        | 'FRAUD_RESOLVED'
        | 'CANCELLED';
      cash_sale_status:
        | 'AGREEMENT'
        | 'PAYMENT_PENDING'
        | 'ESCROW_HELD'
        | 'IN_TRANSIT'
        | 'HANDOVER'
        | 'INSPECTION'
        | 'COMPLETED'
        | 'DISPUTED'
        | 'CANCELLED'
        | 'FAILED'
        | 'REFUNDED'
        /**
         * Return-conditional refund (0088). A full refund was awarded on goods the
         * buyer holds, so the refund waits on the goods coming back.
         *
         * Neither is terminal, and the Item stays RESERVED throughout — relisting
         * before the return arrives would advertise goods in transit.
         */
        | 'RETURN_PENDING'
        | 'RETURN_IN_TRANSIT';
      /**
       * EXPIRED (0034) is distinct from VOIDED: the provider released the
       * collateral because the authorisation window lapsed, so the escrow
       * guarantee was LOST rather than deliberately honoured at $0.
       */
      /** Release leg of Cash_Sale escrow (0038). */
      cash_sale_payout_status: 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';
      hold_status:
        | 'ACTIVE'
        | 'VOIDED'
        | 'PARTIALLY_CAPTURED'
        | 'FULLY_CAPTURED'
        | 'FAILED'
        | 'EXPIRED';
      /** Stripe cash escrow status for private deals (0027). */
      deal_payment_status: 'HELD' | 'SETTLED' | 'REFUNDED' | 'FAILED';
      webhook_outcome: 'SUCCESS' | 'FAILURE' | 'NO_OP';
      offer_status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED' | 'WITHDRAWN';
      notification_type: 'OFFER' | 'MESSAGE' | 'TRADE' | 'SALE' | 'SYSTEM';
      report_status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
      deal_state:
        | 'INVITED'
        | 'TERMS'
        | 'CONFIRMATION'
        | 'ESCROW_PENDING'
        | 'ESCROW_LOCKED'
        | 'COMPLETED'
        | 'CANCELLED'
        | 'DISPUTED';
      handover_method: 'IN_PERSON' | 'DELIVERY';
      deal_role: 'BUYER' | 'SELLER' | 'TRADER';
      /**
       * How an arbitrator resolved a deal dispute (0048). The cash leg is an
       * uncaptured authorisation at dispute time, so these are capture decisions
       * rather than refunds.
       */
      deal_dispute_outcome: 'REFUND_PAYER' | 'SPLIT' | 'RELEASE_RECIPIENT';
      /** What kind of record an arbitration case is a view over (0047, 0048). */
      arbitration_case_kind: 'CASH_SALE' | 'TRADE' | 'CHARGEBACK' | 'DEAL';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ---------------------------------------------------------------------------
// Typed helper aliases
//
// These mirror the ergonomic helpers shipped with the Supabase generator so
// call sites can write `Tables<'items'>` instead of the long indexed access.
// ---------------------------------------------------------------------------

type PublicSchema = Database['cardtrade'];

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type Enums<T extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][T];
